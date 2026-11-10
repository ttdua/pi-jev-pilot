import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { listAgents, readAgent } from "../../../src/host/platform/agents.ts";
import { tempDir } from "../../helpers.ts";

function setup() {
  const cwd = tempDir("agents-cwd-");
  const agentDir = tempDir("agents-global-");
  const dirs = { cwd, agentDir };
  const put = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  return {
    cwd,
    dirs,
    project: (file: string, text: string) => put(join(cwd, ".pi", "agents", file), text),
    global: (file: string, text: string) => put(join(agentDir, "agents", file), text),
    put,
  };
}

const fmFile = (fm: string, body = "body") => `---\n${fm}\n---\n${body}`;

describe("Agent lookup order", () => {
  test("Project file wins", () => {
    const s = setup();
    s.project("worker.md", fmFile("description: from project"));
    s.global("worker.md", fmFile("description: from global"));
    const facts = readAgent("worker", s.dirs);
    expect(facts.source).toBe("project");
    expect(facts.description).toBe("from project");
  });
  test("Global file", () => {
    const s = setup();
    s.global("worker.md", fmFile("description: g"));
    const facts = readAgent("worker", s.dirs);
    expect(facts.source).toBe("global");
    expect(facts.name).toBe("worker");
  });
  test("Project file overrides a built-in", () => {
    const s = setup();
    s.project("Explore.md", fmFile("description: mine"));
    const facts = readAgent("Explore", s.dirs);
    expect(facts.source).toBe("project");
    expect(facts.description).toBe("mine");
  });
  test("Case-insensitive match", () => {
    const s = setup();
    s.project("Worker.md", fmFile("description: w"));
    const facts = readAgent("worker", s.dirs);
    expect(facts.name).toBe("Worker");
    expect(facts.source).toBe("project");
  });
  test("Unknown type", () => {
    const s = setup();
    const facts = readAgent("does-not-exist", s.dirs);
    expect(facts.name).toBe("general-purpose");
    expect(facts.source).toBe("builtin");
  });
  test("Non-string type", () => {
    const s = setup();
    expect(readAgent(42, s.dirs).name).toBe("general-purpose");
  });
});

describe("Case-insensitive agent match", () => {
  test("Case-insensitive match prefers the built-in name", () => {
    const s = setup();
    s.project("explore.md", fmFile("description: lower"));
    const facts = readAgent("EXPLORE", s.dirs);
    expect(facts.name).toBe("Explore");
    expect(facts.source).toBe("builtin");
  });
  test("Case-insensitive match prefers a global name over a project-only name", () => {
    const s = setup();
    s.global("Worker.md", fmFile("description: global"));
    s.project("wORKER.md", fmFile("description: project"));
    const facts = readAgent("worker", s.dirs);
    expect(facts.description).toBe("global");
    expect(facts.source).toBe("global");
  });
});

describe("Agent files are found by listing", () => {
  test("Path-like type", () => {
    const s = setup();
    s.put(join(s.cwd, "secret.md"), fmFile("description: secret"));
    expect(readAgent("../../secret", s.dirs).name).toBe("general-purpose");
    s.project("x.md", "x");
    expect(readAgent("../../secret", s.dirs).name).toBe("general-purpose");
    expect(readAgent("../secret", s.dirs).name).toBe("general-purpose");
  });
});

describe("Lookup never throws", () => {
  test("Unreadable file skipped", () => {
    const s = setup();
    mkdirSync(join(s.cwd, ".pi", "agents", "worker.md"), { recursive: true });
    s.global("worker.md", fmFile("description: g"));
    const facts = readAgent("worker", s.dirs);
    expect(facts.source).toBe("global");
  });
  test("Malformed frontmatter skipped", () => {
    const s = setup();
    s.project("worker.md", "---\ntools: [unclosed\n---\n");
    expect(readAgent("worker", s.dirs).name).toBe("general-purpose");
  });
  test("Agents directory missing", () => {
    const s = setup();
    const facts = readAgent("Plan", s.dirs);
    expect(facts.name).toBe("Plan");
    expect(facts.source).toBe("builtin");
    expect(facts.declaredTools).toEqual(["read", "bash", "grep", "find", "ls"]);
  });
});

describe("Built-in agents", () => {
  test("Explore built-in", () => {
    const s = setup();
    const facts = readAgent("Explore", s.dirs);
    expect(facts.source).toBe("builtin");
    expect(facts.sets).toEqual({ model: true, thinking: false });
    expect(facts.description).toBe("Fast codebase exploration agent (read-only)");
    expect(facts.declaredTools).toEqual(["read", "bash", "grep", "find", "ls"]);
    expect(facts.instructionsExcerpt).toBe("");
    expect(facts.inheritContext).toBeUndefined();
    expect(facts.runInBackground).toBeUndefined();
    expect(facts.locked).toBeUndefined();
    expect(facts.maxTurns).toBeNull();
    const plan = readAgent("Plan", s.dirs);
    expect(plan.inheritContext).toBeUndefined();
    expect(plan.runInBackground).toBeUndefined();
    expect(plan.locked).toBeUndefined();
    expect(plan.maxTurns).toBeNull();
  });
  test("general-purpose declares no tools", () => {
    const s = setup();
    expect(readAgent("general-purpose", s.dirs).declaredTools).toBeNull();
  });
});

describe("Agent identity fields", () => {
  test("Long body", () => {
    const s = setup();
    s.project("w.md", fmFile("description: d", "x".repeat(2000)));
    expect(readAgent("w", s.dirs).instructionsExcerpt).toBe("x".repeat(500));
  });
  test("Long body ending in an emoji at the cut", () => {
    const s = setup();
    s.project("w.md", fmFile("description: d", "x".repeat(499) + "😀" + "y".repeat(10)));
    const excerpt = readAgent("w", s.dirs).instructionsExcerpt;
    expect(Array.from(excerpt)).toHaveLength(500);
    expect(excerpt.endsWith("😀")).toBe(true);
  });
  test("Body without frontmatter", () => {
    const s = setup();
    s.project("w.md", "\n\nhello there");
    expect(readAgent("w", s.dirs).instructionsExcerpt.startsWith("hello")).toBe(true);
  });
  test("Frontmatter that is not a mapping reads as empty", () => {
    const s = setup();
    s.project("w.md", "---\nfoo\n---\nbody");
    const facts = readAgent("w", s.dirs);
    expect(facts.name).toBe("w");
    expect(facts.description).toBe("w");
    expect(facts.declaredTools).toBeNull();
    expect(facts.maxTurns).toBeNull();
    expect(facts.locked).toBeUndefined();
  });
});

describe("Model and thinking are never read out", () => {
  test("Model never read out", () => {
    const s = setup();
    s.project("w.md", fmFile("model: anthropic/claude-opus\nthinking: high"));
    const facts = readAgent("w", s.dirs);
    const json = JSON.stringify(facts);
    expect(json).not.toContain("anthropic/claude-opus");
    expect(json).not.toContain("high");
    expect(facts.sets).toEqual({ model: true, thinking: true });
  });
  test("Invalid thinking is not set", () => {
    const s = setup();
    s.project("w.md", fmFile("thinking: banana"));
    expect(readAgent("w", s.dirs).sets.thinking).toBe(false);
  });
});

describe("Declared tools", () => {
  test("Comma-separated tools", () => {
    const s = setup();
    s.project("w.md", fmFile("tools: read, grep"));
    expect(readAgent("w", s.dirs).declaredTools).toEqual(["read", "grep"]);
  });
  test("Tools none", () => {
    const s = setup();
    s.project("w.md", fmFile("tools: none"));
    expect(readAgent("w", s.dirs).declaredTools).toEqual([]);
  });
});

describe("Launch fields in the agent file", () => {
  test("Non-boolean flag", () => {
    const s = setup();
    s.project("w.md", fmFile('inherit_context: "yes"'));
    expect(readAgent("w", s.dirs).inheritContext).toBe(false);
  });
  test("max_turns not a number", () => {
    const s = setup();
    s.project("w.md", fmFile('max_turns: "5"'));
    expect(readAgent("w", s.dirs).maxTurns).toBeNull();
  });
  test("Flags and max_turns when valid", () => {
    const s = setup();
    s.project("w.md", fmFile("max_turns: 7\nrun_in_background: true"));
    const facts = readAgent("w", s.dirs);
    expect(facts.maxTurns).toBe(7);
    expect(facts.runInBackground).toBe(true);
    expect(facts.inheritContext).toBeUndefined();
  });
});

describe("Lock declaration", () => {
  test("Whole-file lock", () => {
    const s = setup();
    s.project("w.md", fmFile("locked: true"));
    expect(readAgent("w", s.dirs).locked).toBe(true);
  });
  test("Field list with unknown entry", () => {
    const s = setup();
    s.project("w.md", fmFile("locked: [model, colour]"));
    expect(readAgent("w", s.dirs).locked).toEqual(["model"]);
  });
  test("List with no lockable field", () => {
    const s = setup();
    s.project("a.md", fmFile("locked: [colour]"));
    s.project("b.md", fmFile("locked: false"));
    expect(readAgent("a", s.dirs).locked).toBeUndefined();
    expect(readAgent("b", s.dirs).locked).toBeUndefined();
  });
  test("Comma-separated lock", () => {
    const s = setup();
    s.project("w.md", fmFile('locked: "model, thinking"'));
    expect(readAgent("w", s.dirs).locked).toEqual(["model", "thinking"]);
  });
});

describe("listAgents", () => {
  test("listAgents merges project, global, builtin in name order", () => {
    const s = setup();
    s.project("zeta.md", fmFile("description: z"));
    s.global("alpha.md", fmFile("description: a"));
    const names = listAgents(s.dirs).map((a) => a.name);
    expect(names).toEqual(["Explore", "Plan", "alpha", "general-purpose", "zeta"]);
  });
  test("project wins over global for the same name", () => {
    const s = setup();
    s.project("worker.md", fmFile("description: from project"));
    s.global("worker.md", fmFile("description: from global"));
    const hits = listAgents(s.dirs).filter((a) => a.name === "worker");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.description).toBe("from project");
  });
  test("single-pass listing matches per-name lookup across sources", () => {
    const s = setup();
    s.project("both.md", fmFile("description: p"));
    s.global("both.md", fmFile("description: g"));
    s.global("only-global.md", fmFile("description: og"));
    s.project("Explore.md", fmFile("description: my explore"));
    s.project("broken.md", fmFile("tools: [unterminated"));
    s.global("broken.md", fmFile("description: fallback g"));
    const listed = listAgents(s.dirs);
    expect(listed.map((a) => a.name)).toEqual([
      "Explore",
      "Plan",
      "both",
      "broken",
      "general-purpose",
      "only-global",
    ]);
    for (const agent of listed) expect(agent).toEqual(readAgent(agent.name, s.dirs));
    expect(listed.find((a) => a.name === "both")?.source).toBe("project");
    expect(listed.find((a) => a.name === "only-global")?.source).toBe("global");
  });
});

import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { listAgents, readAgent } from "../../../src/host/platform/agents.ts";
import { tempDir } from "../../helpers.ts";

function setup() {
  const cwd = tempDir("agents-parse-cwd-");
  const agentDir = tempDir("agents-parse-global-");
  const put = (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  };
  return {
    dirs: { cwd, agentDir },
    project: (file: string, text: string) => put(join(cwd, ".pi", "agents", file), text),
    global: (file: string, text: string) => put(join(agentDir, "agents", file), text),
    projectPath: (file: string) => join(cwd, ".pi", "agents", file),
  };
}

const fm = (frontmatter: string, body = "body") => `---\n${frontmatter}\n---\n${body}`;

describe("agent file parsing: exact result", () => {
  test("every field present, in key order", () => {
    const s = setup();
    s.project(
      "w.md",
      fm(
        "description: Does work\ntools: read, grep\nmax_turns: 7\nmodel: m/x\nthinking: high\n" +
          "run_in_background: true\ninherit_context: false\nlocked: [model, thinking]",
        "  Instructions here.  ",
      ),
    );
    const facts = readAgent("w", s.dirs);
    expect(facts).toEqual({
      name: "w",
      source: "project",
      description: "Does work",
      instructionsExcerpt: "Instructions here.",
      declaredTools: ["read", "grep"],
      maxTurns: 7,
      sets: { model: true, thinking: true },
      runInBackground: true,
      inheritContext: false,
      locked: ["model", "thinking"],
    });
    expect(Object.keys(facts)).toEqual([
      "name",
      "source",
      "description",
      "instructionsExcerpt",
      "declaredTools",
      "maxTurns",
      "sets",
      "runInBackground",
      "inheritContext",
      "locked",
    ]);
  });

  test("empty frontmatter gives defaults with optional keys absent", () => {
    const s = setup();
    s.global("w.md", "just a body\n");
    const facts = readAgent("w", s.dirs);
    expect(facts).toEqual({
      name: "w",
      source: "global",
      description: "w",
      instructionsExcerpt: "just a body",
      declaredTools: null,
      maxTurns: null,
      sets: { model: false, thinking: false },
    });
    expect(Object.keys(facts)).toEqual([
      "name",
      "source",
      "description",
      "instructionsExcerpt",
      "declaredTools",
      "maxTurns",
      "sets",
    ]);
  });

  test("an empty file reads as an empty agent", () => {
    const s = setup();
    s.project("w.md", "");
    expect(readAgent("w", s.dirs)).toEqual({
      name: "w",
      source: "project",
      description: "w",
      instructionsExcerpt: "",
      declaredTools: null,
      maxTurns: null,
      sets: { model: false, thinking: false },
    });
  });

  test("optional keys appear only when set, in flag, flag, lock order", () => {
    const s = setup();
    s.project("w.md", fm("locked: true\ninherit_context: true\nrun_in_background: false"));
    const facts = readAgent("w", s.dirs);
    expect(Object.keys(facts).slice(7)).toEqual(["runInBackground", "inheritContext", "locked"]);
    expect(facts.runInBackground).toBe(false);
    expect(facts.inheritContext).toBe(true);
    expect(facts.locked).toBe(true);
  });
});

describe("agent file parsing: field values", () => {
  test("description must be a string", () => {
    const s = setup();
    s.project("a.md", fm("description: 42"));
    s.project("b.md", fm('description: ""'));
    expect(readAgent("a", s.dirs).description).toBe("a");
    expect(readAgent("b", s.dirs).description).toBe("");
  });

  test("max_turns accepts 0 and rejects negative and non-numbers", () => {
    const s = setup();
    s.project("zero.md", fm("max_turns: 0"));
    s.project("neg.md", fm("max_turns: -1"));
    s.project("flt.md", fm("max_turns: 2.5"));
    s.project("nul.md", fm("max_turns:"));
    expect(readAgent("zero", s.dirs).maxTurns).toBe(0);
    expect(readAgent("neg", s.dirs).maxTurns).toBeNull();
    expect(readAgent("flt", s.dirs).maxTurns).toBe(2.5);
    expect(readAgent("nul", s.dirs).maxTurns).toBeNull();
  });

  test("model and thinking flags", () => {
    const s = setup();
    s.project("a.md", fm("model: 5"));
    s.project("b.md", fm("thinking: off"));
    s.project("c.md", fm("thinking: max"));
    s.project("d.md", fm("thinking: High"));
    s.project("e.md", fm("thinking: 3"));
    expect(readAgent("a", s.dirs).sets).toEqual({ model: false, thinking: false });
    expect(readAgent("b", s.dirs).sets.thinking).toBe(true);
    expect(readAgent("c", s.dirs).sets.thinking).toBe(true);
    expect(readAgent("d", s.dirs).sets.thinking).toBe(false);
    expect(readAgent("e", s.dirs).sets.thinking).toBe(false);
  });

  test("tools: yaml list, blanks trimmed, empty and null forms", () => {
    const s = setup();
    s.project("list.md", fm("tools: [read, ' grep ', '']"));
    s.project("csv.md", fm('tools: " read , , bash "'));
    s.project("empty.md", fm('tools: ""'));
    s.project("nullv.md", fm("tools:"));
    s.project("emptylist.md", fm("tools: []"));
    s.project("none.md", fm("tools: [none]"));
    s.project("nonemore.md", fm("tools: none, read"));
    s.project("num.md", fm("tools: 5"));
    expect(readAgent("list", s.dirs).declaredTools).toEqual(["read", "grep"]);
    expect(readAgent("csv", s.dirs).declaredTools).toEqual(["read", "bash"]);
    expect(readAgent("empty", s.dirs).declaredTools).toEqual([]);
    expect(readAgent("nullv", s.dirs).declaredTools).toBeNull();
    expect(readAgent("emptylist", s.dirs).declaredTools).toEqual([]);
    expect(readAgent("none", s.dirs).declaredTools).toEqual([]);
    expect(readAgent("nonemore", s.dirs).declaredTools).toEqual(["none", "read"]);
    expect(readAgent("num", s.dirs).declaredTools).toEqual(["5"]);
  });

  test("flags: false is false, null is absent, other types are false", () => {
    const s = setup();
    s.project("a.md", fm("run_in_background: false\ninherit_context:"));
    s.project("b.md", fm("run_in_background: 1\ninherit_context: 'true'"));
    const a = readAgent("a", s.dirs);
    expect(a.runInBackground).toBe(false);
    expect("inheritContext" in a).toBe(false);
    const b = readAgent("b", s.dirs);
    expect(b.runInBackground).toBe(false);
    expect(b.inheritContext).toBe(false);
  });

  test("lock: unknown fields, none, empty and mixed forms", () => {
    const s = setup();
    s.project("a.md", fm("locked: [thinking, model, thinking]"));
    s.project("b.md", fm("locked: none"));
    s.project("c.md", fm("locked: []"));
    s.project("d.md", fm("locked:"));
    s.project("e.md", fm("locked: 7"));
    s.project("f.md", fm("locked: model"));
    s.project("g.md", fm("locked: ' , '"));
    expect(readAgent("a", s.dirs).locked).toEqual(["thinking", "model", "thinking"]);
    expect("locked" in readAgent("b", s.dirs)).toBe(false);
    expect("locked" in readAgent("c", s.dirs)).toBe(false);
    expect("locked" in readAgent("d", s.dirs)).toBe(false);
    expect("locked" in readAgent("e", s.dirs)).toBe(false);
    expect(readAgent("f", s.dirs).locked).toEqual(["model"]);
    expect("locked" in readAgent("g", s.dirs)).toBe(false);
  });

  test("unknown frontmatter fields are ignored", () => {
    const s = setup();
    s.project("w.md", fm("colour: red\nextra: [1, 2]"));
    expect(readAgent("w", s.dirs)).toEqual({
      name: "w",
      source: "project",
      description: "w",
      instructionsExcerpt: "body",
      declaredTools: null,
      maxTurns: null,
      sets: { model: false, thinking: false },
    });
  });

  test("a frontmatter list is not a mapping and reads as empty", () => {
    const s = setup();
    s.project("w.md", fm("- a\n- b"));
    const facts = readAgent("w", s.dirs);
    expect(facts.description).toBe("w");
    expect(facts.declaredTools).toBeNull();
  });
});

describe("agent file parsing: failures", () => {
  test("an unreadable project file falls through to the global one", () => {
    const s = setup();
    s.project("w.md", fm("description: p"));
    s.global("w.md", fm("description: g"));
    chmodSync(s.projectPath("w.md"), 0o000);
    try {
      const facts = readAgent("w", s.dirs);
      // root can read a 000 file; otherwise the global file wins
      expect(["p", "g"]).toContain(facts.description);
      if (process.getuid?.() !== 0) expect(facts.source).toBe("global");
    } finally {
      chmodSync(s.projectPath("w.md"), 0o600);
    }
  });

  test("a malformed file is omitted from listAgents, others stay", () => {
    const s = setup();
    s.project("bad.md", "---\ntools: [unclosed\n---\n");
    s.project("ok.md", fm("description: fine"));
    const names = listAgents(s.dirs).map((a) => a.name);
    expect(names).toContain("ok");
    expect(names).not.toContain("bad");
  });
});

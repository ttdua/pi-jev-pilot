import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"; // vi: console.warn spy
import { BUILTIN_TOOL_NAMES } from "#src/config/agent-types";
import { loadCustomAgents } from "#src/config/custom-agents";
import type { PackageAgentDir } from "#src/config/package-agents";

/** No built-in or package directories: these tests exercise the global and project sources only. */
const NO_DIRS = { builtinDirs: [], packageDirs: [] };

describe("loadCustomAgents", () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    if (originalHome == null) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeAgent(name: string, content: string) {
    const dir = join(tmpDir, ".pi", "agents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), content);
  }

  it("returns empty map when .pi/agents/ does not exist", () => {
    const result = loadCustomAgents(tmpDir, NO_DIRS);
    expect(result.size).toBe(0);
  });

  it("loads a basic agent with all frontmatter fields", () => {
    writeAgent("auditor", `---
description: Security Auditor
tools: read, grep, find
model: anthropic/claude-opus-4-6
thinking: high
max_turns: 30
prompt_mode: replace
inherit_context: true
run_in_background: true
---

You are a security auditor.`);

    const result = loadCustomAgents(tmpDir, NO_DIRS);
    expect(result.size).toBe(1);

    const agent = result.get("auditor")!;
    expect(agent.name).toBe("auditor");
    expect(agent.description).toBe("Security Auditor");
    expect(agent.toolNames).toEqual(["read", "grep", "find"]);
    expect(agent.model).toBe("anthropic/claude-opus-4-6");
    expect(agent.thinking).toBe("high");
    expect(agent.maxTurns).toBe(30);
    expect(agent.context).toBe("fork");
    expect(agent.runInBackground).toBe(true);
    expect(agent.systemPrompt).toBe("You are a security auditor.");
  });

  it("uses sensible defaults when frontmatter is empty", () => {
    writeAgent("minimal", `---
---

Just a prompt.`);

    const result = loadCustomAgents(tmpDir, NO_DIRS);
    const agent = result.get("minimal")!;

    expect(agent.name).toBe("minimal");
    expect(agent.description).toBe("minimal"); // defaults to filename
    expect(agent.toolNames).toEqual(BUILTIN_TOOL_NAMES); // all tools
    expect(agent.model).toBeUndefined();
    expect(agent.thinking).toBeUndefined();
    expect(agent.maxTurns).toBeUndefined();
    expect(agent.context).toBeUndefined();
    expect(agent.runInBackground).toBeUndefined();
    expect(agent.systemPrompt).toBe("Just a prompt.");
  });

  it("uses sensible defaults when no frontmatter at all", () => {
    writeAgent("bare", "Just a system prompt, no frontmatter.");

    const result = loadCustomAgents(tmpDir, NO_DIRS);
    const agent = result.get("bare")!;

    expect(agent.name).toBe("bare");
    expect(agent.description).toBe("bare");
    expect(agent.toolNames).toEqual(BUILTIN_TOOL_NAMES);
    expect(agent.context).toBeUndefined();
    expect(agent.systemPrompt).toBe("Just a system prompt, no frontmatter.");
  });

  it("handles tools: none → empty array", () => {
    writeAgent("notool", `---
tools: none
---

No tools.`);

    const result = loadCustomAgents(tmpDir, NO_DIRS);
    expect(result.get("notool")!.toolNames).toEqual([]);
  });

  it("passes through unknown tool names (not filtered)", () => {
    writeAgent("custom-tools", `---
tools: read, my_custom_tool, grep
---

Custom tools.`);

    const result = loadCustomAgents(tmpDir, NO_DIRS);
    // An extension-registered tool name is a supported `tools:` entry: the child's
    // allowlist admits it when the extension registers it during bind (#725).
    expect(result.get("custom-tools")!.toolNames).toEqual(["read", "my_custom_tool", "grep"]);
  });

  it("keeps an MCP tool pattern intact", () => {
    writeAgent("mcp-tools", `---
tools: read, mcp__github__*
---

GitHub tools.`);

    const result = loadCustomAgents(tmpDir, NO_DIRS);
    // The child expands the pattern against the parent's tools when it is created.
    expect(result.get("mcp-tools")!.toolNames).toEqual(["read", "mcp__github__*"]);
  });

  describe("tools field forms", () => {
    it("accepts a YAML block sequence", () => {
      writeAgent("block-seq", `---
tools:
  - read
  - my_custom_tool
  - grep
---

Block sequence.`);

      const result = loadCustomAgents(tmpDir, NO_DIRS);
      expect(result.get("block-seq")!.toolNames).toEqual(["read", "my_custom_tool", "grep"]);
    });

    it("accepts a YAML flow sequence", () => {
      writeAgent("flow-seq", `---
tools: [read, grep]
---

Flow sequence.`);

      const result = loadCustomAgents(tmpDir, NO_DIRS);
      expect(result.get("flow-seq")!.toolNames).toEqual(["read", "grep"]);
    });

    it("treats a single-element none sequence as no tools", () => {
      writeAgent("seq-none", `---
tools: [none]
---

No tools.`);

      const result = loadCustomAgents(tmpDir, NO_DIRS);
      expect(result.get("seq-none")!.toolNames).toEqual([]);
    });

    it("treats an empty sequence as no tools", () => {
      writeAgent("seq-empty", `---
tools: []
---

No tools.`);

      const result = loadCustomAgents(tmpDir, NO_DIRS);
      expect(result.get("seq-empty")!.toolNames).toEqual([]);
    });

    it("keeps a comma inside a quoted sequence entry", () => {
      writeAgent("seq-comma", `---
tools: ["read", "weird,name"]
---

Comma entry.`);

      const result = loadCustomAgents(tmpDir, NO_DIRS);
      expect(result.get("seq-comma")!.toolNames).toEqual(["read", "weird,name"]);
    });
  });

  describe("locked field", () => {
    it("is undefined when the key is absent", () => {
      writeAgent("open", `---\nmodel: haiku\n---\n\nOpen.`);

      expect(loadCustomAgents(tmpDir, NO_DIRS).get("open")!.locked).toBeUndefined();
    });

    it("reads `true` as locking every field the file sets", () => {
      writeAgent("pinned", `---\nmodel: haiku\nlocked: true\n---\n\nPinned.`);

      expect(loadCustomAgents(tmpDir, NO_DIRS).get("pinned")!.locked).toBe(true);
    });

    it("reads `false` as no lock at all", () => {
      writeAgent("unpinned", `---\nmodel: haiku\nlocked: false\n---\n\nUnpinned.`);

      expect(loadCustomAgents(tmpDir, NO_DIRS).get("unpinned")!.locked).toBeUndefined();
    });

    it("reads a comma-separated scalar", () => {
      writeAgent("scalar", `---\nlocked: model, thinking\n---\n\nScalar.`);

      expect(loadCustomAgents(tmpDir, NO_DIRS).get("scalar")!.locked).toEqual(["model", "thinking"]);
    });

    it("reads a YAML flow sequence", () => {
      writeAgent("seq", `---\nlocked: [model, max_turns]\n---\n\nSequence.`);

      expect(loadCustomAgents(tmpDir, NO_DIRS).get("seq")!.locked).toEqual(["model", "max_turns"]);
    });

    it("reads every lockable field name", () => {
      writeAgent("all", `---\nlocked: [model, thinking, max_turns, context, run_in_background]\n---\n\nAll.`);

      expect(loadCustomAgents(tmpDir, NO_DIRS).get("all")!.locked).toEqual([
        "model",
        "thinking",
        "max_turns",
        "context",
        "run_in_background",
      ]);
    });

    it("drops an entry that is not a lockable field", () => {
      writeAgent("typo", `---\nlocked: [model, tools]\n---\n\nTypo.`);

      expect(loadCustomAgents(tmpDir, NO_DIRS).get("typo")!.locked).toEqual(["model"]);
    });

    it("is undefined when every entry is dropped", () => {
      writeAgent("alltypo", `---\nlocked: [tools]\n---\n\nAll typo.`);

      expect(loadCustomAgents(tmpDir, NO_DIRS).get("alltypo")!.locked).toBeUndefined();
    });

    it("reads `none` as no lock", () => {
      writeAgent("nolock", `---\nlocked: none\n---\n\nNo lock.`);

      expect(loadCustomAgents(tmpDir, NO_DIRS).get("nolock")!.locked).toBeUndefined();
    });
  });

  describe("thinking level", () => {
    it.each(["off", "minimal", "low", "medium", "high", "xhigh", "max"])(
      "keeps %s",
      (level) => {
        writeAgent("thinker", `---\nthinking: ${level}\n---\n\nA thinker.`);

        expect(loadCustomAgents(tmpDir, NO_DIRS).get("thinker")!.thinking).toBe(level);
      },
    );

    /**
     * Pi does not reject an unrecognized level — clampThinkingLevel misses it in
     * its ordered table and falls to the first supported level, which is always
     * "off". Passing it through would silently disable thinking for an agent whose
     * author asked for more of it, so the loader drops the field and the agent
     * inherits the parent's level instead (Refs #834).
     */
    it("drops an unrecognized level rather than letting the SDK clamp it to off", () => {
      writeAgent("anythink", `---\nthinking: turbo\n---\n\nAny thinking.`);

      expect(loadCustomAgents(tmpDir, NO_DIRS).get("anythink")!.thinking).toBeUndefined();
    });

    it("drops a level that differs only in case", () => {
      writeAgent("shouty", `---\nthinking: HIGH\n---\n\nShouting.`);

      expect(loadCustomAgents(tmpDir, NO_DIRS).get("shouty")!.thinking).toBeUndefined();
    });
  });

  it("accepts max_turns: 0 as unlimited", () => {
    writeAgent("unlimited", `---
max_turns: 0
---

Unlimited turns.`);

    const result = loadCustomAgents(tmpDir, NO_DIRS);
    expect(result.get("unlimited")!.maxTurns).toBe(0);
  });

  it("keeps a max_turns below the minimum for the turn loop to raise", () => {
    writeAgent("terse", `---
max_turns: 1
---

Terse.`);

    expect(loadCustomAgents(tmpDir, NO_DIRS).get("terse")!.maxTurns).toBe(1);
  });

  it("rejects negative max_turns", () => {
    writeAgent("negturns", `---
max_turns: -5
---

Negative turns.`);

    const result = loadCustomAgents(tmpDir, NO_DIRS);
    expect(result.get("negturns")!.maxTurns).toBeUndefined();
  });

  it("handles prompt_mode: append", () => {
    writeAgent("appender", `---
prompt_mode: append
---

Extra instructions.`);

    const result = loadCustomAgents(tmpDir, NO_DIRS);
    expect(result.get("appender")!.context).toBeUndefined();
  });

  describe("context", () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      vi.stubEnv("PI_SUBAGENTS_DEBUG", "1");
      warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      warn.mockRestore();
    });
    const warnings = () => warn.mock.calls.map((c: unknown[]) => String(c[0]));

    it("parses context: fork", () => {
      writeAgent("forker", "---\ncontext: fork\n---\n\nBody.");
      expect(loadCustomAgents(tmpDir, NO_DIRS).get("forker")!.context).toBe("fork");
      expect(warnings()).toEqual([]);
    });

    it("declares nothing and warns for an invalid value", () => {
      writeAgent("nested", "---\ncontext: nested\n---\n\nBody.");
      expect(loadCustomAgents(tmpDir, NO_DIRS).get("nested")!.context).toBeUndefined();
      const found = warnings().filter((w: string) => w.includes("nested.md") && w.includes("context"));
      expect(found).toHaveLength(1);
    });

    it("reads inherit_context: true as fork and warns", () => {
      writeAgent("old", "---\ninherit_context: true\n---\n\nBody.");
      expect(loadCustomAgents(tmpDir, NO_DIRS).get("old")!.context).toBe("fork");
      expect(warnings().filter((w: string) => w.includes("old.md") && w.includes("context"))).toHaveLength(1);
    });

    it("lets context win over inherit_context", () => {
      writeAgent("both", "---\ncontext: fresh\ninherit_context: true\n---\n\nBody.");
      expect(loadCustomAgents(tmpDir, NO_DIRS).get("both")!.context).toBe("fresh");
    });

    it("ignores prompt_mode and warns", () => {
      writeAgent("modal", "---\nprompt_mode: append\n---\n\nBody.");
      expect(loadCustomAgents(tmpDir, NO_DIRS).get("modal")!.context).toBeUndefined();
      expect(warnings().filter((w: string) => w.includes("modal.md") && w.includes("prompt_mode"))).toHaveLength(1);
      expect(warnings().find((w: string) => w.includes("prompt_mode"))).toContain("use context: fresh | fork");
    });

    it("warns once per file per load even when the file is read twice", () => {
      // The global dir resolves to the project dir, so one file loads twice.
      vi.stubEnv("PI_CODING_AGENT_DIR", join(tmpDir, ".pi"));
      writeAgent("twice", "---\ninherit_context: true\nprompt_mode: append\n---\n\nBody.");
      loadCustomAgents(tmpDir, NO_DIRS);
      expect(warnings().filter((w: string) => w.includes("twice.md") && w.includes("inherit_context"))).toHaveLength(1);
      expect(warnings().filter((w: string) => w.includes("twice.md") && w.includes("prompt_mode"))).toHaveLength(1);
    });

    it("warns about locked: inherit_context once per file per load, and again on a later load", () => {
      vi.stubEnv("PI_CODING_AGENT_DIR", join(tmpDir, ".pi"));
      writeAgent("lkw", "---\nlocked: [inherit_context]\n---\n\nBody.");
      const count = () => warnings().filter((w: string) => w.includes("lkw.md") && w.includes("locked")).length;
      loadCustomAgents(tmpDir, NO_DIRS);
      expect(count()).toBe(1);
      loadCustomAgents(tmpDir, NO_DIRS);
      expect(count()).toBe(2);
    });

    it("reads locked: inherit_context as context", () => {
      writeAgent("lk", "---\nlocked: [inherit_context]\n---\n\nBody.");
      expect(loadCustomAgents(tmpDir, NO_DIRS).get("lk")!.locked).toEqual(["context"]);
    });
  });

  it("loads multiple agents", () => {
    writeAgent("agent1", `---
description: First
---

First agent.`);
    writeAgent("agent2", `---
description: Second
---

Second agent.`);

    const result = loadCustomAgents(tmpDir, NO_DIRS);
    expect(result.size).toBe(2);
    expect(result.has("agent1")).toBe(true);
    expect(result.has("agent2")).toBe(true);
  });

  it("skips non-.md files", () => {
    const dir = join(tmpDir, ".pi", "agents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "notes.txt"), "not an agent");
    writeFileSync(join(dir, "real.md"), `---
description: Real Agent
---

Real.`);

    const result = loadCustomAgents(tmpDir, NO_DIRS);
    expect(result.size).toBe(1);
    expect(result.has("real")).toBe(true);
  });

  it("allows agents with names matching defaults (overrides them)", () => {
    writeAgent("Explore", `---
description: Custom Explore
---

Custom explore agent.`);
    writeAgent("custom", `---
description: Custom Agent
---

Should be loaded.`);

    const result = loadCustomAgents(tmpDir, NO_DIRS);
    expect(result.has("Explore")).toBe(true);
    expect(result.get("Explore")!.description).toBe("Custom Explore");
    expect(result.has("custom")).toBe(true);
  });

  it("handles empty body with frontmatter", () => {
    writeAgent("nobody", `---
description: No body
tools: read
---
`);

    const result = loadCustomAgents(tmpDir, NO_DIRS);
    expect(result.get("nobody")!.systemPrompt).toBe("");
  });

  it("handles enabled: false frontmatter", () => {
    writeAgent("disabled", `---
enabled: false
---
`);

    const result = loadCustomAgents(tmpDir, NO_DIRS);
    const agent = result.get("disabled")!;
    expect(agent.enabled).toBe(false);
  });

  it("parses display_name frontmatter", () => {
    writeAgent("myagent", `---
description: My Agent
display_name: MyAgent
---

Agent prompt.`);

    const result = loadCustomAgents(tmpDir, NO_DIRS);
    expect(result.get("myagent")!.displayName).toBe("MyAgent");
  });

  it("honors PI_CODING_AGENT_DIR for global custom agent discovery", () => {
    const altAgentDir = mkdtempSync(join(tmpdir(), "pi-alt-agent-"));
    const originalEnv = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = altAgentDir;
    try {
      const globalAgentsDir = join(altAgentDir, "agents");
      mkdirSync(globalAgentsDir, { recursive: true });
      writeFileSync(
        join(globalAgentsDir, "via-env.md"),
        "---\ndescription: Discovered via env var\n---\n\nTest body.",
      );

      const result = loadCustomAgents(tmpDir, NO_DIRS);

      // Agent is found at $PI_CODING_AGENT_DIR/agents, not at $HOME/.pi/agent/agents
      expect(result.has("via-env")).toBe(true);
      expect(result.get("via-env")!.description).toBe("Discovered via env var");
    } finally {
      if (originalEnv == null) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = originalEnv;
      rmSync(altAgentDir, { recursive: true, force: true });
    }
  });
});

describe("loadCustomAgents — sources and overrides", () => {
  let root: string;
  let originalAgentDir: string | undefined;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "pi-sources-")));
    originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(root, "global-home");
  });

  afterEach(() => {
    if (originalAgentDir == null) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    rmSync(root, { recursive: true, force: true });
  });

  function dirWith(rel: string, files: Record<string, string>): PackageAgentDir {
    const pkg = join(root, rel.split("/")[0]!);
    const dir = join(root, rel);
    mkdirSync(dir, { recursive: true });
    for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content);
    return { dir: realpathSync(dir), root: realpathSync(pkg) };
  }

  const agent = (description: string, extra = "") => `---\n${extra}description: ${description}\n---\nBody of ${description}.`;
  const project = (name: string, content: string) => {
    const dir = join(root, "project", ".pi", "agents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), content);
  };
  const load = (opts: { builtinDirs?: PackageAgentDir[]; packageDirs?: PackageAgentDir[] }) =>
    loadCustomAgents(join(root, "project"), { builtinDirs: [], packageDirs: [], ...opts });

  it("tags each source and lets later sources win in order", () => {
    const builtinDirs = [dirWith("b/agents", { "x.md": agent("builtin"), "y.md": agent("only builtin") })];
    const packageDirs = [dirWith("p/agents", { "x.md": agent("package") })];
    expect(load({ builtinDirs }).get("x")?.source).toBe("builtin");
    expect(load({ builtinDirs, packageDirs }).get("x")?.source).toBe("package");

    const globalDir = join(root, "global-home", "agents");
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "x.md"), agent("global"));
    expect(load({ builtinDirs, packageDirs }).get("x")?.source).toBe("global");

    project("x", agent("project"));
    const agents = load({ builtinDirs, packageDirs });
    expect(agents.get("x")?.source).toBe("project");
    expect(agents.get("y")?.source).toBe("builtin");
  });

  it("replaces case-insensitively and keeps one entry", () => {
    const builtinDirs = [dirWith("b/agents", { "explore.md": agent("builtin") })];
    project("Explore", agent("project"));
    const agents = load({ builtinDirs });
    expect([...agents.keys()]).toEqual(["Explore"]);
    expect(agents.get("Explore")?.description).toBe("project");
  });

  it("names an agent by its frontmatter name over its file name", () => {
    const builtinDirs = [dirWith("b/agents", { "explore.md": agent("builtin"), "scout.md": agent("scout") })];
    project("my-explorer", agent("override", "name: EXPLORE\n"));
    project("Other", agent("added", "name: other\n"));
    const agents = load({ builtinDirs });
    expect([...agents.keys()].sort()).toEqual(["EXPLORE", "other", "scout"]);
  });

  it("falls back to the file name when name is not a non-empty string", () => {
    const packageDirs = [dirWith("p/agents", { "numeric.md": agent("n", "name: 3\n"), "blank.md": agent("b", "name: \"  \"\n") })];
    expect([...load({ packageDirs }).keys()].sort()).toEqual(["blank", "numeric"]);
  });

  it("keeps the later package when two packages define the same name", () => {
    const packageDirs = [
      dirWith("p1/agents", { "dup.md": agent("first") }),
      dirWith("p2/agents", { "dup.md": agent("second") }),
    ];
    const agents = load({ packageDirs });
    expect(agents.size).toBe(1);
    expect(agents.get("dup")?.description).toBe("second");
  });

  it("loads only top-level markdown files of a package directory", () => {
    const packageDirs = [dirWith("p/agents", { "top.md": agent("top"), "note.txt": "x" })];
    mkdirSync(join(root, "p", "agents", "nested"));
    writeFileSync(join(root, "p", "agents", "nested", "deep.md"), agent("deep"));
    expect([...load({ packageDirs }).keys()]).toEqual(["top"]);
  });

  it("skips a package file symlinked out of the package", () => {
    const packageDirs = [dirWith("p/agents", { "ok.md": agent("ok") })];
    writeFileSync(join(root, "secret.md"), agent("leak"));
    symlinkSync(join(root, "secret.md"), join(root, "p", "agents", "leak.md"));
    expect([...load({ packageDirs }).keys()]).toEqual(["ok"]);
  });
});

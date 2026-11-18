import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentTypeRegistry } from "#src/config/agent-types";
import { loadCustomAgents } from "#src/config/custom-agents";
import { builtinAgentDirs } from "#src/config/package-agents";
import { AgentTypeCatalog } from "#src/seams/registry";

const PACKAGE_ROOT = join(import.meta.dirname, "..", "..");
const ROLES = ["general", "implementer", "explore", "scout", "reviewer", "verifier"];

let emptyCwd: string;
let originalAgentDir: string | undefined;

// Empty cwd and agent dir keep the operator's own global and project agents out.
beforeAll(() => {
  emptyCwd = realpathSync(mkdtempSync(join(tmpdir(), "builtin-agents-")));
  originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(emptyCwd, "global");
});

afterAll(() => {
  if (originalAgentDir == null) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  rmSync(emptyCwd, { recursive: true, force: true });
});

/** The built-ins alone: no package, global or project agents. */
function builtinOnly(): AgentTypeCatalog {
  const registry = new AgentTypeRegistry(() => loadCustomAgents(emptyCwd, { builtinDirs: builtinAgentDirs(), packageDirs: [] }));
  return new AgentTypeCatalog(registry);
}

const READ_ONLY = ["read", "grep", "find", "ls"];

describe("built-in role agents", () => {
  it("lists exactly the six roles, all builtin", () => {
    const list = builtinOnly().list();
    expect(list.map((a) => a.name).sort()).toEqual([...ROLES].sort());
    expect(list.every((a) => a.source === "builtin")).toBe(true);
  });

  it("gives implementer write tools and denies nothing", () => {
    const snapshot = builtinOnly().get("implementer")!;
    expect(snapshot.tools).toEqual([...READ_ONLY, "bash", "edit", "write"]);
    expect(snapshot.disallowedTools).toEqual([]);
  });

  it.each(["scout", "reviewer", "explore"])("makes %s read-only", (name) => {
    const snapshot = builtinOnly().get(name)!;
    expect(snapshot.tools).toEqual(READ_ONLY);
    expect(snapshot.disallowedTools).toEqual(["bash", "edit", "write"]);
  });

  it("lets verifier run commands but not edit", () => {
    const snapshot = builtinOnly().get("verifier")!;
    expect(snapshot.tools).toEqual([...READ_ONLY, "bash"]);
    expect(snapshot.disallowedTools).toEqual(["edit", "write"]);
  });

  it("keeps the defaults for general", () => {
    const snapshot = builtinOnly().get("general")!;
    expect(snapshot.tools).toBeNull();
    expect(snapshot.defaultTools).toEqual(["read", "bash", "edit", "write", "grep", "find", "ls"]);
    expect(snapshot.disallowedTools).toEqual([]);
  });

  it.each(ROLES)("%s sets no model, thinking or locked", (name) => {
    const snapshot = builtinOnly().get(name)!;
    expect(snapshot).not.toHaveProperty("model");
    expect(snapshot).not.toHaveProperty("thinking");
    expect(snapshot).not.toHaveProperty("locked");
  });
});

describe("built-in role bodies", () => {
  const FORBIDDEN_NAMES = [
    "test-driven-development",
    "verification-before-completion",
    "systematic-debugging",
    "brainstorming",
    "writing-plans",
    "executing-plans",
    "subagent-driven-development",
    "requesting-code-review",
    "receiving-code-review",
    "finishing-a-development-branch",
    "using-git-worktrees",
    "coding-standards",
    "opsx-",
  ];
  const files = ROLES.map((role) => [role, readFileSync(join(PACKAGE_ROOT, "agents", `${role}.md`), "utf-8")] as const);

  it.each(files)("%s names no skill, slash command or workflow", (_role, text) => {
    expect(text).not.toMatch(/skill:/);
    expect(text).not.toMatch(/(^|\s)\/[a-z][a-z0-9-]+/);
    expect(text).not.toMatch(/^skills\s*:/m);
    for (const name of FORBIDDEN_NAMES) expect(text).not.toContain(name);
  });

  it.each(files)("%s names ask_parent as the escalation", (_role, text) => {
    expect(text).toContain("ask_parent");
  });
});

describe("packed executor", () => {
  it("lists every built-in agent file", () => {
    const out = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: PACKAGE_ROOT,
      encoding: "utf-8",
    });
    const paths = (JSON.parse(out) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path);
    for (const role of ROLES) expect(paths).toContain(`agents/${role}.md`);
  });
});

describe("override files are not checked", () => {
  it("lets a global implementer naming a skill replace the built-in without a warning", () => {
    const globalAgents = join(emptyCwd, "global", "agents");
    mkdirSync(globalAgents, { recursive: true });
    writeFileSync(
      join(globalAgents, "implementer.md"),
      "---\ndescription: Mine\n---\nFollow test-driven-development and /opsx-apply.",
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const snapshot = builtinOnly().get("implementer")!;
      expect(snapshot.source).toBe("global");
      expect(snapshot.instructions).toContain("test-driven-development");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      rmSync(globalAgents, { recursive: true, force: true });
    }
  });
});

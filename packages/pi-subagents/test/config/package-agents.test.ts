import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  builtinAgentDirs,
  type ConfiguredPackageRow,
  packageAgentDirs,
  readSubagentManifest,
  seedProjectTrust,
  setProjectTrusted,
} from "#src/config/package-agents";

let tmp: string;

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "pkg-agents-")));
});

afterEach(() => {
  setProjectTrusted(false);
  rmSync(tmp, { recursive: true, force: true });
});

function makePackage(name: string, manifest: unknown, files: Record<string, string> = {}): string {
  const root = join(tmp, name);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, ".."), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

const declares = (...entries: unknown[]) => ({ name: "p", pi: { subagents: { agents: entries } } });
const rows = (...paths: string[]): (() => ConfiguredPackageRow[]) => () =>
  paths.map((installedPath) => ({ source: installedPath, scope: "user" as const, installedPath }));

describe("readSubagentManifest", () => {
  it("reads only pi.subagents.agents as strings", () => {
    expect(readSubagentManifest(declares("./agents"))).toEqual(["./agents"]);
  });

  it("ignores other spellings", () => {
    expect(readSubagentManifest({ "pi-subagents": { agents: ["./agents"] } })).toBeUndefined();
    expect(readSubagentManifest({ pi: { subagents: ["./agents"] } })).toBeUndefined();
  });

  it("rejects a non-string entry", () => {
    expect(readSubagentManifest(declares("./agents", 3))).toBeUndefined();
  });
});

describe("packageAgentDirs (injected lister)", () => {
  it("loads a declared directory", () => {
    const root = makePackage("a", declares("./agents"), { "agents/x.md": "x" });
    expect(packageAgentDirs(tmp, rows(root))).toEqual([{ dir: join(root, "agents"), root }]);
  });

  it("ignores other spellings and non-string entries", () => {
    const a = makePackage("a", { "pi-subagents": { agents: ["./agents"] } }, { "agents/x.md": "x" });
    const b = makePackage("b", { pi: { subagents: ["./agents"] } }, { "agents/x.md": "x" });
    const c = makePackage("c", declares("./agents", 3), { "agents/x.md": "x" });
    expect(packageAgentDirs(tmp, rows(a, b, c))).toEqual([]);
  });

  it("refuses a parent path and keeps the rest", () => {
    const root = makePackage("a", declares("../../.ssh", "./agents"), { "agents/x.md": "x" });
    expect(packageAgentDirs(tmp, rows(root))).toEqual([{ dir: join(root, "agents"), root }]);
  });

  it("refuses a symlinked directory out of the package", () => {
    const outside = join(tmp, "outside");
    mkdirSync(outside);
    const root = makePackage("a", declares("./agents"));
    symlinkSync(outside, join(root, "agents"));
    expect(packageAgentDirs(tmp, rows(root))).toEqual([]);
  });

  it("contributes nothing for a missing directory", () => {
    const root = makePackage("a", declares("./nope"));
    expect(packageAgentDirs(tmp, rows(root))).toEqual([]);
  });

  it("contributes nothing for a malformed manifest but keeps other packages", () => {
    const bad = makePackage("bad", "{not json");
    const good = makePackage("good", declares("./agents"), { "agents/x.md": "x" });
    expect(packageAgentDirs(tmp, rows(bad, good))).toEqual([{ dir: join(good, "agents"), root: good }]);
  });

  it("returns nothing when the package API throws", () => {
    expect(
      packageAgentDirs(tmp, () => {
        throw new Error("boom");
      }),
    ).toEqual([]);
  });

  it("reads each install root once", () => {
    const root = makePackage("a", declares("./agents"), { "agents/x.md": "x" });
    const lister = () => [
      { source: "g", scope: "user" as const, installedPath: root },
      { source: "p", scope: "user" as const, installedPath: root },
    ];
    expect(packageAgentDirs(tmp, lister)).toHaveLength(1);
  });

  it("hides project-scope packages until the project is trusted", () => {
    const root = makePackage("a", declares("./agents"), { "agents/x.md": "x" });
    const lister = () => [{ source: root, scope: "project" as const, installedPath: root }];
    expect(packageAgentDirs(tmp, lister)).toEqual([]);
    setProjectTrusted(true);
    expect(packageAgentDirs(tmp, lister)).toHaveLength(1);
  });
});

describe("builtinAgentDirs", () => {
  it("reads the executor's own manifest", () => {
    const dirs = builtinAgentDirs();
    expect(dirs).toHaveLength(1);
    expect(dirs[0]!.dir).toBe(join(dirs[0]!.root, "agents"));
  });
});

describe("packageAgentDirs (real pi package manager)", () => {
  const saved = { dir: process.env.PI_CODING_AGENT_DIR };

  afterEach(() => {
    if (saved.dir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved.dir;
  });

  function setup() {
    const agentDir = join(tmp, "agent-home");
    const project = join(tmp, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(project, ".pi"), { recursive: true });
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const globalPkg = makePackage("global-pkg", declares("./agents"), { "agents/g.md": "g" });
    const projectPkg = makePackage("project-pkg", declares("./agents"), { "agents/p.md": "p" });
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: [globalPkg] }));
    writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ packages: [projectPkg, globalPkg] }));
    return { project, globalPkg, projectPkg };
  }

  it("lists both scopes when trusted, global package once", () => {
    const { project, globalPkg, projectPkg } = setup();
    setProjectTrusted(true);
    const roots = packageAgentDirs(project).map((d) => d.root);
    expect(roots.sort()).toEqual([globalPkg, projectPkg].sort());
  });

  it("drops project-scope packages when untrusted", () => {
    const { project, globalPkg } = setup();
    setProjectTrusted(false);
    expect(packageAgentDirs(project).map((d) => d.root)).toEqual([globalPkg]);
  });
});

describe("project trust seeding", () => {
  const saved = process.env.PI_CODING_AGENT_DIR;

  afterEach(() => {
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved;
  });

  function trustedProject(decision: boolean | null) {
    const agentDir = join(tmp, "agent-home");
    const project = join(tmp, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(join(project, ".pi"), { recursive: true });
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const pkg = makePackage("project-pkg", declares("./agents"), { "agents/p.md": "p" });
    writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ packages: [pkg] }));
    if (decision !== null) new ProjectTrustStore(agentDir).set(project, decision);
    return project;
  }

  it("includes project packages after seeding from a saved trust decision", () => {
    const project = trustedProject(true);
    seedProjectTrust(project);
    expect(packageAgentDirs(project)).toHaveLength(1);
  });

  it("excludes them when the saved decision is untrusted", () => {
    const project = trustedProject(false);
    seedProjectTrust(project);
    expect(packageAgentDirs(project)).toEqual([]);
  });

  it("lets the session answer win over the saved decision", () => {
    const project = trustedProject(true);
    seedProjectTrust(project);
    setProjectTrusted(false);
    expect(packageAgentDirs(project)).toEqual([]);
  });
});

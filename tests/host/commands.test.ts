import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { CHILDREN_KEY } from "../../src/host/child.ts";
import {
  formatStatus,
  parseJevArgs,
  runJev,
  usageText,
  type JevArgs,
} from "../../src/host/commands.ts";
import type { Exec } from "../../src/host/review-cli.ts";
import { buildSnapshot, type Snapshot } from "../../src/host/readiness.ts";
import type { Config, ConfigRead } from "../../src/store/config.ts";
import { DECISION_FEATURES, FEATURES } from "../../src/store/defaults.ts";
import { readState, type State, type StateRead } from "../../src/store/state-file.ts";
import { tempDir } from "../helpers.ts";

function snap(
  o: {
    config?: ConfigRead;
    stateRead?: StateRead;
    state?: State;
    env?: Record<string, string | undefined>;
    tools?: string[];
  } = {},
): Snapshot {
  return buildSnapshot({
    configRead: o.config ?? { kind: "ok", present: true, config: {} as Config },
    stateRead: o.stateRead ?? { kind: "ok", state: o.state ?? {} },
    env: o.env ?? { TYPESAFE_API_KEY: "k" },
    toolNames: o.tools ?? ["subagent"],
  });
}

describe("parseJevArgs", () => {
  const usage: JevArgs = { kind: "usage" };
  test("empty and blank are status", () => {
    expect(parseJevArgs("")).toEqual({ kind: "status" });
    expect(parseJevArgs("   ")).toEqual({ kind: "status" });
  });
  test("set", () => {
    expect(parseJevArgs("skills off")).toEqual({ kind: "set", feature: "skills", on: false });
    expect(parseJevArgs("status on")).toEqual({ kind: "set", feature: "status", on: true });
  });
  test("all and reset", () => {
    expect(parseJevArgs("all off")).toEqual({ kind: "all", on: false });
    expect(parseJevArgs("all on")).toEqual({ kind: "all", on: true });
    expect(parseJevArgs("reset")).toEqual({ kind: "reset" });
  });
  test("cli-review", () => {
    expect(parseJevArgs("cli-review opencode")).toEqual({ kind: "cli-review", cli: "opencode" });
    expect(parseJevArgs("cli-review codex default high")).toEqual({
      kind: "cli-review",
      cli: "codex",
      effort: "high",
    });
    expect(parseJevArgs("cli-review codex luna default")).toEqual({
      kind: "cli-review",
      cli: "codex",
      model: "luna",
    });
  });
  for (const bad of [
    "cli-review",
    "cli-review claude",
    "cli-review Codex",
    "cli-review codex luna high now",
    "mode premium",
    "colors off",
    "skills maybe",
    "skills off now",
    "Skills off",
    "reset now",
    "skills",
    "all",
    "status",
  ]) {
    test(`usage: ${bad}`, () => expect(parseJevArgs(bad)).toEqual(usage));
  }
});

describe("usageText", () => {
  const text = usageText();
  test("lists the forms", () => {
    for (const f of ["/jev", "/jev <feature> on|off", "/jev all on|off", "/jev reset", ...FEATURES])
      expect(text).toContain(f);
  });
  test("lists no later forms", () => {
    for (const line of text.split("\n"))
      for (const p of ["/jev mode", "/jev tune", "/jev remove", "/jev slot"])
        expect(line.trimStart().startsWith(p)).toBe(false);
  });
  test("lists the cli-review form", () => {
    expect(text).toContain("  /jev cli-review <codex|opencode> [model|default] [effort|default]");
  });
});

describe("formatStatus", () => {
  test("default", () => {
    const text = formatStatus(snap());
    expect(text).toContain("Jev · standard");
    expect(text).toContain("mode: standard");
    for (const f of FEATURES)
      expect(text).toMatch(new RegExp(`${f}:? +${f === "verbose" ? "off" : "on"}`));
    expect(text).toContain("TYPESAFE_API_KEY");
    expect(text).toMatch(/TYPESAFE_API_KEY[^\n]*\bset\b/);
    expect(text).not.toContain("not set");
    expect(text).not.toContain("no executor");
  });
  test("cli review default and set values", () => {
    expect(formatStatus(snap())).toContain("cli review: codex (CLI defaults)");
    const state: State = { cliReview: { cli: "codex", model: "luna", effort: "high" } };
    const lines = formatStatus(snap({ state })).split("\n");
    expect(lines).toContain("cli review: codex (model luna, effort high)");
    expect(lines.indexOf("cli review: codex (model luna, effort high)")).toBe(
      lines.findIndex((l) => l.startsWith("  verbose:")) + 1,
    );
    const m = formatStatus(snap({ state: { cliReview: { cli: "opencode", model: "p/m" } } }));
    expect(m).toContain("cli review: opencode (model p/m)");
    const e = formatStatus(snap({ state: { cliReview: { cli: "opencode", effort: "high" } } }));
    expect(e).toContain("cli review: opencode (effort high)");
  });
  test("key not set", () => {
    expect(formatStatus(snap({ env: {} }))).toContain("not set");
  });
  test("never the key value", () => {
    expect(formatStatus(snap({ env: { TYPESAFE_API_KEY: "test-key" } }))).not.toContain("test-key");
  });
  test("no executor", () => {
    const text = formatStatus(snap({ tools: [] }));
    expect(text).toContain("no executor");
    expect(text).toContain("worker routing and tool assessment are off");
  });
  test("config issue", () => {
    const text = formatStatus(
      snap({
        config: {
          kind: "invalid",
          issues: [{ path: "classifier.timeoutMs", message: "bad" }],
        } as ConfigRead,
      }),
    );
    expect(text).toContain("config error");
    expect(text).toContain("classifier.timeoutMs");
  });
  test("malformed state", () => {
    const text = formatStatus(
      snap({
        stateRead: {
          kind: "malformed",
          state: {},
          issues: [
            { path: "switches.skills", message: "bad" },
            { path: "mode", message: "bad" },
          ],
        },
      }),
    );
    expect(text).toContain("switches.skills");
    expect(text).toContain("mode");
  });
});

type Rec = { notes: [string, string | undefined][]; widgets: unknown[][] };

function fakeCtx(hasUI = true, sessionId = "main") {
  const rec: Rec = { notes: [], widgets: [] };
  const ctx = {
    hasUI,
    mode: "rpc",
    ui: {
      notify: (m: string, t?: string) => rec.notes.push([m, t]),
      setWidget: (...a: unknown[]) => rec.widgets.push(a),
    },
    sessionManager: { getSessionId: () => sessionId },
  } as unknown as ExtensionCommandContext;
  return { ctx, rec };
}

let dirs: string[] = [];
function jevDir(): string {
  const d = join(tempDir("jev-cmd-"), "jev");
  dirs.push(d);
  return d;
}
afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[CHILDREN_KEY];
  for (const d of dirs) {
    try {
      chmodSync(join(d, "state.json"), 0o600);
    } catch {}
    rmSync(join(d, ".."), { recursive: true, force: true });
  }
  dirs = [];
});

const load = (dir: string) => () =>
  buildSnapshot({
    configRead: { kind: "ok", present: false, config: {} as Config },
    stateRead: readState(dir),
    env: { TYPESAFE_API_KEY: "k" },
    toolNames: ["subagent"],
  });

const noExec: Exec = async () => {
  throw new Error("exec must not be called");
};

async function run(args: string, dir: string, c = fakeCtx(), exec: Exec = noExec) {
  await runJev(args, c.ctx, { dir, load: load(dir), exec });
  return c.rec;
}

const switches = (dir: string) => (readState(dir).state as State).switches;

describe("runJev", () => {
  test("skills off then on", async () => {
    const dir = jevDir();
    const rec = await run("skills off", dir);
    expect(switches(dir)?.skills).toBe(false);
    expect(existsSync(dir)).toBe(true);
    expect(rec.notes.map((n) => n[1])).toEqual(["info"]);
    expect(rec.widgets).toHaveLength(1);
    await run("skills on", dir);
    expect(switches(dir)?.skills).toBe(true);
  });

  test("plain status writes nothing, notifies and redraws", async () => {
    const dir = jevDir();
    const rec = await run("", dir);
    expect(existsSync(dir)).toBe(false);
    expect(rec.notes.map((n) => n[1])).toEqual(["info"]);
    expect(rec.widgets).toHaveLength(1);
  });

  test("status off clears the widget but still notifies", async () => {
    const dir = jevDir();
    const rec = await run("status off", dir);
    expect(rec.widgets).toHaveLength(1);
    expect(rec.widgets[0]![0]).toBe("jev");
    expect(rec.widgets[0]![1]).toBeUndefined();
    expect(rec.notes.map((n) => n[1])).toEqual(["info"]);
  });

  test("all off then all on", async () => {
    const dir = jevDir();
    await run("all off", dir);
    const sw = switches(dir)!;
    for (const f of DECISION_FEATURES) expect(sw[f]).toBe(false);
    expect("status" in sw).toBe(false);
    expect("verbose" in sw).toBe(false);
    await run("all on", dir);
    for (const f of DECISION_FEATURES) expect(switches(dir)![f]).toBe(true);
  });

  test("reset clears the state", async () => {
    const dir = jevDir();
    await run("skills off", dir);
    const read = readState(dir).state as State;
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({ version: 1, ...read, mode: "premium" }),
    );
    await run("reset", dir);
    expect(readState(dir)).toEqual({ kind: "ok", state: {} });
  });

  test("malformed state is moved aside", async () => {
    const dir = jevDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "state.json"), "{nope");
    await run("skills off", dir);
    expect(existsSync(join(dir, "state.json.bad"))).toBe(true);
    expect(readState(dir)).toEqual({ kind: "ok", state: { switches: { skills: false } } });
  });

  test.skipIf(process.getuid?.() === 0)("unreadable state is refused", async () => {
    const dir = jevDir();
    await run("skills off", dir);
    chmodSync(join(dir, "state.json"), 0o000);
    const rec = await run("skills on", dir);
    expect(rec.notes).toHaveLength(1);
    expect(rec.notes[0]![1]).toBe("error");
    expect(rec.notes[0]![0]).toContain("EACCES");
    expect(rec.widgets).toHaveLength(0);
    expect(existsSync(join(dir, "state.json.bad"))).toBe(false);
  });

  test("later-group command gets usage as warning", async () => {
    const dir = jevDir();
    const rec = await run("mode premium", dir);
    expect(rec.notes).toEqual([[usageText(), "warning"]]);
    expect(existsSync(join(dir, "state.json"))).toBe(false);
  });

  test("no UI: silent but still writes", async () => {
    const dir = jevDir();
    const rec = await run("skills off", dir, fakeCtx(false));
    expect(rec.notes).toHaveLength(0);
    expect(rec.widgets).toHaveLength(0);
    expect(switches(dir)?.skills).toBe(false);
  });

  test("child session does nothing", async () => {
    const dir = jevDir();
    (globalThis as Record<symbol, unknown>)[CHILDREN_KEY] = new Set(["kid"]);
    const rec = await run("skills off", dir, fakeCtx(true, "kid"));
    expect(rec.notes).toHaveLength(0);
    expect(rec.widgets).toHaveLength(0);
    expect(existsSync(join(dir, "state.json"))).toBe(false);
  });

  test("throwing load is reported, not thrown", async () => {
    const dir = jevDir();
    const c = fakeCtx();
    await runJev("", c.ctx, {
      dir,
      exec: noExec,
      load: () => {
        throw new TypeError("boom");
      },
    });
    expect(c.rec.notes.map((n) => n[1])).toEqual(["error"]);
  });

  test("throwing notify never escapes the handler", async () => {
    const dir = jevDir();
    const c = fakeCtx();
    (c.ctx.ui as { notify: unknown }).notify = () => {
      throw new Error("ui gone");
    };
    await runJev("", c.ctx, {
      dir,
      exec: noExec,
      load: () => {
        throw new TypeError("boom");
      },
    });
    await runJev("mode premium", c.ctx, { dir, load: load(dir), exec: noExec });
  });
});

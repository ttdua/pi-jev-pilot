import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { CHILDREN_KEY } from "../../../src/host/platform/child.ts";
import {
  formatStatus,
  parseJevArgs,
  runJev as runJevWith,
  usageText,
  type JevArgs,
} from "../../../src/host/commands/jev.ts";
import { statusText, type Decision, type Tally } from "../../../src/host/status/line.ts";
import type { Mode } from "../../../src/store/defaults.ts";
import { buildSnapshot, type Snapshot } from "../../../src/host/platform/readiness.ts";
import type { Config, ConfigRead } from "../../../src/store/config.ts";
import { DECISION_FEATURES, FEATURES } from "../../../src/store/defaults.ts";
import { readLocalMode } from "../../../src/store/local-mode.ts";
import { MAIN_CWD_KEY, mainCwd, setMainCwd } from "../../../src/host/platform/main-cwd.ts";
import { readState, type State, type StateRead } from "../../../src/store/state-file.ts";
import { buildWorkerQuestions } from "../../../src/jev/questions.ts";
import { readConfig } from "../../../src/store/config.ts";
import type { TuningRead } from "../../../src/store/tuning-file.ts";
import { tempDir } from "../../helpers.ts";
import type { WindowEntry } from "../../../src/policy/worker/cutpoints.ts";
import type { TierName } from "../../../src/policy/launch.ts";

function snap(
  o: {
    config?: ConfigRead;
    stateRead?: StateRead;
    state?: State;
    env?: Record<string, string | undefined>;
    tools?: string[];
    executor?: Snapshot["executor"];
    tuningRead?: TuningRead;
    sessionMode?: Mode;
  } = {},
): Snapshot {
  return buildSnapshot({
    configRead: o.config ?? {
      kind: "ok",
      present: true,
      notices: [],
      deprecated: [],
      config: {} as Config,
    },
    stateRead: o.stateRead ?? { kind: "ok", state: o.state ?? {} },
    env: o.env ?? { TYPESAFE_API_KEY: "k" },
    toolNames: o.tools ?? ["subagent"],
    ...(o.executor === undefined ? {} : { executor: o.executor }),
    ...(o.tuningRead === undefined ? {} : { tuningRead: o.tuningRead }),
    ...(o.sessionMode === undefined
      ? {}
      : { localModeRead: { kind: "ok" as const, mode: o.sessionMode } }),
  });
}

describe("parseJevArgs", () => {
  const usage: JevArgs = { kind: "usage" };
  test("empty and blank are status", () => {
    expect(parseJevArgs("")).toEqual({ kind: "status" });
    expect(parseJevArgs("   ")).toEqual({ kind: "status" });
  });
  test("tune forms", () => {
    expect(parseJevArgs("tune")).toEqual({ kind: "tune", sub: "report" });
    expect(parseJevArgs("tune off")).toEqual({ kind: "tune", sub: "off" });
    for (const w of ["undo", "reset", "on"])
      expect(parseJevArgs(`tune ${w}`)).toEqual({
        kind: "tune",
        sub: w as "undo",
      });
    for (const bad of ["tune apply", "tune Undo", "tune undo now"])
      expect(parseJevArgs(bad)).toEqual(usage);
  });
  test("set", () => {
    expect(parseJevArgs("skills off")).toEqual({
      kind: "set",
      feature: "skills",
      on: false,
    });
    expect(parseJevArgs("status on")).toEqual({
      kind: "set",
      feature: "status",
      on: true,
    });
  });
  test("mode", () => {
    expect(parseJevArgs("mode premium")).toEqual({
      kind: "mode",
      mode: "premium",
      target: "local",
    });
    expect(parseJevArgs("mode premium global")).toEqual({
      kind: "mode",
      mode: "premium",
      target: "global",
    });
    expect(parseJevArgs("mode clear")).toEqual({ kind: "mode-clear" });
  });
  test("session forms are no longer modes", () => {
    for (const gone of ["mode premium session", "mode session off"])
      expect(parseJevArgs(gone)).toEqual(usage);
  });
  test("all and reset", () => {
    expect(parseJevArgs("all off")).toEqual({ kind: "all", on: false });
    expect(parseJevArgs("all on")).toEqual({ kind: "all", on: true });
    expect(parseJevArgs("reset")).toEqual({ kind: "reset" });
  });
  for (const bad of [
    "cli-review on",
    "cli-review off",
    "cli-review",
    "cli-review codex",
    "cli-review opencode p/m high",
    "mode",
    "mode quality",
    "mode Premium",
    "mode premium now",
    "mode premium Global",
    "mode global",
    "mode clear now",
    "mode Clear",
    "mode premium session",
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
  test("states the decision feature count", () => {
    expect(text).toContain("five decision features");
    expect(text).not.toContain("six");
  });
  test("Usage lists the tune form", () => {
    expect(text).toContain("/jev tune [undo|reset|on|off]");
  });
  test("Usage lists the slot forms", () => {
    expect(text).toContain("  /jev <slot> <provider/model> [when <text>]");
    expect(text).toContain("  /jev <slot>");
    expect(text).toContain("  /jev remove <slot>");
  });
  test("Usage lists the mode form", () => {
    expect(text).toContain("/jev mode budget|standard|premium [global]");
    expect(text).toContain("/jev mode clear");
    expect(text).not.toContain("(session");
  });
  test("Usage has no cli-review line", () => {
    expect(text).not.toContain("cli-review");
    expect(text).toContain("reset switches and mode");
  });
});

describe("formatStatus", () => {
  test("Malformed directory mode reported", () => {
    const issues = [{ path: "", message: "jev-mode.json is not valid JSON" }];
    const text = formatStatus(
      buildSnapshot({
        configRead: {
          kind: "ok",
          present: true,
          notices: [],
          deprecated: [],
          config: {} as Config,
        },
        stateRead: { kind: "ok", state: {} },
        env: { TYPESAFE_API_KEY: "k" },
        toolNames: ["subagent"],
        localModeRead: { kind: "malformed", issues },
      }),
    );
    expect(text).toContain("problems:");
    expect(text).toContain("mode: standard");
    expect(text).toContain("  local mode (malformed) (file): jev-mode.json is not valid JSON");
  });
  test("Malformed tuning reported", () => {
    const issues = [{ path: "", message: "tuning.json is not valid JSON" }];
    const text = formatStatus(snap({ tuningRead: { kind: "malformed", record: {}, issues } }));
    expect(text).toContain("problems:");
    expect(text).toContain("  tuning (malformed) (file): tuning.json is not valid JSON");
  });

  test("default", () => {
    const text = formatStatus(
      snap({
        executor: {
          kind: "present",
          implementation: "@ttdua/pi-subagents",
          launchPolicy: true,
          agentRegistry: true,
        },
      }),
    );
    expect(text).toContain("executor: @ttdua/pi-subagents");
    expect(text).toContain("Jev · standard");
    expect(text).toContain("mode: standard");
    for (const f of FEATURES)
      expect(text).toMatch(new RegExp(`${f}:? +${f === "verbose" ? "off" : "on"}`));
    expect(text).toContain("TYPESAFE_API_KEY");
    expect(text).toMatch(/TYPESAFE_API_KEY[^\n]*\bset\b/);
    expect(text).not.toContain("not set");
    expect(text).not.toContain("no executor");
  });
  test("Default status has no cli review line", () => {
    const lines = formatStatus(snap()).split("\n");
    expect(lines.some((l) => l.startsWith("cli review"))).toBe(false);
  });
  test("key not set", () => {
    expect(formatStatus(snap({ env: {} }))).toContain("not set");
  });
  test("never the key value", () => {
    expect(formatStatus(snap({ env: { TYPESAFE_API_KEY: "test-key" } }))).not.toContain("test-key");
  });
  test("no executor", () => {
    const text = formatStatus(snap({ tools: [] }));
    expect(text).toContain("executor: no executor; worker routing is off");
  });
  describe("mix", () => {
    const entries = (n: number, basic: number, broad: number, deep: number): WindowEntry[] => {
      const tiers = [
        ...Array<TierName>(basic).fill("basic"),
        ...Array<TierName>(broad).fill("broad"),
        ...Array<TierName>(deep).fill("deep"),
      ];
      const frontier = n - tiers.length;
      return [...tiers, ...Array<TierName>(frontier).fill("frontier")].map((decided) => ({
        score: 0.5,
        effort: "high",
        decided,
      }));
    };
    test("Mix with a full window", () => {
      const lines = formatStatus(snap(), undefined, entries(200, 38, 110, 48)).split("\n");
      expect(lines).toContain(
        "mix (last 200, standard): basic 19% / broad 55% / deep 24% / frontier 2% · target 20/53/26/≤1",
      );
      expect(lines).not.toContain("cut points: seed");
    });
    test("Directory mode in the report", () => {
      const text = formatStatus(
        snap({ state: { mode: "standard" }, sessionMode: "premium" }),
        undefined,
        entries(120, 60, 48, 12),
      );
      expect(text).toContain("mode: premium (this directory; global standard)");
      expect(text).toMatch(/mix \(last 120, premium\):.* target 0\/50\/47\/≤3/);
    });
    test("Budget target shown", () => {
      const text = formatStatus(
        snap({ state: { mode: "budget" } }),
        undefined,
        entries(120, 60, 48, 12),
      );
      expect(text).toContain("mix (last 120, budget):");
      expect(text).toContain(" · target 50/40/10/≤0");
      expect(text).not.toContain("cut points: seed");
    });
    test("short window shows seed", () => {
      const lines = formatStatus(snap(), undefined, entries(40, 8, 20, 10)).split("\n");
      const i = lines.findIndex((l) => l.startsWith("mix (last 40, "));
      expect(i).toBeGreaterThanOrEqual(0);
      expect(lines[i + 1]).toBe("cut points: seed");
    });
    test("empty window", () => {
      const lines = formatStatus(snap(), undefined, []).split("\n");
      const i = lines.indexOf("mix: no routed workers yet");
      expect(i).toBeGreaterThanOrEqual(0);
      expect(lines[i + 1]).toBe("cut points: seed");
    });
    test("no executor: no mix line", () => {
      const text = formatStatus(snap({ tools: [] }), undefined, entries(200, 38, 110, 48));
      expect(text).not.toContain("mix");
    });
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

const MODELS = [
  { provider: "fixture", id: "fixture-review", reasoning: true },
  { provider: "fixture", id: "fixture-fast", reasoning: true },
];
const modelRegistry = {
  find: (p: string, id: string) => MODELS.find((m) => m.provider === p && m.id === id),
  hasConfiguredAuth: () => true,
  getAvailable: () => MODELS,
} as unknown as ModelRegistry;

function fakeCtx(hasUI = true, sessionId = "main", cwd: string = freshCwd()) {
  const rec: Rec = { notes: [], widgets: [] };
  const ctx = {
    cwd,
    hasUI,
    mode: "rpc",
    ui: {
      notify: (m: string, t?: string) => rec.notes.push([m, t]),
      setWidget: (...a: unknown[]) => rec.widgets.push(a),
    },
    sessionManager: { getSessionId: () => sessionId, getBranch: () => [] },
    modelRegistry,
  } as unknown as ExtensionCommandContext;
  return { ctx, rec };
}

let dirs: string[] = [];
let cwds: string[] = [];
function freshCwd(): string {
  const d = tempDir("jev-cwd-");
  cwds.push(d);
  return d;
}
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
  for (const d of cwds) {
    try {
      chmodSync(join(d, ".pi"), 0o700);
    } catch {}
    rmSync(d, { recursive: true, force: true });
  }
  cwds = [];
});

const load = (dir: string) => (cwd: string) =>
  buildSnapshot({
    configRead: readConfig(dir),
    stateRead: readState(dir),
    localModeRead: readLocalMode(cwd),
    env: { TYPESAFE_API_KEY: "k" },
    toolNames: ["subagent"],
  });

const runJev = runJevWith;

const noDecision = (): Decision | undefined => undefined;

async function run(
  args: string,
  dir: string,
  c = fakeCtx(),
  decision: () => Decision | undefined = noDecision,
  tally?: () => Tally,
  overlay?: () => string | undefined,
) {
  await runJev(args, c.ctx, {
    dir,
    load: load(dir),
    decision,
    ...(tally ? { tally } : {}),
    ...(overlay ? { overlay } : {}),
  });
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

  test("Legacy frontier slot reported first at the command", async () => {
    const dir = jevDir();
    mkdirSync(dir, { recursive: true });
    const cfg = {
      crew: {
        slots: [
          { name: "frontier", model: "fixture/fixture-main", when: "Legacy." },
          { name: "reviewer", model: "fixture/fixture-review", when: "Reviews." },
        ],
      },
    };
    writeFileSync(join(dir, "config.json"), JSON.stringify(cfg));
    const before = readFileSync(join(dir, "config.json"), "utf8");
    const rec = await run("reviewer fixture/unknown extra", dir);
    const errors = rec.notes.filter((n) => n[1] === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.[0]).toContain("rename");
    expect(errors[0]?.[0]).not.toContain("usage");
    expect(readFileSync(join(dir, "config.json"), "utf8")).toBe(before);
  });

  test("Remove with extra words is usage without a frontier slot", async () => {
    const dir = jevDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "config.json"),
      JSON.stringify({
        crew: { slots: [{ name: "reviewer", model: "fixture/fixture-review", when: "R." }] },
      }),
    );
    const before = readFileSync(join(dir, "config.json"), "utf8");
    const rec = await run("remove reviewer now", dir);
    expect(rec.notes[0]?.[0]).toContain("Usage:");
    expect(readFileSync(join(dir, "config.json"), "utf8")).toBe(before);
  });

  test("Frontier is the switch", async () => {
    const dir = jevDir();
    await run("frontier off", dir);
    expect(switches(dir)?.frontier).toBe(false);
    expect(existsSync(join(dir, "config.json"))).toBe(false);
  });

  test("Deprecated expert command", async () => {
    const dir = jevDir();
    const rec = await run("expert off", dir);
    expect(switches(dir)).toEqual({ frontier: false });
    expect(rec.notes[0]?.[0]).toContain("notice: /jev expert is deprecated; use /jev frontier");
    expect(rec.notes[0]?.[0]).toContain("frontier: off");
    const again = await run("frontier on", dir);
    expect(again.notes.at(-1)?.[0]).not.toContain("deprecated");
  });

  test("redraw keeps the decision suffix; effort off drops it", async () => {
    const dir = jevDir();
    const decision = (): Decision => ({
      effort: { kind: "level", level: "high" },
    });
    const a = await run("skills off", dir, fakeCtx(), decision);
    expect(a.widgets[0]![1]).toEqual(["Jev · standard · high"]);
    const b = await run("effort off", dir, fakeCtx(), decision);
    expect(b.widgets[0]![1]).toEqual(["Jev · standard"]);
  });

  test("empty tally", async () => {
    const rec = await run("", jevDir());
    expect(
      rec.notes[0]![0].endsWith(
        "session:\n  prompts 0\n  workers 0\n  worker tokens 0\n  fallbacks 0",
      ),
    ).toBe(true);
  });

  test("tally after work", async () => {
    const t: Tally = {
      prompts: 2,
      workers: 1,
      byModel: [["fixture/fast", 1]],
      unrouted: 0,
      workerTokens: 120,
      fallbacks: 0,
    };
    const rec = await run("", jevDir(), fakeCtx(), noDecision, () => t);
    expect(
      rec.notes[0]![0].endsWith(
        "session:\n  prompts 2\n  workers 1 (fixture/fast 1)\n  worker tokens 120\n  fallbacks 0",
      ),
    ).toBe(true);
  });

  test("tally kept across /jev", async () => {
    const dir = jevDir();
    const rec = await run(
      "skills off",
      dir,
      fakeCtx(),
      noDecision,
      undefined,
      () => "10 prompts · 0 workers · 0 fallbacks",
    );
    expect(rec.widgets[0]![1]).toEqual(["Jev · standard · 10 prompts · 0 workers · 0 fallbacks"]);
    expect(rec.notes[0]![0].split("\n")[0]).toBe(statusText(load(dir)("main")));
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

  test("review is not a feature switch", async () => {
    for (const a of ["review off", "review on"]) expect(parseJevArgs(a)).toEqual({ kind: "usage" });
    const dir = jevDir();
    await run("skills off", dir);
    const before = readFileSync(join(dir, "state.json"), "utf8");
    const rec = await run("review off", dir);
    expect(rec.notes.map((n) => n[1])).toEqual(["warning"]);
    expect(rec.notes[0]![0]).toContain("/jev <feature> on|off");
    expect(readFileSync(join(dir, "state.json"), "utf8")).toBe(before);
  });

  test("status lists seven features", async () => {
    const dir = jevDir();
    const rec = await run("", dir);
    const text = rec.notes[0]![0];
    const lines = text.split("\n");
    const start = lines.indexOf("features:") + 1;
    const names = lines.slice(start, start + 7).map((l) => l.trim().split(":")[0]);
    expect(lines[start + 7]).not.toMatch(/^cli review/);
    expect(names).toEqual([
      "effort",
      "subagents",
      "skills",
      "strategy",
      "frontier",
      "status",
      "verbose",
    ]);
    expect(text).not.toContain("  review:");
  });

  test("tools is not a feature", async () => {
    const dir = jevDir();
    await run("skills off", dir);
    const before = readFileSync(join(dir, "state.json"), "utf8");
    const rec = await run("tools off", dir);
    expect(rec.notes).toEqual([[usageText(), "warning"]]);
    expect(readFileSync(join(dir, "state.json"), "utf8")).toBe(before);
  });

  test("deprecated tools section reported", async () => {
    const dir = jevDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ tools: { anything: 1 } }));
    const text = (await run("", dir)).notes[0]![0];
    expect(text).toContain("problems:\n  deprecated: config tools is ignored");
    expect(text).not.toContain("config error");
    writeFileSync(join(dir, "config.json"), JSON.stringify({}));
    const clean = (await run("", dir)).notes[0]![0];
    expect(text.split("\n")[0]).toBe(clean.split("\n")[0]);
    expect(clean).not.toContain("deprecated:");
  });

  test("invalid config with tools lists no deprecation", async () => {
    const dir = jevDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ tools: {}, effort: 5 }));
    const text = (await run("", dir)).notes[0]![0];
    expect(text).toContain("Jev · config error");
    expect(text).toContain("problems:");
    expect(text).toContain("  config effort: expected an object");
    expect(text).not.toContain("deprecated:");
  });

  test("all off then all on", async () => {
    const dir = jevDir();
    await run("all off", dir);
    const sw = switches(dir)!;
    expect(DECISION_FEATURES).toHaveLength(5);
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
    expect(readState(dir)).toEqual({
      kind: "ok",
      state: { switches: { skills: false } },
    });
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

  test("Command from a later work group", async () => {
    const dir = jevDir();
    const c = fakeCtx();
    await runJev("tune", c.ctx, {
      dir,
      load: load(dir),
      decision: noDecision,
      tune: () => ({ ok: true, message: "R" }),
    });
    expect(c.rec.notes).toEqual([["R", "info"]]);
    expect(existsSync(join(dir, "state.json"))).toBe(false);
  });

  test("tune error outcome is an error; no dep is usage", async () => {
    const dir = jevDir();
    const c = fakeCtx();
    await runJev("tune undo", c.ctx, {
      dir,
      load: load(dir),
      decision: noDecision,
      tune: (sub) => ({ ok: false, message: `no ${sub}` }),
    });
    expect(c.rec.notes).toEqual([["no undo", "error"]]);
    const rec = await run("tune", dir);
    expect(rec.notes).toEqual([[usageText(), "warning"]]);
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
      decision: noDecision,
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
      decision: noDecision,
      load: () => {
        throw new TypeError("boom");
      },
    });
    await runJev("tune", c.ctx, {
      dir,
      load: load(dir),
      decision: noDecision,
    });
  });
});

describe("runJev slots", () => {
  const ADD = "reviewer fixture/fixture-review when Code review.";
  const slotsOf = (dir: string) => load(dir)("main").settings.crew.slots;
  const offered = (dir: string) =>
    Object.keys(
      buildWorkerQuestions(["basic", "broad", "deep"], {}, slotsOf(dir)).questions["tier"]!
        .criteria!,
    );

  test("Unknown feature", async () => {
    const rec = await run("Colors off", jevDir());
    expect(rec.notes).toEqual([[usageText(), "warning"]]);
  });

  test("Name-shaped typo of a feature", async () => {
    const dir = jevDir();
    const rec = await run("colors off", dir);
    expect(rec.notes).toHaveLength(1);
    expect(rec.notes[0]![1]).toBe("error");
    expect(rec.notes[0]![0]).toContain("not a provider/model");
    expect(rec.notes[0]![0]).toContain(usageText());
    expect(existsSync(join(dir, "config.json"))).toBe(false);
  });

  test("Add, show and remove notify only their message", async () => {
    const dir = jevDir();
    const added = await run(ADD, dir);
    expect(added.notes).toEqual([
      ["slot reviewer: fixture/fixture-review\nwhen: Code review.", "info"],
    ]);
    expect(added.widgets).toHaveLength(0);
    const shown = await run("reviewer", dir);
    expect(shown.notes[0]![0]).toBe("slot reviewer: fixture/fixture-review\nwhen: Code review.");
    const removed = await run("remove reviewer", dir);
    expect(removed.notes).toEqual([["slot reviewer removed", "info"]]);
  });

  test("Print mode", async () => {
    const dir = jevDir();
    const rec = await run(ADD, dir, fakeCtx(false));
    expect(rec.notes).toHaveLength(0);
    expect(slotsOf(dir)).toHaveLength(1);
  });

  test("Child session", async () => {
    const dir = jevDir();
    (globalThis as Record<symbol, unknown>)[CHILDREN_KEY] = new Set(["kid"]);
    const rec = await run(ADD, dir, fakeCtx(true, "kid"));
    expect(rec.notes).toHaveLength(0);
    expect(existsSync(join(dir, "config.json"))).toBe(false);
  });

  test("Next launch sees the slot", async () => {
    const dir = jevDir();
    await run(ADD, dir);
    expect(offered(dir)).toContain("slot::reviewer");
  });

  test("Removed slot not offered", async () => {
    const dir = jevDir();
    await run(ADD, dir);
    await run("remove reviewer", dir);
    expect(offered(dir).some((o) => o.startsWith("slot::"))).toBe(false);
  });
});

describe("runJev directory mode", () => {
  const modeOf = (dir: string) => (readState(dir).state as State).mode;
  const localFile = (cwd: string) => join(cwd, ".pi", "jev-mode.json");
  const localOf = (cwd: string) => {
    const r = readLocalMode(cwd);
    return r.kind === "ok" ? r.mode : r.kind;
  };
  const stateBytes = (dir: string) => readFileSync(join(dir, "state.json"), "utf8");
  const writeLocal = (cwd: string, text: string) => {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(localFile(cwd), text);
  };
  const GLOBAL_NOTE = "directory mode budget still applies here; global mode is now premium";

  test("Set a directory mode", async () => {
    const dir = jevDir();
    const cwd = freshCwd();
    await run("mode standard global", dir);
    const before = stateBytes(dir);
    const rec = await run("mode premium", dir, fakeCtx(true, "main", cwd));
    expect(localOf(cwd)).toBe("premium");
    expect(stateBytes(dir)).toBe(before);
    expect(rec.notes.map((n) => n[1])).toEqual(["info"]);
    expect(rec.notes[0]![0]).toContain("mode: premium (this directory; global standard)");
    expect(rec.widgets[0]![1]).toEqual(["Jev · premium (local)"]);
  });

  test.skipIf(process.getuid?.() === 0)("Set while state is unreadable", async () => {
    const dir = jevDir();
    const cwd = freshCwd();
    await run("mode standard global", dir);
    const before = stateBytes(dir);
    chmodSync(join(dir, "state.json"), 0o000);
    const rec = await run("mode premium", dir, fakeCtx(true, "main", cwd));
    chmodSync(join(dir, "state.json"), 0o600);
    expect(localOf(cwd)).toBe("premium");
    expect(stateBytes(dir)).toBe(before);
    expect(rec.notes.map((n) => n[1])).toEqual(["info"]);
    expect(rec.notes[0]![0]).toContain("state (unreadable)");
    expect(rec.notes[0]![0]).toContain("mode: premium (this directory; global standard)");
  });

  test.skipIf(process.getuid?.() === 0)("Directory not writable", async () => {
    const dir = jevDir();
    const cwd = freshCwd();
    writeFileSync(join(cwd, ".pi"), "not a directory");
    const rec = await run("mode premium", dir, fakeCtx(true, "main", cwd));
    expect(rec.notes).toHaveLength(1);
    expect(rec.notes[0]![1]).toBe("error");
    expect(rec.notes[0]![0]).toContain(".pi/jev-mode.json");
    expect(rec.widgets).toHaveLength(0);
  });

  test("Clear back to the global mode", async () => {
    const dir = jevDir();
    const cwd = freshCwd();
    await run("mode standard global", dir);
    await run("mode premium", dir, fakeCtx(true, "main", cwd));
    const rec = await run("mode clear", dir, fakeCtx(true, "main", cwd));
    expect(existsSync(localFile(cwd))).toBe(false);
    expect(rec.notes[0]![1]).toBe("info");
    expect(rec.notes[0]![0]).toContain("mode: standard");
    expect(rec.notes[0]![0]).not.toContain("(this directory");
    expect(rec.widgets).toHaveLength(1);
  });

  test("Nothing to clear", async () => {
    const dir = jevDir();
    const cwd = freshCwd();
    const rec = await run("mode clear", dir, fakeCtx(true, "main", cwd));
    expect(rec.notes).toEqual([["no directory mode set", "info"]]);
    expect(rec.widgets).toHaveLength(0);
    expect(existsSync(join(cwd, ".pi"))).toBe(false);
  });

  test("Clear removes a damaged file", async () => {
    const dir = jevDir();
    const cwd = freshCwd();
    writeLocal(cwd, "{nope");
    const rec = await run("mode clear", dir, fakeCtx(true, "main", cwd));
    expect(existsSync(localFile(cwd))).toBe(false);
    expect(rec.notes.map((n) => n[1])).toEqual(["info"]);
    expect(rec.notes[0]![0]).not.toBe("no directory mode set");
  });

  test.skipIf(process.getuid?.() === 0)("clear refused keeps the file", async () => {
    const dir = jevDir();
    const cwd = freshCwd();
    await run("mode premium", dir, fakeCtx(true, "main", cwd));
    chmodSync(join(cwd, ".pi"), 0o500);
    const rec = await run("mode clear", dir, fakeCtx(true, "main", cwd));
    chmodSync(join(cwd, ".pi"), 0o700);
    expect(rec.notes).toHaveLength(1);
    expect(rec.notes[0]![1]).toBe("error");
    expect(rec.widgets).toHaveLength(0);
    expect(localOf(cwd)).toBe("premium");
  });

  test("Overwrite a damaged file", async () => {
    const dir = jevDir();
    const cwd = freshCwd();
    writeLocal(cwd, "{nope");
    const rec = await run("mode budget", dir, fakeCtx(true, "main", cwd));
    expect(localOf(cwd)).toBe("budget");
    expect(rec.notes.map((n) => n[1])).toEqual(["info"]);
  });

  test("Plain form targets the directory", async () => {
    const dir = jevDir();
    const cwd = freshCwd();
    await run("mode premium", dir, fakeCtx(true, "main", cwd));
    expect(localOf(cwd)).toBe("premium");
    expect(existsSync(join(dir, "state.json"))).toBe(false);
  });

  test("Set premium", async () => {
    const dir = jevDir();
    await run("skills off", dir);
    const rec = await run("mode premium global", dir);
    expect(modeOf(dir)).toBe("premium");
    expect(switches(dir)?.skills).toBe(false);
    expect(rec.notes.map((n) => n[1])).toEqual(["info"]);
    expect(rec.notes[0]![0]).toContain("mode: premium");
    expect(rec.widgets[0]![1]).toEqual(["Jev · premium"]);
  });

  test("Mode survives a restart", async () => {
    const dir = jevDir();
    await run("mode budget global", dir);
    expect(load(dir)(freshCwd()).settings.mode).toBe("budget");
  });

  test("Back to standard", async () => {
    const dir = jevDir();
    await run("mode premium global", dir);
    const rec = await run("mode standard global", dir);
    expect(modeOf(dir)).toBe("standard");
    expect(rec.notes[0]![0]).toContain("mode: standard");
    expect(rec.widgets[0]![1]).toEqual(["Jev · standard"]);
  });

  test.skipIf(process.getuid?.() === 0)("Refused mode change", async () => {
    const dir = jevDir();
    await run("mode budget global", dir);
    chmodSync(join(dir, "state.json"), 0o000);
    const rec = await run("mode premium global", dir);
    expect(rec.notes).toHaveLength(1);
    expect(rec.notes[0]![1]).toBe("error");
    expect(rec.notes[0]![0]).toContain("EACCES");
    expect(rec.widgets).toHaveLength(0);
    chmodSync(join(dir, "state.json"), 0o600);
    expect(modeOf(dir)).toBe("budget");
  });

  test("Global set keeps the directory mode", async () => {
    const dir = jevDir();
    const cwd = freshCwd();
    await run("mode budget", dir, fakeCtx(true, "main", cwd));
    const rec = await run("mode premium global", dir, fakeCtx(true, "main", cwd));
    expect(modeOf(dir)).toBe("premium");
    expect(localOf(cwd)).toBe("budget");
    expect(rec.notes[0]![0].split("\n")).toContain(GLOBAL_NOTE);
    expect(rec.notes[0]![0].endsWith(GLOBAL_NOTE)).toBe(true);
  });

  test("Global set without a directory mode has no note", async () => {
    const rec = await run("mode premium global", jevDir());
    expect(rec.notes[0]![0]).not.toContain("still applies here");
  });

  test("Reset removes the directory mode", async () => {
    const dir = jevDir();
    const cwd = freshCwd();
    await run("mode premium", dir, fakeCtx(true, "main", cwd));
    await run("reset", dir, fakeCtx(true, "main", cwd));
    expect(existsSync(localFile(cwd))).toBe(false);
  });

  test("Reset removes a damaged directory mode file", async () => {
    const dir = jevDir();
    const cwd = freshCwd();
    writeLocal(cwd, "{nope");
    await run("reset", dir, fakeCtx(true, "main", cwd));
    expect(existsSync(localFile(cwd))).toBe(false);
  });

  test.skipIf(process.getuid?.() === 0)("Refused reset keeps the directory mode", async () => {
    const dir = jevDir();
    const cwd = freshCwd();
    await run("mode premium", dir, fakeCtx(true, "main", cwd));
    await run("skills off", dir);
    chmodSync(join(dir, "state.json"), 0o000);
    const rec = await run("reset", dir, fakeCtx(true, "main", cwd));
    chmodSync(join(dir, "state.json"), 0o600);
    expect(rec.notes[0]![1]).toBe("error");
    expect(localOf(cwd)).toBe("premium");
  });

  test.skipIf(process.getuid?.() === 0)("Partial reset reports a warning and redraws", async () => {
    const dir = jevDir();
    const cwd = freshCwd();
    await run("skills off", dir);
    await run("mode premium global", dir);
    await run("mode budget", dir, fakeCtx(true, "main", cwd));
    chmodSync(join(cwd, ".pi"), 0o500);
    let rec: ReturnType<typeof fakeCtx>["rec"];
    try {
      rec = await run("reset", dir, fakeCtx(true, "main", cwd));
    } finally {
      chmodSync(join(cwd, ".pi"), 0o700);
    }
    expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8"))).toEqual({ version: 1 });
    expect(localOf(cwd)).toBe("budget");
    expect(rec.notes.map((n) => n[1])).toEqual(["warning"]);
    expect(rec.notes[0]![0]).toContain("global settings reset; directory mode not removed:");
    expect(rec.notes[0]![0]).toContain("EACCES");
    expect(rec.notes[0]![0]).toContain("mode: budget (this directory; global standard)");
    expect(rec.widgets).toHaveLength(1);
    expect(rec.widgets[0]![1]).toEqual(["Jev · budget (local)"]);
  });

  test("Command in a child", async () => {
    const dir = jevDir();
    const cwd = freshCwd();
    (globalThis as Record<symbol, unknown>)[CHILDREN_KEY] = new Set(["kid"]);
    const rec = await run("mode premium", dir, fakeCtx(true, "kid", cwd));
    expect(existsSync(localFile(cwd))).toBe(false);
    expect(rec.notes).toHaveLength(0);
  });

  test("/jev uses ctx.cwd over the main cwd holder", async () => {
    const dir = jevDir();
    const a = freshCwd();
    const b = freshCwd();
    const previous = mainCwd();
    setMainCwd(b);
    try {
      const rec = await run("mode premium", dir, fakeCtx(true, "main", a));
      expect(localOf(a)).toBe("premium");
      expect(existsSync(localFile(b))).toBe(false);
      expect(rec.notes[0]![0]).toContain("mode: premium");
    } finally {
      if (previous === undefined) delete (globalThis as Record<symbol, unknown>)[MAIN_CWD_KEY];
      else setMainCwd(previous);
    }
  });
});

describe("Removed cli-review forms", () => {
  const FORMS = [
    "cli-review on",
    "cli-review off",
    "cli-review codex",
    "cli-review opencode p/m high",
  ];
  test("each form is one warning with usage, state untouched", async () => {
    for (const form of FORMS) {
      const dir = jevDir();
      await run("skills off", dir);
      const before = readFileSync(join(dir, "state.json"), "utf8");
      const rec = await run(form, dir);
      expect(rec.notes).toHaveLength(1);
      expect(rec.notes[0]![1]).toBe("warning");
      expect(rec.notes[0]![0]).toBe(usageText());
      expect(rec.notes[0]![0]).not.toContain("cli-review");
      expect(readFileSync(join(dir, "state.json"), "utf8")).toBe(before);
    }
  });
  test("a slot-shaped word after cli-review is still usage, not a slot", async () => {
    const dir = jevDir();
    const rec = await run("cli-review reviewer fixture/fixture-review when Check.", dir);
    expect(rec.notes).toEqual([[usageText(), "warning"]]);
    expect(existsSync(join(dir, "config.json"))).toBe(false);
  });
});

describe("executor status by capability", () => {
  test("Duplicate executor reported", () => {
    const text = formatStatus(
      snap({ executor: { kind: "present", launchPolicy: false, agentRegistry: false } }),
      undefined,
      [],
    );
    expect(text).toContain(
      "executor: unknown; no launch policy, worker routing is off; no agent registry",
    );
    expect(text).not.toContain("mix (");
    expect(text).not.toContain("uninstall");
  });

  test("Executor without an agent registry reported", () => {
    const text = formatStatus(
      snap({
        executor: {
          kind: "present",
          implementation: "example-executor",
          launchPolicy: true,
          agentRegistry: false,
        },
      }),
    );
    expect(text).toContain("executor: example-executor; no agent registry");
    expect(text.split("\n").find((l) => l.startsWith("executor:"))).toEndWith(
      "; no agent registry",
    );
  });
});

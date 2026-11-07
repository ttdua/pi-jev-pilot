import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { CHILDREN_KEY } from "../../src/host/child.ts";
import {
  formatStatus,
  parseJevArgs,
  runJev,
  usageText,
  type JevArgs,
} from "../../src/host/commands.ts";
import type { Exec } from "../../src/host/review-cli.ts";
import { statusText, type Decision, type Tally } from "../../src/host/status.ts";
import { buildSnapshot, type Snapshot } from "../../src/host/readiness.ts";
import type { Config, ConfigRead } from "../../src/store/config.ts";
import { DECISION_FEATURES, FEATURES } from "../../src/store/defaults.ts";
import { readState, type State, type StateRead } from "../../src/store/state-file.ts";
import { buildWorkerQuestions } from "../../src/jev/questions.ts";
import { readConfig } from "../../src/store/config.ts";
import type { TuningRead } from "../../src/store/tuning-file.ts";
import { tempDir } from "../helpers.ts";
import type { WindowEntry } from "../../src/policy/cutpoints.ts";
import type { TierName } from "../../src/policy/launch.ts";

function snap(
  o: {
    config?: ConfigRead;
    stateRead?: StateRead;
    state?: State;
    env?: Record<string, string | undefined>;
    tools?: string[];
    tuningRead?: TuningRead;
  } = {},
): Snapshot {
  return buildSnapshot({
    configRead: o.config ?? { kind: "ok", present: true, config: {} as Config },
    stateRead: o.stateRead ?? { kind: "ok", state: o.state ?? {} },
    env: o.env ?? { TYPESAFE_API_KEY: "k" },
    toolNames: o.tools ?? ["subagent"],
    ...(o.tuningRead === undefined ? {} : { tuningRead: o.tuningRead }),
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
      expect(parseJevArgs(`tune ${w}`)).toEqual({ kind: "tune", sub: w as "undo" });
    for (const bad of ["tune apply", "tune Undo", "tune undo now"])
      expect(parseJevArgs(bad)).toEqual(usage);
  });
  test("set", () => {
    expect(parseJevArgs("skills off")).toEqual({ kind: "set", feature: "skills", on: false });
    expect(parseJevArgs("status on")).toEqual({ kind: "set", feature: "status", on: true });
  });
  test("mode", () => {
    expect(parseJevArgs("mode premium")).toEqual({ kind: "mode", mode: "premium" });
    expect(parseJevArgs("mode budget")).toEqual({ kind: "mode", mode: "budget" });
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
  test("cli-review switch", () => {
    expect(parseJevArgs("cli-review on")).toEqual({ kind: "cli-review-switch", on: true });
    expect(parseJevArgs("cli-review off")).toEqual({ kind: "cli-review-switch", on: false });
  });
  for (const bad of [
    "cli-review off now",
    "cli-review OFF",
    "cli-review On",
    "cli-review",
    "cli-review claude",
    "cli-review Codex",
    "cli-review codex luna high now",
    "mode",
    "mode quality",
    "mode Premium",
    "mode premium now",
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
  test("Usage lists the tune form", () => {
    expect(text).toContain("/jev tune [undo|reset|on|off]");
  });
  test("Usage lists the slot forms", () => {
    expect(text).toContain("  /jev <slot> <provider/model> [when <text>]");
    expect(text).toContain("  /jev <slot>");
    expect(text).toContain("  /jev remove <slot>");
  });
  test("Usage lists the mode form", () => {
    expect(text).toContain("/jev mode budget|standard|premium");
  });
  test("Usage lists the cli-review switch", () => {
    expect(text).toContain("/jev cli-review on|off");
  });
  test("lists the cli-review form", () => {
    expect(text).toContain("  /jev cli-review <codex|opencode> [model|default] [effort|default]");
  });
});

describe("formatStatus", () => {
  test("Malformed tuning reported", () => {
    const issues = [{ path: "", message: "tuning.json is not valid JSON" }];
    const text = formatStatus(snap({ tuningRead: { kind: "malformed", record: {}, issues } }));
    expect(text).toContain("problems:");
    expect(text).toContain("  tuning (malformed) (file): tuning.json is not valid JSON");
  });

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
    expect(formatStatus(snap())).toContain("cli review: off (codex, CLI defaults)");
    const state: State = {
      cliReview: { cli: "codex", model: "luna", effort: "high" },
      cliReviewEnabled: true,
    };
    const lines = formatStatus(snap({ state })).split("\n");
    expect(lines).toContain("cli review: on (codex, model luna, effort high)");
    expect(lines.indexOf("cli review: on (codex, model luna, effort high)")).toBe(
      lines.findIndex((l) => l.startsWith("  verbose:")) + 1,
    );
    const m = formatStatus(snap({ state: { cliReview: { cli: "opencode", model: "p/m" } } }));
    expect(m).toContain("cli review: off (opencode, model p/m)");
    const e = formatStatus(snap({ state: { cliReview: { cli: "opencode", effort: "high" } } }));
    expect(e).toContain("cli review: off (opencode, effort high)");
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
  describe("mix", () => {
    const entries = (n: number, fast: number, balanced: number, deep: number): WindowEntry[] => {
      const tiers = [
        ...Array<TierName>(fast).fill("fast"),
        ...Array<TierName>(balanced).fill("balanced"),
        ...Array<TierName>(deep).fill("deep"),
      ];
      const expert = n - tiers.length;
      return [...tiers, ...Array<TierName>(expert).fill("expert")].map((decided) => ({
        score: 0.5,
        effort: "high",
        decided,
      }));
    };
    test("standard, full window", () => {
      const lines = formatStatus(snap(), undefined, entries(200, 38, 110, 48)).split("\n");
      expect(lines).toContain(
        "mix (last 200, standard): fast 19% / balanced 55% / deep 24% / expert 2% · target 20/53/25/≤2",
      );
      expect(lines).not.toContain("cut points: seed");
    });
    test("budget target", () => {
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
    modelRegistry,
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
    configRead: readConfig(dir),
    stateRead: readState(dir),
    env: { TYPESAFE_API_KEY: "k" },
    toolNames: ["subagent"],
  });

const noExec: Exec = async () => {
  throw new Error("exec must not be called");
};
const noDecision = (): Decision | undefined => undefined;

async function run(
  args: string,
  dir: string,
  c = fakeCtx(),
  decision: () => Decision | undefined = noDecision,
  exec: Exec = noExec,
  tally?: () => Tally,
  overlay?: () => string | undefined,
) {
  await runJev(args, c.ctx, {
    dir,
    load: load(dir),
    decision,
    exec,
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

  test("redraw keeps the decision suffix; effort off drops it", async () => {
    const dir = jevDir();
    const decision = (): Decision => ({ effort: { kind: "level", level: "high" } });
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
    const rec = await run("", jevDir(), fakeCtx(), noDecision, noExec, () => t);
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
      noExec,
      undefined,
      () => "10 prompts · 0 workers · 0 fallbacks",
    );
    expect(rec.widgets[0]![1]).toEqual(["Jev · standard · 10 prompts · 0 workers · 0 fallbacks"]);
    expect(rec.notes[0]![0].split("\n")[0]).toBe(statusText(load(dir)()));
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

  test("Command from a later work group", async () => {
    const dir = jevDir();
    const c = fakeCtx();
    await runJev("tune", c.ctx, {
      dir,
      load: load(dir),
      decision: noDecision,
      exec: noExec,
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
      exec: noExec,
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
      decision: noDecision,
      exec: noExec,
      load: () => {
        throw new TypeError("boom");
      },
    });
    await runJev("tune", c.ctx, {
      dir,
      load: load(dir),
      decision: noDecision,
      exec: noExec,
    });
  });
});

describe("runJev slots", () => {
  const ADD = "reviewer fixture/fixture-review when Code review.";
  const slotsOf = (dir: string) => load(dir)().settings.crew.slots;
  const offered = (dir: string) =>
    Object.keys(
      buildWorkerQuestions(["fast", "balanced", "deep"], {}, slotsOf(dir)).questions["tier"]!
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

describe("runJev mode", () => {
  const modeOf = (dir: string) => (readState(dir).state as State).mode;

  test("Set premium", async () => {
    const dir = jevDir();
    await run("skills off", dir);
    const rec = await run("mode premium", dir);
    expect(modeOf(dir)).toBe("premium");
    expect(switches(dir)?.skills).toBe(false);
    expect(rec.notes.map((n) => n[1])).toEqual(["info"]);
    expect(rec.notes[0]![0]).toContain("mode: premium");
    expect(rec.widgets[0]![1]).toEqual(["Jev · premium"]);
  });

  test("Mode survives a restart", async () => {
    const dir = jevDir();
    await run("mode budget", dir);
    expect(load(dir)().settings.mode).toBe("budget");
  });

  test("Back to standard", async () => {
    const dir = jevDir();
    await run("mode premium", dir);
    const rec = await run("mode standard", dir);
    expect(modeOf(dir)).toBe("standard");
    expect(rec.notes[0]![0]).toContain("mode: standard");
    expect(rec.widgets[0]![1]).toEqual(["Jev · standard"]);
  });

  test.skipIf(process.getuid?.() === 0)("Refused mode change", async () => {
    const dir = jevDir();
    await run("mode budget", dir);
    chmodSync(join(dir, "state.json"), 0o000);
    const rec = await run("mode premium", dir);
    expect(rec.notes).toHaveLength(1);
    expect(rec.notes[0]![1]).toBe("error");
    expect(rec.notes[0]![0]).toContain("EACCES");
    expect(rec.widgets).toHaveLength(0);
    chmodSync(join(dir, "state.json"), 0o600);
    expect(modeOf(dir)).toBe("budget");
  });
});

describe("runJev sync", () => {
  test("sync runs after a change, not after status or usage", async () => {
    const dir = jevDir();
    const seen: boolean[] = [];
    const go = async (args: string) => {
      const c = fakeCtx();
      await runJev(args, c.ctx, {
        dir,
        load: load(dir),
        decision: noDecision,
        exec: noExec,
        sync: (s) => seen.push(s.settings.review.enabled),
      });
    };
    await go("");
    await go("bogus words here");
    expect(seen).toEqual([]);
    await go("cli-review on");
    expect(seen).toEqual([true]);
    await go("reset");
    expect(seen).toEqual([true, false]);
  });

  test("a throwing sync still draws and notifies", async () => {
    const dir = jevDir();
    const c = fakeCtx();
    await runJev("cli-review on", c.ctx, {
      dir,
      load: load(dir),
      decision: noDecision,
      exec: noExec,
      sync: () => {
        throw new Error("boom");
      },
    });
    expect(c.rec.widgets).toHaveLength(1);
    expect(c.rec.notes.map((n) => n[1])).toEqual(["info"]);
  });
});

describe("runJev cli-review", () => {
  const catalog = JSON.stringify({
    models: [
      {
        slug: "gpt-6-luna",
        display_name: "GPT-6-Luna",
        visibility: "list",
        supported_reasoning_levels: [{ effort: "low" }, { effort: "high" }],
      },
      {
        slug: "gpt-5.6-luna",
        display_name: "GPT-5.6-Luna",
        visibility: "hide",
        supported_reasoning_levels: [],
      },
      {
        slug: "gpt-5.6-nebula",
        display_name: "GPT-5.6-Nebula",
        supported_reasoning_levels: [{ effort: "low" }],
      },
    ],
  });
  const ok = (stdout: string) => ({
    stdout,
    stderr: "",
    code: 0,
    killed: false,
    truncated: false,
  });
  function fake(result: Awaited<ReturnType<Exec>> | Error) {
    const calls: [string, string[], object][] = [];
    const exec: Exec = async (c, a, o) => {
      calls.push([c, a, o]);
      if (result instanceof Error) throw result;
      return result;
    };
    return { exec, calls };
  }
  const review = (dir: string) => (readState(dir).state as State).cliReview;

  async function go(args: string, f: ReturnType<typeof fake>, dir = jevDir()) {
    const c = fakeCtx();
    await runJev(args, c.ctx, { dir, load: load(dir), decision: noDecision, exec: f.exec });
    return { rec: c.rec, dir };
  }

  test("bare reviewer stores, reports and redraws", async () => {
    const f = fake(ok(""));
    const { rec, dir } = await go("cli-review opencode", f);
    expect(review(dir)).toEqual({ cli: "opencode" });
    expect((readState(dir).state as State).cliReviewEnabled).toBe(true);
    expect(f.calls).toHaveLength(0);
    expect(rec.notes.map((n) => n[1])).toEqual(["info"]);
    expect(rec.notes[0]![0]).toContain("cli review: on (opencode, CLI defaults)");
    expect(rec.widgets).toHaveLength(1);
  });

  test("Turn the CLI review off", async () => {
    const dir = jevDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({
        version: 1,
        cliReview: { cli: "opencode", model: "p/m" },
        cliReviewEnabled: true,
      }),
    );
    const { rec } = await go("cli-review off", fake(ok("")), dir);
    const st = readState(dir).state as State;
    expect(st.cliReviewEnabled).toBe(false);
    expect(st.cliReview).toEqual({ cli: "opencode", model: "p/m" });
    expect(rec.widgets).toHaveLength(1);
  });

  test("Turn the CLI review on", async () => {
    const f = fake(ok(""));
    const { dir, rec } = await go("cli-review on", f);
    expect(readState(dir).state).toEqual({ cliReviewEnabled: true });
    expect(f.calls).toHaveLength(0);
    expect(rec.notes.map((n) => n[1])).toEqual(["info"]);
  });

  test("Switch survives a restart", async () => {
    const { dir } = await go("cli-review on", fake(ok("")));
    expect(load(dir)().settings.review.enabled).toBe(true);
  });

  test.skipIf(process.getuid?.() === 0)("Refused switch", async () => {
    const dir = jevDir();
    await go("cli-review on", fake(ok("")), dir);
    const before = readFileSync(join(dir, "state.json"));
    chmodSync(join(dir, "state.json"), 0o000);
    const { rec } = await go("cli-review off", fake(ok("")), dir);
    chmodSync(join(dir, "state.json"), 0o600);
    expect(rec.notes).toHaveLength(1);
    expect(rec.notes[0]![1]).toBe("error");
    expect(rec.notes[0]![0]).toContain("EACCES");
    expect(readFileSync(join(dir, "state.json"))).toEqual(before);
  });

  function seed(dir: string, body: object) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "state.json"), JSON.stringify({ version: 1, ...body }));
  }

  test("Choosing a reviewer turns the review on", async () => {
    const dir = jevDir();
    seed(dir, { cliReviewEnabled: false });
    const { rec } = await go("cli-review codex", fake(ok("")), dir);
    expect((readState(dir).state as State).cliReviewEnabled).toBe(true);
    expect(rec.notes[0]![0]).toContain("cli review: on (codex, CLI defaults)");
  });

  test("Refused model leaves the review off", async () => {
    const dir = jevDir();
    seed(dir, { cliReviewEnabled: false });
    const { rec } = await go("cli-review codex nova", fake(ok(catalog)), dir);
    expect(rec.notes[0]![1]).toBe("error");
    const st = readState(dir).state as State;
    expect(st.cliReviewEnabled).toBe(false);
    expect(st.cliReview).toBeUndefined();
  });

  test("All leaves the CLI review alone", async () => {
    const dir = jevDir();
    seed(dir, { cliReviewEnabled: true });
    await go("all off", fake(ok("")), dir);
    expect((readState(dir).state as State).cliReviewEnabled).toBe(true);
  });

  test("Reset turns the CLI review off", async () => {
    const dir = jevDir();
    seed(dir, { cliReviewEnabled: true });
    const { rec } = await go("reset", fake(ok("")), dir);
    expect((readState(dir).state as State).cliReviewEnabled).toBeUndefined();
    expect(rec.notes[0]![0]).toContain("cli review: off");
  });

  test("tier stored as typed, list read once with the right command", async () => {
    const f = fake(ok(catalog));
    const { rec, dir } = await go("cli-review codex luna high", f);
    expect(review(dir)).toEqual({ cli: "codex", model: "luna", effort: "high" });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]![0]).toBe("codex");
    expect(f.calls[0]![1]).toEqual(["debug", "models"]);
    expect(f.calls[0]![2]).toEqual({ timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    expect(rec.notes[0]![0]).toContain("cli review: on (codex, model luna, effort high)");
  });

  test("tier in another case stored as typed", async () => {
    const { dir } = await go("cli-review codex Luna", fake(ok(catalog)));
    expect(review(dir)).toEqual({ cli: "codex", model: "Luna" });
  });

  test("display name stored as its slug", async () => {
    const { dir } = await go("cli-review codex GPT-5.6-Nebula", fake(ok(catalog)));
    expect(review(dir)).toEqual({ cli: "codex", model: "gpt-5.6-nebula" });
  });

  test("unknown model is refused with suggestions", async () => {
    const { rec, dir } = await go("cli-review codex nova", fake(ok(catalog)));
    expect(review(dir)).toBeUndefined();
    expect(rec.notes).toHaveLength(1);
    expect(rec.notes[0]![1]).toBe("error");
    expect(rec.notes[0]![0]).toContain('Unknown Codex model "nova".');
    expect(rec.notes[0]![0]).toContain("\nTry: luna (now gpt-6-luna), nebula");
    expect(rec.widgets).toHaveLength(0);
  });

  test("unsupported effort lists the supported ones", async () => {
    const { rec, dir } = await go("cli-review codex luna ultra", fake(ok(catalog)));
    expect(review(dir)).toBeUndefined();
    expect(rec.notes[0]![1]).toBe("error");
    expect(rec.notes[0]![0]).toContain("Try: low, high");
  });

  test("codex effort without a model reads no list", async () => {
    const f = fake(ok(catalog));
    const { dir } = await go("cli-review codex default high", f);
    expect(review(dir)).toEqual({ cli: "codex", effort: "high" });
    expect(f.calls).toHaveLength(0);
  });

  test("opencode model by name stored as full id", async () => {
    const f = fake(ok("ollama-cloud/glm-5.3\nother/thing\n"));
    const { dir } = await go("cli-review opencode glm-5.3 high", f);
    expect(f.calls[0]![0]).toBe("opencode");
    expect(f.calls[0]![1]).toEqual(["models"]);
    expect(review(dir)).toEqual({ cli: "opencode", model: "ollama-cloud/glm-5.3", effort: "high" });
  });

  test("opencode name with two providers is refused naming both", async () => {
    const { rec, dir } = await go(
      "cli-review opencode glm-5.3",
      fake(ok("a/glm-5.3\nb/glm-5.3\n")),
    );
    expect(review(dir)).toBeUndefined();
    expect(rec.notes[0]![1]).toBe("error");
    expect(rec.notes[0]![0]).toContain("a/glm-5.3, b/glm-5.3");
  });

  test("opencode effort without a model is refused before any read", async () => {
    const f = fake(ok(""));
    const { rec, dir } = await go("cli-review opencode default high", f);
    expect(f.calls).toHaveLength(0);
    expect(review(dir)).toBeUndefined();
    expect(rec.notes[0]![1]).toBe("error");
    expect(rec.notes[0]![0]).toContain("needs a model");
    expect(rec.notes[0]![0]).not.toContain("Try:");
  });

  test("unreadable list (non-zero exit) stores with a warning", async () => {
    const f = fake({ ...ok(""), code: 1, stderr: "boom" });
    const { rec, dir } = await go("cli-review codex luna high", f);
    expect(review(dir)).toEqual({ cli: "codex", model: "luna", effort: "high" });
    expect(rec.notes.map((n) => n[1])).toEqual(["warning", "info"]);
    expect(rec.notes[0]![0]).toBe("CLI review model not checked: could not read the model list.");
  });

  test("timeout, empty parse and throwing exec are unreadable", async () => {
    for (const f of [
      fake({ ...ok(catalog), killed: true }),
      fake(ok("{}")),
      fake(new Error("spawn failed")),
    ]) {
      const { rec, dir } = await go("cli-review codex luna", f);
      expect(review(dir)).toEqual({ cli: "codex", model: "luna" });
      expect(rec.notes[0]![1]).toBe("warning");
    }
  });

  test("opencode missing on PATH stores with a not-found warning", async () => {
    const f = fake({ ...ok(""), code: 1, stderr: "spawn opencode ENOENT" });
    const { rec, dir } = await go("cli-review opencode p/m", f);
    expect(review(dir)).toEqual({ cli: "opencode", model: "p/m" });
    expect(rec.notes[0]).toEqual(["CLI review model not checked: opencode not found.", "warning"]);
  });

  test("default clears the model and reads no list", async () => {
    const dir = jevDir();
    await go("cli-review codex luna high", fake(ok(catalog)), dir);
    const f = fake(ok(catalog));
    await go("cli-review codex default", f, dir);
    expect(review(dir)).toEqual({ cli: "codex" });
    expect(f.calls).toHaveLength(0);
  });

  test("other state fields are kept", async () => {
    const dir = jevDir();
    await go("skills off", fake(ok("")), dir);
    await go("cli-review opencode", fake(ok("")), dir);
    expect(switches(dir)?.skills).toBe(false);
  });

  test("value outside the state rules is refused, no exec", async () => {
    const f = fake(ok(catalog));
    const { rec, dir } = await go("cli-review codex -m", f);
    expect(f.calls).toHaveLength(0);
    expect(existsSync(join(dir, "state.json"))).toBe(false);
    expect(rec.notes).toHaveLength(1);
    expect(rec.notes[0]![1]).toBe("error");
    expect(rec.notes[0]![0]).toContain("cliReview.model");
  });

  test("usage forms change nothing", async () => {
    const f = fake(ok(catalog));
    for (const a of ["cli-review", "cli-review claude", "cli-review Codex"]) {
      const { rec, dir } = await go(a, f);
      expect(rec.notes).toEqual([[usageText(), "warning"]]);
      expect(existsSync(join(dir, "state.json"))).toBe(false);
    }
  });

  test("cli-review is inert in a child", async () => {
    const dir = jevDir();
    (globalThis as Record<symbol, unknown>)[CHILDREN_KEY] = new Set(["kid"]);
    const f = fake(ok(catalog));
    const c = fakeCtx(true, "kid");
    await runJev("cli-review codex luna", c.ctx, {
      dir,
      load: load(dir),
      decision: noDecision,
      exec: f.exec,
    });
    expect(c.rec.notes).toHaveLength(0);
    expect(f.calls).toHaveLength(0);
    expect(existsSync(join(dir, "state.json"))).toBe(false);
  });
});

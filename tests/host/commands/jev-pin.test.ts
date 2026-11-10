// Characterization of runJev: notify texts and levels, side-effect order, receivers, error paths.
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionCommandContext, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { CHILDREN_KEY } from "../../../src/host/platform/child.ts";
import { formatStatus, runJev, usageText } from "../../../src/host/commands/jev.ts";
import type { Exec } from "../../../src/policy/review/cli.ts";
import { EMPTY_TALLY, type Decision } from "../../../src/host/status/line.ts";
import { buildSnapshot, type Snapshot } from "../../../src/host/platform/readiness.ts";
import { readConfig } from "../../../src/store/config.ts";
import { readLocalMode } from "../../../src/store/local-mode.ts";
import { readState } from "../../../src/store/state-file.ts";
import { tempDir } from "../../helpers.ts";

type Deps = Parameters<typeof runJev>[2];
type Note = [string, string | undefined];

const MODELS = [{ provider: "fixture", id: "fixture-review", reasoning: true }];
const registry = {
  find: (p: string, id: string) => MODELS.find((m) => m.provider === p && m.id === id),
  hasConfiguredAuth: () => true,
  getAvailable: () => MODELS,
} as unknown as ModelRegistry;

const roots: string[] = [];
const fresh = (prefix: string): string => {
  const d = tempDir(prefix);
  roots.push(d);
  return d;
};
afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[CHILDREN_KEY];
  for (const d of roots.splice(0)) {
    try {
      chmodSync(join(d, ".pi"), 0o700);
    } catch {}
    rmSync(d, { recursive: true, force: true });
  }
});

function harness(o: { hasUI?: boolean; sessionId?: string; notifyThrows?: boolean } = {}) {
  const events: string[] = [];
  const notes: Note[] = [];
  const cwd = fresh("jev-pin-cwd-");
  const dir = join(fresh("jev-pin-dir-"), "jev");
  const ctx = {
    cwd,
    hasUI: o.hasUI ?? true,
    ui: {
      notify: (m: string, t?: string) => {
        events.push("notify");
        notes.push([m, t]);
        if (o.notifyThrows) throw new Error("ui down");
      },
      setWidget: () => events.push("draw"),
    },
    sessionManager: {
      getSessionId: () => {
        events.push("sessionId");
        return o.sessionId ?? "main";
      },
      getBranch: () => [],
    },
    modelRegistry: registry,
  } as unknown as ExtensionCommandContext;
  const load = (): Snapshot => {
    events.push("load");
    return buildSnapshot({
      configRead: readConfig(dir),
      stateRead: readState(dir),
      localModeRead: readLocalMode(cwd),
      env: { TYPESAFE_API_KEY: "k" },
      toolNames: ["subagent"],
    });
  };
  const exec: Exec = async () => {
    events.push("exec");
    throw new Error("exec must not be called");
  };
  const deps: Deps = { dir, load, decision: () => undefined, exec };
  return { events, notes, cwd, dir, ctx, deps };
}

const receivers: Record<string, unknown> = {};
/** Wraps a dep so the call records `this` and its place in the event log. */
function spy<T>(h: { events: string[] }, name: string, value: T): () => T {
  return function (this: unknown) {
    receivers[name] = this;
    h.events.push(name);
    return value;
  };
}

describe("runJev pin: notify texts and levels", () => {
  test("usage form", async () => {
    const h = harness();
    await runJev("bogus words here", h.ctx, h.deps);
    expect(h.notes).toEqual([[usageText(), "warning"]]);
    expect(h.events).toEqual(["sessionId", "notify"]);
  });

  test("tune without a tune dep shows usage", async () => {
    const h = harness();
    await runJev("tune", h.ctx, h.deps);
    expect(h.notes).toEqual([[usageText(), "warning"]]);
  });

  test("tune reports ok as info and refusal as error, through deps with this = deps", async () => {
    const h = harness();
    const seen: unknown[] = [];
    const tune: NonNullable<Deps["tune"]> = function (this: unknown, sub, c) {
      seen.push(this, sub, c);
      return sub === "undo" ? { ok: false, message: "nope" } : { ok: true, message: "tuned" };
    };
    h.deps.tune = tune;
    await runJev("tune off", h.ctx, h.deps);
    await runJev("tune undo", h.ctx, h.deps);
    expect(h.notes).toEqual([
      ["tuned", "info"],
      ["nope", "error"],
    ]);
    expect(seen).toEqual([h.deps, "off", h.ctx, h.deps, "undo", h.ctx]);
    expect(h.events).not.toContain("load");
  });

  test("slot success is info, a refusal is error, a usage refusal appends the usage", async () => {
    const h = harness();
    await runJev("reviewer fixture/fixture-review when Reviews.", h.ctx, h.deps);
    await runJev("reviewer fixture/unknown", h.ctx, h.deps);
    await runJev("ghost", h.ctx, h.deps);
    expect(h.notes).toEqual([
      ["slot reviewer: fixture/fixture-review\nwhen: Reviews.", "info"],
      ["fixture/unknown: not in the model registry\nTry: fixture/fixture-review", "error"],
      [`no slot named ghost\n${usageText()}`, "error"],
    ]);
    expect(h.events).not.toContain("load");
  });

  test("cli-review value outside the state rules is refused before any exec", async () => {
    const h = harness();
    await runJev(`cli-review codex ${"x".repeat(300)}`, h.ctx, h.deps);
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]![1]).toBe("error");
    expect(h.notes[0]![0]).toMatch(/^cliReview\.model: /);
    expect(h.events).toEqual(["sessionId", "notify"]);
  });

  test("cli-review OpenCode effort without a model is refused without exec", async () => {
    const h = harness();
    await runJev("cli-review opencode default high", h.ctx, h.deps);
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]![1]).toBe("error");
    expect(h.events).toEqual(["sessionId", "notify"]);
    expect(readState(h.dir).kind).toBe("missing");
  });

  test("cli-review with an unreadable model list warns and still applies as typed", async () => {
    const h = harness();
    h.deps.exec = async (...a) => {
      h.events.push("exec");
      expect(a[2]).toEqual({ timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
      throw new Error("spawn");
    };
    await runJev("cli-review codex luna high", h.ctx, h.deps);
    expect(h.notes.map((n) => n[1])).toEqual(["warning", "info"]);
    expect(h.notes[0]![0]).toBe("CLI review model not checked: could not read the model list.");
    expect(h.notes[1]![0]).toContain("cli review: on (codex, model luna, effort high)");
    expect(h.events).toEqual(["sessionId", "exec", "notify", "load", "draw", "notify"]);
  });

  test("cli-review with an ENOENT list names the missing CLI", async () => {
    const h = harness();
    h.deps.exec = async () => ({
      stdout: "",
      stderr: "spawn ENOENT",
      code: 1,
      killed: false,
      truncated: false,
    });
    await runJev("cli-review opencode p/m", h.ctx, h.deps);
    expect(h.notes[0]).toEqual(["CLI review model not checked: opencode not found.", "warning"]);
  });

  test("cli-review model absent from the list is refused with suggestions and nothing is written", async () => {
    const h = harness();
    h.deps.exec = async () => ({
      stdout: "prov/luna\nprov/nebula\n",
      stderr: "",
      code: 0,
      killed: false,
      truncated: false,
    });
    await runJev("cli-review opencode lun", h.ctx, h.deps);
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]![1]).toBe("error");
    expect(h.notes[0]![0]).toBe(`Unknown OpenCode model "lun".\nTry: prov/luna`);
    expect(readState(h.dir).kind).toBe("missing");
    expect(h.events).not.toContain("load");
  });

  test("cli-review resolves the model and effort the list confirms", async () => {
    const h = harness();
    h.deps.exec = async () => ({
      stdout: "prov/luna-2\n",
      stderr: "",
      code: 0,
      killed: false,
      truncated: false,
    });
    await runJev("cli-review opencode prov/luna-2", h.ctx, h.deps);
    expect(h.notes.map((n) => n[1])).toEqual(["info"]);
    expect(h.notes[0]![0]).toContain("cli review: on (opencode, model prov/luna-2)");
  });

  test("exec is not called for a bare reviewer, a switch or a codex effort alone", async () => {
    const h = harness();
    await runJev("cli-review codex", h.ctx, h.deps);
    await runJev("cli-review codex default high", h.ctx, h.deps);
    await runJev("cli-review off", h.ctx, h.deps);
    expect(h.events.filter((e) => e === "exec")).toEqual([]);
    expect(h.notes.map((n) => n[1])).toEqual(["info", "info", "info"]);
  });

  test("mode clear with no file says so as info and loads nothing", async () => {
    const h = harness();
    await runJev("mode clear", h.ctx, h.deps);
    expect(h.notes).toEqual([["no directory mode set", "info"]]);
    expect(h.events).toEqual(["sessionId", "notify"]);
  });

  test("a directory-mode write failure is an error and loads nothing", async () => {
    const h = harness();
    mkdirSync(join(h.cwd, ".pi"));
    chmodSync(join(h.cwd, ".pi"), 0o500);
    await runJev("mode premium", h.ctx, h.deps);
    chmodSync(join(h.cwd, ".pi"), 0o700);
    if (process.getuid?.() === 0) return;
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]![1]).toBe("error");
    expect(h.notes[0]![0]).toContain("EACCES");
    expect(h.events).toEqual(["sessionId", "notify"]);
  });

  test("a refused state write is an error with the path-prefixed issue and no load", async () => {
    const h = harness();
    mkdirSync(h.dir, { recursive: true });
    writeFileSync(join(h.dir, "state.json"), "{}");
    chmodSync(join(h.dir, "state.json"), 0o000);
    await runJev("skills off", h.ctx, h.deps);
    chmodSync(join(h.dir, "state.json"), 0o600);
    if (process.getuid?.() === 0) return;
    expect(h.notes).toHaveLength(1);
    expect(h.notes[0]![1]).toBe("error");
    expect(h.events).toEqual(["sessionId", "notify"]);
  });
});

describe("runJev pin: status reply", () => {
  test("status text is the empty-tally status, info, with no sync for status", async () => {
    const h = harness();
    let synced = 0;
    h.deps.sync = () => void synced++;
    await runJev("", h.ctx, h.deps);
    const snapshot = h.deps.load(h.cwd);
    expect(h.notes).toEqual([[formatStatus(snapshot, EMPTY_TALLY, undefined), "info"]]);
    expect(synced).toBe(0);
  });

  test("tally and window feed the status and are read after the draw", async () => {
    const h = harness();
    const tally = { ...EMPTY_TALLY, prompts: 7 };
    const window = [] as const;
    h.deps.tally = spy(h, "tally", tally);
    h.deps.window = spy(h, "window", window);
    await runJev("", h.ctx, h.deps);
    expect(h.notes[0]![0]).toBe(formatStatus(h.deps.load(h.cwd), tally, window));
    expect(h.events).toEqual(["sessionId", "load", "draw", "tally", "window", "notify", "load"]);
    expect(receivers.tally).toBe(h.deps);
    expect(receivers.window).toBe(h.deps);
  });

  test("a change runs load, sync, decision, overlay, draw, tally, window, notify in that order", async () => {
    const h = harness();
    const decision: Decision = { effort: { kind: "level", level: "high" } };
    h.deps.load = ((orig) =>
      function (this: unknown, cwd: string) {
        receivers.load = this;
        return orig(cwd);
      })(h.deps.load);
    h.deps.sync = function (this: unknown) {
      receivers.sync = this;
      h.events.push("sync");
    };
    h.deps.decision = spy(h, "decision", decision);
    h.deps.overlay = spy(h, "overlay", "ov");
    h.deps.tally = spy(h, "tally", EMPTY_TALLY);
    h.deps.window = spy(h, "window", []);
    await runJev("skills off", h.ctx, h.deps);
    expect(h.events).toEqual([
      "sessionId",
      "load",
      "sync",
      "decision",
      "overlay",
      "draw",
      "tally",
      "window",
      "notify",
    ]);
    for (const k of ["load", "sync", "decision", "overlay", "tally", "window"]) {
      expect(receivers[k]).toBe(h.deps);
    }
    expect(h.notes.map((n) => n[1])).toEqual(["info"]);
  });

  test("deps not reached are not called: refusals never touch tally, window, overlay or decision", async () => {
    const h = harness();
    for (const k of ["tally", "window", "overlay", "decision"] as const) {
      h.deps[k] = spy(h, k, undefined as never);
    }
    await runJev("bogus words here", h.ctx, h.deps);
    await runJev("mode clear", h.ctx, h.deps);
    await runJev("reviewer fixture/unknown", h.ctx, h.deps);
    expect(h.events.filter((e) => ["tally", "window", "overlay", "decision"].includes(e))).toEqual(
      [],
    );
  });

  test("a global mode change under a directory mode appends the shadowed line", async () => {
    const h = harness();
    await runJev("mode budget", h.ctx, h.deps);
    h.notes.length = 0;
    await runJev("mode premium global", h.ctx, h.deps);
    const lines = h.notes[0]![0].split("\n");
    expect(lines.at(-1)).toBe(
      "directory mode budget still applies here; global mode is now premium",
    );
    expect(h.notes[0]![1]).toBe("info");
  });

  test("a global mode change with no directory mode has no shadowed line", async () => {
    const h = harness();
    await runJev("mode premium global", h.ctx, h.deps);
    expect(h.notes[0]![0]).not.toContain("still applies here");
  });

  test.skipIf(process.getuid?.() === 0)(
    "a partial reset puts its line first and downgrades the level to warning",
    async () => {
      const h = harness();
      await runJev("mode budget", h.ctx, h.deps);
      h.notes.length = 0;
      chmodSync(join(h.cwd, ".pi"), 0o500);
      await runJev("reset", h.ctx, h.deps);
      chmodSync(join(h.cwd, ".pi"), 0o700);
      expect(h.notes).toHaveLength(1);
      expect(h.notes[0]![1]).toBe("warning");
      const [first, second] = h.notes[0]![0].split("\n");
      expect(first).toMatch(/^global settings reset; directory mode not removed: .*EACCES/);
      expect(second).toBe(formatStatus(h.deps.load(h.cwd), EMPTY_TALLY).split("\n")[0]!);
    },
  );

  test("reset removes an existing directory mode quietly", async () => {
    const h = harness();
    await runJev("mode budget", h.ctx, h.deps);
    h.notes.length = 0;
    await runJev("reset", h.ctx, h.deps);
    expect(h.notes.map((n) => n[1])).toEqual(["info"]);
    expect(readLocalMode(h.cwd).kind).toBe("missing");
  });

  test("a mode-clear that succeeds reports the status like a change", async () => {
    const h = harness();
    await runJev("mode budget", h.ctx, h.deps);
    h.events.length = 0;
    h.notes.length = 0;
    h.deps.sync = () => h.events.push("sync");
    await runJev("mode clear", h.ctx, h.deps);
    expect(h.events).toEqual(["sessionId", "load", "sync", "draw", "notify"]);
    expect(h.notes.map((n) => n[1])).toEqual(["info"]);
  });
});

describe("runJev pin: no UI and child sessions", () => {
  test("without UI nothing is notified but the change still happens", async () => {
    const h = harness({ hasUI: false });
    await runJev("skills off", h.ctx, h.deps);
    await runJev("bogus", h.ctx, h.deps);
    await runJev("tune", h.ctx, h.deps);
    await runJev("ghost", h.ctx, h.deps);
    expect(h.notes).toEqual([]);
    expect(h.events.filter((e) => e === "load")).toHaveLength(1);
    expect(
      (readState(h.dir) as { state: { switches: { skills: boolean } } }).state.switches.skills,
    ).toBe(false);
  });

  test("without UI a failure is silent", async () => {
    const h = harness({ hasUI: false });
    h.deps.load = () => {
      throw new Error("boom");
    };
    await runJev("", h.ctx, h.deps);
    expect(h.notes).toEqual([]);
  });

  test("a child session gets nothing: only the session id is read", async () => {
    (globalThis as Record<symbol, unknown>)[CHILDREN_KEY] = new Set(["kid"]);
    const h = harness({ sessionId: "kid" });
    h.deps.tally = spy(h, "tally", EMPTY_TALLY);
    await runJev("skills off", h.ctx, h.deps);
    await runJev("", h.ctx, h.deps);
    expect(h.events).toEqual(["sessionId", "sessionId"]);
    expect(h.notes).toEqual([]);
    expect(readState(h.dir).kind).toBe("missing");
  });
});

describe("runJev pin: fail-open /jev failed path", () => {
  const boom = (): never => {
    throw new Error("boom");
  };

  test("the session id lookup throwing is reported", async () => {
    const h = harness();
    (h.ctx.sessionManager as { getSessionId: () => string }).getSessionId = boom;
    await runJev("", h.ctx, h.deps);
    expect(h.notes).toEqual([["/jev failed: Error", "error"]]);
  });

  test("a throwing tune dep is reported by constructor name", async () => {
    const h = harness();
    h.deps.tune = () => {
      throw new TypeError("x");
    };
    await runJev("tune", h.ctx, h.deps);
    expect(h.notes).toEqual([["/jev failed: TypeError", "error"]]);
  });

  test("an error with a string code is reported by its code", async () => {
    const h = harness();
    h.deps.load = () => {
      throw Object.assign(new Error("x"), { code: "EIO" });
    };
    await runJev("", h.ctx, h.deps);
    expect(h.notes).toEqual([["/jev failed: EIO", "error"]]);
  });

  test("a non-error throw is UnknownError", async () => {
    const h = harness();
    h.deps.load = () => {
      throw "str";
    };
    await runJev("", h.ctx, h.deps);
    expect(h.notes).toEqual([["/jev failed: UnknownError", "error"]]);
  });

  test("load throwing after a change: the change stays written, no sync, no draw", async () => {
    const h = harness();
    h.deps.load = boom;
    h.deps.sync = spy(h, "sync", undefined as never);
    await runJev("skills off", h.ctx, h.deps);
    expect(h.notes).toEqual([["/jev failed: Error", "error"]]);
    expect(h.events).toEqual(["sessionId", "notify"]);
    expect(
      (readState(h.dir) as { state: { switches: { skills: boolean } } }).state.switches.skills,
    ).toBe(false);
  });

  test("a throwing sync is swallowed and the status still shows", async () => {
    const h = harness();
    h.deps.sync = boom;
    await runJev("skills off", h.ctx, h.deps);
    expect(h.notes.map((n) => n[1])).toEqual(["info"]);
    expect(h.events).toEqual(["sessionId", "load", "draw", "notify"]);
  });

  test("a throwing decision fails after sync and before the draw", async () => {
    const h = harness();
    h.deps.sync = spy(h, "sync", undefined as never);
    h.deps.decision = boom;
    h.deps.overlay = spy(h, "overlay", undefined);
    await runJev("skills off", h.ctx, h.deps);
    expect(h.events).toEqual(["sessionId", "load", "sync", "notify"]);
    expect(h.notes).toEqual([["/jev failed: Error", "error"]]);
  });

  test("a throwing overlay fails before the draw", async () => {
    const h = harness();
    h.deps.overlay = boom;
    await runJev("", h.ctx, h.deps);
    expect(h.events).toEqual(["sessionId", "load", "notify"]);
    expect(h.notes).toEqual([["/jev failed: Error", "error"]]);
  });

  test("a throwing tally fails after the draw and before the window", async () => {
    const h = harness();
    h.deps.tally = boom;
    h.deps.window = spy(h, "window", []);
    await runJev("", h.ctx, h.deps);
    expect(h.events).toEqual(["sessionId", "load", "draw", "notify"]);
    expect(h.notes).toEqual([["/jev failed: Error", "error"]]);
  });

  test("a throwing window fails after the draw with no status notify", async () => {
    const h = harness();
    h.deps.window = boom;
    await runJev("", h.ctx, h.deps);
    expect(h.events).toEqual(["sessionId", "load", "draw", "notify"]);
    expect(h.notes).toEqual([["/jev failed: Error", "error"]]);
  });

  test("a throwing notify retries once with the failure text and swallows the second throw", async () => {
    const h = harness({ notifyThrows: true });
    await runJev("bogus words here", h.ctx, h.deps);
    expect(h.notes).toEqual([
      [usageText(), "warning"],
      ["/jev failed: Error", "error"],
    ]);
  });
});

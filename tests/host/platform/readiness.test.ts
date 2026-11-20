import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildSnapshot,
  executorState,
  hasExecutor,
  isKeySet,
  loadSnapshot,
} from "../../../src/host/platform/readiness.ts";
import { MAIN_CWD_KEY, setMainCwd } from "../../../src/host/platform/main-cwd.ts";
import {
  capturedService,
  captureMainService,
  clearMainService,
} from "../../../src/host/platform/index.ts";
import { writeLocalMode } from "../../../src/store/local-mode.ts";
import type { Config, ConfigRead } from "../../../src/store/config.ts";
import type { StateRead } from "../../../src/store/state-file.ts";
import type { TuningRead } from "../../../src/store/tuning-file.ts";
import { tempDir } from "../../helpers.ts";

const okConfig = (config: Config = {}): ConfigRead => ({
  kind: "ok",
  present: true,
  deprecated: [],
  config,
  notices: [],
});
const okState: StateRead = { kind: "missing", state: {} };
const KEY = { TYPESAFE_API_KEY: "test-key" };

function snap(over: Partial<Parameters<typeof buildSnapshot>[0]> = {}) {
  return buildSnapshot({
    configRead: okConfig(),
    stateRead: okState,
    env: KEY,
    toolNames: [],
    ...over,
  });
}

describe("buildSnapshot", () => {
  test("config deprecation mapped", () => {
    expect(
      snap({
        configRead: { kind: "ok", present: true, config: {}, notices: [], deprecated: ["tools"] },
      }).config,
    ).toEqual({
      valid: true,
      notices: [],
      deprecated: ["tools"],
    });
    expect(snap().config).toEqual({ valid: true, notices: [], deprecated: [] });
    const issues = [{ path: "x", message: "m" }];
    expect(snap({ configRead: { kind: "invalid", issues } }).config).toEqual({
      valid: false,
      issues,
    });
  });
  test("default key variable", () => {
    const s = snap();
    expect(s.keySet).toBe(true);
    expect(s.keyVar).toBe("TYPESAFE_API_KEY");
  });

  test("directory mode overrides the global mode", () => {
    const s = snap({ localModeRead: { kind: "ok", mode: "premium" } });
    expect(s.settings.mode).toBe("premium");
    expect(s.settings.modeSource).toBe("local");
    expect(s.localMode).toEqual({ kind: "ok", issues: [] });
  });

  test("a malformed directory mode file applies nothing and keeps its issues", () => {
    const issues = [{ path: "mode", message: "bad" }];
    const s = snap({ localModeRead: { kind: "malformed", issues } });
    expect(s.settings.mode).toBe("standard");
    expect(s.settings.modeSource).toBe("global");
    expect(s.localMode).toEqual({ kind: "malformed", issues });
  });

  test("a missing directory mode file has no issues", () => {
    expect(snap().localMode).toEqual({ kind: "missing", issues: [] });
  });

  test("configured key variable", () => {
    const s = snap({
      configRead: okConfig({ classifier: { apiKeyEnv: "MY_JEV_KEY" } }),
      env: { MY_JEV_KEY: "k" },
    });
    expect(s.keyVar).toBe("MY_JEV_KEY");
    expect(s.keySet).toBe(true);
  });

  test("empty value", () => {
    expect(snap({ env: { TYPESAFE_API_KEY: "" } }).keySet).toBe(false);
  });

  test("whitespace value", () => {
    expect(snap({ env: { TYPESAFE_API_KEY: "  " } }).keySet).toBe(true);
  });

  test("executor", () => {
    expect(snap({ toolNames: ["read", "subagent"] }).executor).toEqual({
      kind: "present",
      launchPolicy: true,
      agentRegistry: true,
    });
    expect(snap({ toolNames: ["read"] }).executor).toEqual({ kind: "absent" });
  });

  test("invalid config keeps switches", () => {
    const issues = [{ path: "classifier.url", message: "bad" }];
    const s = snap({
      configRead: { kind: "invalid", issues },
      stateRead: { kind: "ok", state: { switches: { skills: false } } },
    });
    expect(s.config).toEqual({ valid: false, issues });
    expect(s.settings.switches.skills).toBe(false);
    expect(s.keySet).toBe(true);
  });

  test("empty config object", () => {
    const s = snap();
    expect(s.config.valid).toBe(true);
    expect(s.settings.mode).toBe("standard");
  });

  test("state problems kept", () => {
    const issues = [{ path: "", message: "not JSON" }];
    const s = snap({ stateRead: { kind: "malformed", state: {}, issues } });
    expect(s.state.kind).toBe("malformed");
    expect(s.state.issues).toEqual(issues);
    expect(s.settings.switches.skills).toBe(true);
  });

  test("invalid config ignores its key variable", () => {
    const s = snap({
      configRead: { kind: "invalid", issues: [{ path: "x", message: "bad" }] },
    });
    expect(s.keyVar).toBe("TYPESAFE_API_KEY");
    expect(s.keySet).toBe(true);
  });
});

describe("buildSnapshot tuning", () => {
  const tuned: TuningRead = {
    kind: "ok",
    record: { timeoutMs: { value: 1700, base: 1500 } },
  };

  test("Tuned value in the snapshot", () => {
    const s = snap({ tuningRead: tuned });
    expect(s.settings.classifier.timeoutMs).toBe(1700);
    expect(s.untunedTimeoutMs).toBe(1500);
    expect(s.tuning.kind).toBe("ok");
    expect(s.tuning.record).toEqual(tuned.record);
  });

  test("Tuning ignored with an invalid config", () => {
    const s = snap({
      configRead: { kind: "invalid", issues: [{ path: "x", message: "bad" }] },
      tuningRead: tuned,
    });
    expect(s.settings.classifier.timeoutMs).toBe(1500);
    expect(s.untunedTimeoutMs).toBe(1500);
  });

  test("Malformed tuning ignored", () => {
    const issues = [{ path: "", message: "tuning.json is not valid JSON" }];
    const s = snap({ tuningRead: { kind: "malformed", record: {}, issues } });
    expect(s.settings.classifier.timeoutMs).toBe(1500);
    expect(s.tuning.kind).toBe("malformed");
    expect(s.tuning.issues).toEqual(issues);
  });

  test("missing tuning by default", () => {
    const s = snap();
    expect(s.tuning).toEqual({ kind: "missing", issues: [], record: {} });
  });
});

describe("isKeySet / hasExecutor", () => {
  test("isKeySet", () => {
    expect(isKeySet({ A: "v" }, "A")).toBe(true);
    expect(isKeySet({ A: "" }, "A")).toBe(false);
    expect(isKeySet({ A: "  " }, "A")).toBe(true);
    expect(isKeySet({}, "A")).toBe(false);
  });

  test("hasExecutor", () => {
    expect(hasExecutor(["read", "subagent"])).toBe(true);
    expect(hasExecutor(["read"])).toBe(false);
  });
});

describe("loadSnapshot", () => {
  const prev = process.env.PI_CODING_AGENT_DIR;
  const dirs: string[] = [];
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[MAIN_CWD_KEY];
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
  });

  test("reads the files and the tool list", () => {
    const dir = tempDir("jev-ready-");
    dirs.push(dir);
    process.env.PI_CODING_AGENT_DIR = dir;
    mkdirSync(join(dir, "jev"));
    writeFileSync(join(dir, "jev", "state.json"), '{"version":1,"mode":"budget"}');
    writeFileSync(
      join(dir, "jev", "tuning.json"),
      '{"version":1,"timeoutMs":{"value":1700,"base":1500}}',
    );
    const pi = { getAllTools: () => [{ name: "subagent" }] } as never;
    const s = loadSnapshot(pi);
    expect(s.settings.mode).toBe("budget");
    expect(s.executor).toEqual({ kind: "present", launchPolicy: false, agentRegistry: false });
    expect(s.tuning.kind).toBe("ok");
    expect(s.settings.classifier.timeoutMs).toBe(1700);
  });

  function withAgentDir(): string {
    const dir = tempDir("jev-ready-");
    dirs.push(dir);
    process.env.PI_CODING_AGENT_DIR = dir;
    mkdirSync(join(dir, "jev"));
    writeFileSync(join(dir, "jev", "state.json"), '{"version":1,"mode":"budget"}');
    return dir;
  }
  const pi = { getAllTools: () => [] } as never;

  test("loadSnapshot reads the given directory", () => {
    withAgentDir();
    const cwdA = tempDir("jev-cwd-");
    dirs.push(cwdA);
    writeLocalMode(cwdA, "premium");
    const s = loadSnapshot(pi, cwdA);
    expect(s.settings.mode).toBe("premium");
    expect(s.settings.modeSource).toBe("local");
  });

  test("loadSnapshot without a directory reads the main cwd", () => {
    withAgentDir();
    const cwdB = tempDir("jev-cwd-");
    dirs.push(cwdB);
    writeLocalMode(cwdB, "premium");
    setMainCwd(cwdB);
    expect(loadSnapshot(pi).settings.mode).toBe("premium");
  });

  test("Subdirectory is separate", () => {
    withAgentDir();
    const cwd = tempDir("jev-cwd-");
    dirs.push(cwd);
    writeLocalMode(cwd, "premium");
    const s = loadSnapshot(pi, join(cwd, "sub"));
    expect(s.settings.mode).toBe("budget");
    expect(s.settings.modeSource).toBe("global");
  });
});

describe("executorState", () => {
  const tools = [{ name: "subagent" }] as never;
  const none = [{ name: "read" }] as never;
  const both = { registerLaunchPolicy() {}, listAgentTypes() {} };

  test("Executor installed", () => {
    const service = { implementation: "@ttdua/pi-subagents", ...both };
    expect(executorState(tools, service)).toEqual({
      kind: "present",
      implementation: "@ttdua/pi-subagents",
      launchPolicy: true,
      agentRegistry: true,
    });
  });

  test("service without the tool is present with its capabilities", () => {
    expect(executorState(none, both)).toEqual({
      kind: "present",
      launchPolicy: true,
      agentRegistry: true,
    });
  });

  test("a non-object service gives no capabilities", () => {
    const fn = Object.assign(() => {}, both);
    expect(executorState(tools, fn)).toEqual({
      kind: "present",
      launchPolicy: false,
      agentRegistry: false,
    });
    expect(executorState(none, fn)).toEqual({ kind: "absent" });
  });

  test("Executor absent", () => {
    expect(executorState(none, undefined)).toEqual({ kind: "absent" });
  });

  test("Original loaded first / last: a service of another shape", () => {
    expect(executorState(tools, { listAgents() {} })).toEqual({
      kind: "present",
      launchPolicy: false,
      agentRegistry: false,
    });
  });

  test("Another compatible executor", () => {
    expect(executorState(tools, { implementation: "example-executor", ...both })).toEqual({
      kind: "present",
      implementation: "example-executor",
      launchPolicy: true,
      agentRegistry: true,
    });
  });

  test("Tool without a service", () => {
    expect(executorState(tools, undefined)).toEqual({
      kind: "present",
      launchPolicy: false,
      agentRegistry: false,
    });
  });

  test("a null slot with the tool is present without capabilities", () => {
    expect(executorState(tools, null)).toEqual({
      kind: "present",
      launchPolicy: false,
      agentRegistry: false,
    });
  });

  test("a throwing getter makes only that fact false", () => {
    const service = {
      listAgentTypes() {},
      get registerLaunchPolicy(): never {
        throw new Error("boom");
      },
    };
    expect(executorState(tools, service)).toEqual({
      kind: "present",
      launchPolicy: false,
      agentRegistry: true,
    });
  });

  test("Present after children: the same facts after capturing twice", () => {
    const g = globalThis as Record<symbol, unknown>;
    const EXECUTOR = Symbol.for("@gotgenes/pi-subagents:service");
    g[EXECUTOR] = both;
    try {
      captureMainService();
      const first = executorState(tools, capturedService());
      captureMainService();
      expect(executorState(tools, capturedService())).toEqual(first);
    } finally {
      delete g[EXECUTOR];
      clearMainService();
    }
  });
});

describe("loadSnapshot captures at reload", () => {
  const EXECUTOR = Symbol.for("@gotgenes/pi-subagents:service");
  const g = globalThis as Record<symbol, unknown>;
  const pi = { getAllTools: () => [{ name: "subagent" }] } as never;

  afterEach(() => {
    delete g[EXECUTOR];
    clearMainService();
  });

  test("after a reload the new capture decides", () => {
    g[EXECUTOR] = { listAgents: () => [] };
    captureMainService();
    expect(loadSnapshot(pi).executor).toMatchObject({ launchPolicy: false });
    g[EXECUTOR] = { registerLaunchPolicy() {}, listAgentTypes() {} };
    expect(loadSnapshot(pi).executor).toMatchObject({ launchPolicy: false });
    captureMainService();
    expect(loadSnapshot(pi).executor).toMatchObject({ launchPolicy: true, agentRegistry: true });
  });
});

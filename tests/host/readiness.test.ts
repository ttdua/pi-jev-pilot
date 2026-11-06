import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSnapshot, hasExecutor, isKeySet, loadSnapshot } from "../../src/host/readiness.ts";
import type { Config, ConfigRead } from "../../src/store/config.ts";
import type { StateRead } from "../../src/store/state-file.ts";
import { tempDir } from "../helpers.ts";

const okConfig = (config: Config = {}): ConfigRead => ({ kind: "ok", present: true, config });
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
  test("default key variable", () => {
    const s = snap();
    expect(s.keySet).toBe(true);
    expect(s.keyVar).toBe("TYPESAFE_API_KEY");
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
    expect(snap({ toolNames: ["read", "subagent"] }).executor).toBe(true);
    expect(snap({ toolNames: ["read"] }).executor).toBe(false);
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
    const pi = { getAllTools: () => [{ name: "subagent" }] } as never;
    const s = loadSnapshot(pi);
    expect(s.settings.mode).toBe("budget");
    expect(s.executor).toBe(true);
  });
});

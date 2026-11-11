import { afterEach, describe, expect, test } from "bun:test";
import {
  MAIN_SERVICE_KEY,
  captureMainService,
  clearMainService,
  mainService,
  publishedService,
} from "../../../src/host/tools/service.ts";

const EXECUTOR = Symbol.for("@gotgenes/pi-subagents:service");
const g = globalThis as Record<symbol, unknown>;

function vendored(records: unknown[] = []) {
  return {
    implementation: "@ttdua/pi-subagents",
    sessionId: "main",
    listAgents: () => records,
    listAgentTypes: () => [],
  };
}

afterEach(() => {
  delete g[EXECUTOR];
  delete g[MAIN_SERVICE_KEY];
});

describe("tool service", () => {
  test("captures the executor service and a second capture replaces it", () => {
    const a = vendored();
    const b = vendored([1]);
    g[EXECUTOR] = a;
    captureMainService();
    expect(mainService()).toBe(a as never);
    g[EXECUTOR] = b;
    captureMainService();
    expect(mainService()).toBe(b as never);
  });

  test("clearMainService empties the slot", () => {
    g[EXECUTOR] = vendored();
    captureMainService();
    clearMainService();
    expect(mainService()).toBeUndefined();
  });

  test("no executor global leaves nothing; unusable service clears", () => {
    expect(mainService()).toBeUndefined();
    g[EXECUTOR] = vendored();
    captureMainService();
    g[EXECUTOR] = { ...vendored(), listAgents: 1 };
    captureMainService();
    expect(mainService()).toBeUndefined();
  });

  test("a service from another implementation is not captured", () => {
    g[EXECUTOR] = { listAgents: () => [], listAgentTypes: () => [] };
    captureMainService();
    expect(mainService()).toBeUndefined();
    g[EXECUTOR] = { ...vendored(), implementation: "@gotgenes/pi-subagents" };
    captureMainService();
    expect(mainService()).toBeUndefined();
  });

  test("a slot holding another implementation is not returned", () => {
    g[MAIN_SERVICE_KEY] = { listAgents: () => [], listAgentTypes: () => [] };
    expect(mainService()).toBeUndefined();
  });
});

describe("publishedService", () => {
  test("reads the executor slot now, not the value at capture", () => {
    const a = vendored();
    g[EXECUTOR] = a;
    captureMainService();
    const b = { listAgents: () => [] };
    g[EXECUTOR] = b;
    expect(publishedService()).toBe(b);
    expect(mainService()).toBe(a as never);
  });
});

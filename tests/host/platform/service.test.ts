import { afterEach, describe, expect, test } from "bun:test";
import {
  MAIN_SERVICE_KEY,
  captureMainService,
  clearMainService,
  mainService,
} from "../../../src/host/platform/service.ts";

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

  test("any object is captured", () => {
    const service = { listAgents: () => [] };
    g[EXECUTOR] = service;
    captureMainService();
    expect(mainService()).toBe(service as never);
  });

  test("a non-object clears", () => {
    expect(mainService()).toBeUndefined();
    g[EXECUTOR] = vendored();
    captureMainService();
    g[EXECUTOR] = 1;
    captureMainService();
    expect(mainService()).toBeUndefined();
    g[EXECUTOR] = null;
    captureMainService();
    expect(mainService()).toBeUndefined();
  });
});

describe("slot read", () => {
  test("a throwing slot getter clears the old capture and does not throw", () => {
    g[EXECUTOR] = vendored();
    captureMainService();
    expect(mainService()).toBeDefined();
    Object.defineProperty(g, EXECUTOR, {
      configurable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(() => captureMainService()).not.toThrow();
    expect(mainService()).toBeUndefined();
  });
});

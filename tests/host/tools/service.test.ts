import { afterEach, describe, expect, test } from "bun:test";
import {
  MAIN_SERVICE_KEY,
  captureMainService,
  clearMainService,
  mainService,
} from "../../src/host/tool-service.ts";

const EXECUTOR = Symbol.for("@gotgenes/pi-subagents:service");
const g = globalThis as Record<symbol, unknown>;

afterEach(() => {
  delete g[EXECUTOR];
  delete g[MAIN_SERVICE_KEY];
});

describe("tool service", () => {
  test("captures the executor service and a second capture replaces it", () => {
    const a = { listAgents: () => [] };
    const b = { listAgents: () => [1] };
    g[EXECUTOR] = a;
    captureMainService();
    expect(mainService()).toBe(a);
    g[EXECUTOR] = b;
    captureMainService();
    expect(mainService()).toBe(b);
  });

  test("clearMainService empties the slot", () => {
    g[EXECUTOR] = { listAgents: () => [] };
    captureMainService();
    clearMainService();
    expect(mainService()).toBeUndefined();
  });

  test("no executor global leaves nothing; unusable service clears", () => {
    expect(mainService()).toBeUndefined();
    g[EXECUTOR] = { listAgents: () => [] };
    captureMainService();
    g[EXECUTOR] = { listAgents: 1 };
    captureMainService();
    expect(mainService()).toBeUndefined();
  });
});

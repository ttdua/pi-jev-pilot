import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createCutpointWindow } from "../../../src/host/worker/cutpoint-window.ts";
import { setup } from "../../../src/host/setup.ts";
import { MAIN_SERVICE_KEY } from "../../../src/host/platform/service.ts";
import { CHILDREN_KEY } from "../../../src/host/platform/child.ts";
import { RUBRIC_VERSION } from "../../../src/jev/rubrics.ts";
import { readLedger } from "../../../src/store/ledger.ts";
import { tempDir } from "../../helpers.ts";

const worker = (at: number, extra: Record<string, unknown> = {}) => ({
  v: 1,
  at,
  kind: "worker",
  session: "S",
  mode: "standard",
  answered: true,
  agent: "scout",
  briefChars: 10,
  reason: "cut",
  status: "completed",
  rubric: RUBRIC_VERSION,
  score: 2,
  expertOffered: true,
  tier: "balanced",
  ...extra,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => worker(i + 1));

describe("cut-point window", () => {
  test("150 eligible lines load 150 entries", () => {
    const w = createCutpointWindow();
    w.load(many(150));
    expect(w.entries()).toHaveLength(150);
  });

  test("99 entries plus one add give 100", () => {
    const w = createCutpointWindow();
    w.load(many(99));
    w.add(worker(500));
    expect(w.entries()).toHaveLength(100);
  });

  test("add ignores invalid and ineligible lines and caps at 200", () => {
    const w = createCutpointWindow();
    w.load(many(200));
    w.add({ kind: "worker", at: 1 });
    w.add(worker(900, { reason: "miss" }));
    w.add(worker(901, { rubric: RUBRIC_VERSION - 1 }));
    expect(w.entries()).toHaveLength(200);
    w.add(worker(902, { tier: "fast", score: 1 }));
    expect(w.entries()).toHaveLength(200);
    expect(w.entries().at(-1)?.score).toBe(1);
  });

  test("a valid line whose write fails still counts (add is independent of the write)", () => {
    const w = createCutpointWindow();
    w.load([]);
    w.add(worker(1));
    expect(w.entries()).toHaveLength(1);
  });

  test("clear empties the window", () => {
    const w = createCutpointWindow();
    w.load(many(3));
    w.clear();
    expect(w.entries()).toEqual([]);
  });
});

describe("window loaded from a real ledger", () => {
  let dir = "";
  const saved = process.env.PI_CODING_AGENT_DIR;
  beforeEach(() => {
    dir = tempDir("jev-win-");
    mkdirSync(join(dir, "jev"), { recursive: true });
    process.env.PI_CODING_AGENT_DIR = dir;
  });
  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[CHILDREN_KEY];
    delete (globalThis as Record<symbol, unknown>)[MAIN_SERVICE_KEY];
    rmSync(dir, { recursive: true, force: true });
    if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = saved;
  });

  test("loads only valid eligible lines from a ledger with one corrupt line", () => {
    const good = many(3).map((l) => JSON.stringify(l));
    const text = [good[0], "{not json", good[1], good[2]].join("\n") + "\n";
    writeFileSync(join(dir, "jev", "ledger.jsonl"), text);
    const read = readLedger(join(dir, "jev"));
    expect(read.kind).toBe("ok");
    const w = createCutpointWindow();
    w.load(read.kind === "ok" ? read.entries : []);
    expect(w.entries()).toHaveLength(3);
  });

  test("an unreadable ledger leaves the window empty", async () => {
    const f = fakeSetupPi();
    mkdirSync(join(dir, "jev", "ledger.jsonl"));
    expect(readLedger(join(dir, "jev")).kind).toBe("unreadable");
    const win = createCutpointWindow();
    setup(f.pi, { window: win });
    await f.start();
    expect(win.entries()).toEqual([]);
  });

  test("the ledger is read once per session, child sessions never read", async () => {
    const f = fakeSetupPi();
    let reads = 0;
    const win = createCutpointWindow();
    setup(f.pi, {
      window: win,
      readLines: () => {
        reads++;
        return many(150);
      },
    });
    await f.start();
    expect(reads).toBe(1);
    expect(win.entries()).toHaveLength(150);
    await f.handlers.get("before_agent_start")?.[0]?.({ prompt: "x" }, f.ctx("S1"));
    expect(reads).toBe(1);
  });
});

function fakeSetupPi() {
  const handlers = new Map<string, ((e: unknown, c: unknown) => unknown)[]>();
  let level = "low";
  const pi = {
    on: (n: string, h: (e: unknown, c: unknown) => unknown) =>
      handlers.set(n, [...(handlers.get(n) ?? []), h]),
    registerCommand: () => {},
    registerTool: () => {},
    registerEntryRenderer: () => {},
    appendEntry: () => {},
    getThinkingLevel: () => level,
    setThinkingLevel: (l: string) => {
      level = l;
    },
    exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
    getAllTools: () => [],
    getCommands: () => [],
    events: { on: () => () => {} },
  };
  const ctx = (id: string) => ({
    hasUI: false,
    mode: "rpc",
    ui: { setWidget: () => {}, notify: () => {} },
    sessionManager: { getSessionId: () => id },
  });
  return {
    pi: pi as unknown as ExtensionAPI,
    handlers,
    ctx,
    start: async () => {
      for (const h of handlers.get("session_start") ?? []) await h({}, ctx("S1"));
    },
  };
}

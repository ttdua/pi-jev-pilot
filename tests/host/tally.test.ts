import { describe, expect, test } from "bun:test";
import { createSessionLog } from "../../src/host/tally.ts";

type Entry = { t: string; d: unknown };

function setup(verbose = false, throwing = false) {
  const entries: Entry[] = [];
  const sw = { verbose };
  const pi = {
    appendEntry: (t: string, d: unknown) => {
      if (throwing) throw new Error("boom");
      entries.push({ t, d });
    },
  };
  const log = createSessionLog(pi as never, { verbose: () => sw.verbose });
  return { entries, sw, log };
}

const main = (session: string, extra: Record<string, unknown> = {}) => ({
  v: 1,
  at: 1,
  kind: "main",
  session,
  mode: "standard",
  answered: true,
  turnId: "t1",
  outcome: "ok",
  ...extra,
});
const worker = (session: string, extra: Record<string, unknown> = {}) => ({
  v: 1,
  at: 1,
  kind: "worker",
  session,
  mode: "standard",
  answered: true,
  agent: "scout",
  briefChars: 10,
  reason: "untouched",
  status: "completed",
  ...extra,
});
const correction = (session: string) => ({
  v: 1,
  at: 1,
  kind: "correction",
  session,
  turnId: "t1",
  corrects: 0.8,
});

describe("session tally", () => {
  test("Mixed session", () => {
    const { log } = setup();
    log.reset("S");
    for (let i = 0; i < 3; i++) log.record(main("S"));
    log.record(worker("S", { reason: "choice", tier: "fast", model: "fixture/fast", tokens: 100 }));
    log.record(
      worker("S", {
        reason: "choice",
        tier: "balanced",
        fallback: "deep",
        model: "fixture/deep",
        tokens: 50,
      }),
    );
    log.record(worker("S"));
    log.record(correction("S"));
    expect(log.tally()).toEqual({
      prompts: 3,
      workers: 3,
      byModel: [
        ["fixture/fast", 1],
        ["fixture/deep", 1],
      ],
      unrouted: 1,
      workerTokens: 150,
      fallbacks: 1,
    });
    expect(log.prompts()).toBe(3);
  });

  test("tally returns a fresh snapshot", () => {
    const { log } = setup();
    log.reset("S");
    log.record(worker("S", { reason: "choice", tier: "fast", model: "fixture/m" }));
    const a = log.tally();
    log.record(worker("S", { reason: "choice", tier: "fast", model: "fixture/m" }));
    expect(a.byModel).toEqual([["fixture/m", 1]]);
  });

  test("Nothing could run is not a fallback", () => {
    const { log } = setup();
    log.reset("S");
    log.record(worker("S", { reason: "choice", tier: "balanced", fallback: "balanced" }));
    expect(log.tally().fallbacks).toBe(0);
    expect(log.tally().unrouted).toBe(1);
  });

  test("fallback without tier not counted", () => {
    const { log } = setup();
    log.reset("S");
    log.record(worker("S", { fallback: "deep" }));
    expect(log.tally().fallbacks).toBe(0);
  });

  test("Jev down", () => {
    const { log } = setup();
    log.reset("S");
    log.record(main("S", { answered: false, miss: "error" }));
    expect(log.prompts()).toBe(1);
  });

  test("Invalid line ignored", () => {
    const { log, entries, sw } = setup(true);
    log.reset("S");
    log.record(worker("S", { agent: "my agent!" }));
    expect(log.tally().workers).toBe(0);
    expect(entries).toEqual([]);
    expect(sw.verbose).toBe(true);
  });

  test("correction counts nothing", () => {
    const { log } = setup();
    log.reset("S");
    log.record(correction("S"));
    expect(log.tally()).toEqual({
      prompts: 0,
      workers: 0,
      byModel: [],
      unrouted: 0,
      workerTokens: 0,
      fallbacks: 0,
    });
  });

  test("reset clears", () => {
    const { log } = setup();
    log.reset("S1");
    for (let i = 0; i < 4; i++) log.record(main("S1"));
    log.reset("S2");
    expect(log.prompts()).toBe(0);
  });

  test("late line from replaced session", () => {
    const { log, entries } = setup(true);
    log.reset("A");
    log.reset("B");
    log.record(worker("A"));
    expect(log.tally().workers).toBe(0);
    expect(entries).toEqual([]);
  });

  test("child line ignored", () => {
    const { log, entries } = setup(true);
    log.reset("main-1");
    log.record(main("child-1"));
    expect(log.prompts()).toBe(0);
    expect(entries).toEqual([]);
  });

  test("no session before reset", () => {
    const { log, entries } = setup(true);
    log.record(main("S"));
    expect(log.prompts()).toBe(0);
    expect(entries).toEqual([]);
  });
});

describe("verbose log", () => {
  test("Verbose off by default", () => {
    const { log, entries } = setup();
    log.reset("S");
    log.record(main("S"));
    expect(entries).toEqual([]);
  });

  test("Verbose on", () => {
    const { log, entries } = setup(true);
    log.reset("S");
    const line = main("S");
    log.record(line);
    expect(entries).toEqual([{ t: "jev-log", d: line }]);
  });

  test("Worker line logged", () => {
    const { log, entries } = setup(true);
    log.reset("S");
    const line = worker("S", { reason: "choice", tier: "fast", model: "fixture/fast" });
    log.record(line);
    expect(entries).toEqual([{ t: "jev-log", d: line }]);
  });

  test("Correction logged", () => {
    const { log, entries } = setup(true);
    log.reset("S");
    log.record(correction("S"));
    log.record(main("S"));
    expect(entries.map((e) => (e.d as { kind: string }).kind)).toEqual(["correction", "main"]);
  });

  test("switch read at record time", () => {
    const { log, entries, sw } = setup(false);
    log.reset("S");
    log.record(main("S"));
    sw.verbose = true;
    log.record(main("S"));
    expect(entries).toHaveLength(1);
  });

  test("Throwing appendEntry", () => {
    const { log } = setup(true, true);
    log.reset("S");
    expect(() => log.record(main("S"))).not.toThrow();
    expect(log.prompts()).toBe(1);
  });

  test("Throwing verbose switch keeps the counts", () => {
    const entries: Entry[] = [];
    const log = createSessionLog(
      { appendEntry: (t: string, d: unknown) => void entries.push({ t, d }) } as never,
      {
        verbose: () => {
          throw new Error("x");
        },
      },
    );
    log.reset("S");
    expect(() => log.record(main("S"))).not.toThrow();
    expect(log.prompts()).toBe(1);
  });
});

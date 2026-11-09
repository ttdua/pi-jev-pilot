import { afterEach, describe, expect, test } from "bun:test";
import { CHILDREN_KEY, isChild, subscribeChildren } from "../../src/host/child.ts";

type Handler = (data: unknown) => void;

function fakeBus() {
  const map = new Map<string, Set<Handler>>();
  return {
    on(channel: string, handler: Handler) {
      const set = map.get(channel) ?? new Set<Handler>();
      map.set(channel, set);
      set.add(handler);
      return () => {
        set.delete(handler);
      };
    },
    emit(channel: string, data: unknown) {
      for (const h of map.get(channel) ?? []) h(data);
    },
  };
}

const CREATED = "subagents:child:session-created";
const DISPOSED = "subagents:child:disposed";
const registry = () => (globalThis as Record<symbol, Set<string> | undefined>)[CHILDREN_KEY];

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[CHILDREN_KEY];
});

describe("child registry", () => {
  test("records created id", () => {
    const bus = fakeBus();
    subscribeChildren(bus);
    bus.emit(CREATED, { sessionId: "c1" });
    expect(isChild("c1")).toBe(true);
    expect(isChild("main")).toBe(false);
  });

  test("removes disposed id", () => {
    const bus = fakeBus();
    subscribeChildren(bus);
    bus.emit(CREATED, { sessionId: "c1" });
    bus.emit(DISPOSED, { sessionId: "c1" });
    expect(isChild("c1")).toBe(false);
  });

  test("ignores bad payloads", () => {
    const bus = fakeBus();
    subscribeChildren(bus);
    for (const ch of [CREATED, DISPOSED]) {
      for (const p of [{}, null, { sessionId: 7 }]) bus.emit(ch, p);
    }
    expect(registry()?.size ?? 0).toBe(0);
  });

  test("bad disposed payloads keep recorded ids", () => {
    const bus = fakeBus();
    subscribeChildren(bus);
    bus.emit(CREATED, { sessionId: "c1" });
    for (const p of [{}, null, { sessionId: 7 }]) bus.emit(DISPOSED, p);
    expect(isChild("c1")).toBe(true);
  });

  test("shared across instances", () => {
    const a = fakeBus();
    const b = fakeBus();
    subscribeChildren(a);
    subscribeChildren(b);
    a.emit(CREATED, { sessionId: "c1" });
    expect(isChild("c1")).toBe(true);
    expect(registry()?.size).toBe(1);
  });

  test("unsubscribe stops recording", () => {
    const bus = fakeBus();
    const off = subscribeChildren(bus);
    off();
    bus.emit(CREATED, { sessionId: "c2" });
    expect(isChild("c2")).toBe(false);
  });
});

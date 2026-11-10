import { describe, expect, test } from "bun:test";
import { LaunchBook } from "../../../src/host/worker/launches.ts";

type Entry = { name: string; seq?: number };
const entry = (name: string, seq?: number): Entry => ({
  name,
  ...(seq === undefined ? {} : { seq }),
});

describe("LaunchBook: launches by tool call id", () => {
  test("keeps a launch until its tool result takes it", () => {
    const book = new LaunchBook<Entry, string>();
    const a = entry("a");
    book.remember("t1", a);

    expect(book.launch("t1")).toBe(a);
    expect(book.take("t1")).toBe(a);
    expect(book.launch("t1")).toBeUndefined();
  });

  test("drops the oldest launch past the cap", () => {
    const book = new LaunchBook<Entry, string>(2);
    book.remember("t1", entry("a"));
    book.remember("t2", entry("b"));
    book.remember("t3", entry("c"));

    expect(book.launch("t1")).toBeUndefined();
    expect(book.pending()).toBe(2);
  });

  test("remembering an id again makes it the newest", () => {
    const book = new LaunchBook<Entry, string>(2);
    book.remember("t1", entry("a"));
    book.remember("t2", entry("b"));
    book.remember("t1", entry("a2"));
    book.remember("t3", entry("c"));

    expect(book.launch("t1")?.name).toBe("a2");
    expect(book.launch("t2")).toBeUndefined();
  });
});

describe("LaunchBook: joining launches and executor outcomes", () => {
  test("an outcome stamped after the launch's tool call joins it", () => {
    const book = new LaunchBook<Entry, string>();
    const launch = entry("a", book.nextSeq());
    book.buffer("ag-1", () => "done");

    expect(book.join("ag-1", launch)).toEqual({ kind: "write", outcome: "done" });
    expect(book.pending()).toBe(0);
  });

  test("an outcome stamped before the launch's tool call is not its own", () => {
    const book = new LaunchBook<Entry, string>();
    book.buffer("ag-1", () => "stale");
    const launch = entry("a", book.nextSeq());

    expect(book.join("ag-1", launch)).toEqual({ kind: "parked" });
    expect(book.claim("ag-1")).toBe(launch);
  });

  test("a launch whose outcome has not arrived is parked until the outcome claims it", () => {
    const book = new LaunchBook<Entry, string>();
    const launch = entry("a", book.nextSeq());

    expect(book.join("ag-1", launch)).toEqual({ kind: "parked" });
    expect(book.claim("ag-1")).toBe(launch);
    expect(book.claim("ag-1")).toBeUndefined();
  });

  test("dropping an agent forgets its buffered outcome", () => {
    const book = new LaunchBook<Entry, string>();
    book.buffer("ag-1", () => "done");
    book.dropOutcome("ag-1");

    expect(book.pending()).toBe(0);
  });
});

describe("LaunchBook: switching off", () => {
  test("stop ignores new events and clear forgets what was held", () => {
    const book = new LaunchBook<Entry, string>();
    book.remember("t1", entry("a"));
    book.buffer("ag-2", () => "done");
    book.join("ag-3", entry("c", book.nextSeq()));

    book.stop();
    expect(book.isOpen()).toBe(false);
    expect(book.pending()).toBe(3);

    book.clear();
    expect(book.pending()).toBe(0);
  });
});

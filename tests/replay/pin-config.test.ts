import { describe, expect, test } from "bun:test";
import { parseArgs, UsageError } from "../../scripts/replay/config.ts";

const base = { pass: 1, seed: 1, main: 100, send: false };

describe("parseArgs characterization", () => {
  const good: [string, string[], object][] = [
    ["defaults", ["--pass", "1"], base],
    ["report pass", ["--pass", "report"], { ...base, pass: "report" }],
    ["seed", ["--pass", "1", "--seed", "0"], { ...base, seed: 0 }],
    ["main", ["--main", "5", "--pass", "1"], { ...base, main: 5 }],
    ["workers", ["--pass", "1", "--workers", "12"], { ...base, workers: 12 }],
    [
      "workers zero",
      ["--pass", "report", "--workers", "0"],
      { ...base, pass: "report", workers: 0 },
    ],
    ["sessions", ["--pass", "1", "--sessions", "/s"], { ...base, sessions: "/s" }],
    [
      "capabilities",
      ["--pass", "1", "--capabilities", "c.json"],
      { ...base, capabilities: "c.json" },
    ],
    ["url", ["--pass", "1", "--url", "http://x"], { ...base, url: "http://x" }],
    ["models is accepted and dropped", ["--pass", "1", "--models", "m.json"], base],
    ["only list", ["--pass", "1", "--only", "full,min"], { ...base, only: ["full", "min"] }],
    ["only skips empty names", ["--pass", "1", "--only", ",full,,"], { ...base, only: ["full"] }],
    ["send", ["--send", "--pass", "1"], { ...base, send: true }],
    [
      "later flag wins",
      ["--pass", "1", "--seed", "2", "--seed", "3", "--pass", "report"],
      {
        ...base,
        pass: "report",
        seed: 3,
      },
    ],
  ];
  for (const [name, argv, expected] of good) {
    test(`parses: ${name}`, () => {
      expect(parseArgs(argv)).toEqual(expected as never);
    });
  }

  test("result key order is stable", () => {
    const a = parseArgs([
      "--pass",
      "1",
      "--only",
      "a",
      "--url",
      "u",
      "--capabilities",
      "c",
      "--sessions",
      "s",
      "--workers",
      "2",
      "--send",
    ]);
    expect(Object.keys(a)).toEqual([
      "pass",
      "seed",
      "main",
      "workers",
      "sessions",
      "capabilities",
      "url",
      "only",
      "send",
    ]);
  });

  const bad: [string, string[], string][] = [
    ["no args", [], "--pass is required"],
    ["only send", ["--send"], "--pass is required"],
    ["pass missing value", ["--pass"], "--pass accepts 1 or report"],
    ["pass 2", ["--pass", "2"], "--pass accepts 1 or report"],
    ["pass flag as value", ["--pass", "--send"], "--pass accepts 1 or report"],
    ["unknown", ["--pass", "1", "--nope"], "unknown argument: --nope"],
    ["positional", ["x", "--pass", "1"], "unknown argument: x"],
    ["seed nan", ["--pass", "1", "--seed", "x"], "--seed needs a non-negative integer"],
    ["seed negative", ["--pass", "1", "--seed", "-1"], "--seed needs a non-negative integer"],
    ["seed fraction", ["--pass", "1", "--seed", "1.5"], "--seed needs a non-negative integer"],
    ["seed empty", ["--pass", "1", "--seed", ""], "--seed needs a non-negative integer"],
    ["seed missing", ["--pass", "1", "--seed"], "--seed needs a non-negative integer"],
    ["main bad", ["--pass", "1", "--main", "a"], "--main needs a non-negative integer"],
    ["workers bad", ["--pass", "1", "--workers", "-2"], "--workers needs a non-negative integer"],
    ["sessions missing", ["--pass", "1", "--sessions"], "--sessions needs a value"],
    ["url empty", ["--pass", "1", "--url", ""], "--url needs a value"],
    ["models missing", ["--pass", "1", "--models"], "--models needs a value"],
    ["capabilities missing", ["--pass", "1", "--capabilities"], "--capabilities needs a value"],
    ["only missing", ["--pass", "1", "--only"], "--only needs a value"],
    [
      "only blank list",
      ["--pass", "1", "--only", ",,"],
      "--only needs a comma-separated list of variants",
    ],
    ["only with report", ["--pass", "report", "--only", "x"], "--only applies to pass 1"],
    [
      "error order: bad seed before missing pass",
      ["--seed", "x"],
      "--seed needs a non-negative integer",
    ],
    ["error order: missing pass before only check", ["--only", "x"], "--pass is required"],
  ];
  for (const [name, argv, message] of bad) {
    test(`rejects: ${name}`, () => {
      let caught: unknown;
      try {
        parseArgs(argv);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(UsageError);
      expect((caught as Error).message).toBe(message);
    });
  }
});

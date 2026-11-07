import { describe, expect, test } from "bun:test";

import type { JevOutcome } from "../../src/jev/client.ts";
import { buildWorkerQuestions } from "../../src/jev/questions.ts";
import { readWorkerOutcome } from "../../src/policy/worker.ts";

const { specs } = buildWorkerQuestions(["fast", "balanced", "deep"], {}, "standard");

function choice(name: string, options: string[]): unknown {
  return {
    type: "choice",
    choice: name,
    probabilities: Object.fromEntries(options.map((o) => [o, o === name ? 1 : 0])),
  };
}

describe("Reading worker answers", () => {
  test("Jev timeout or error", () => {
    const t: JevOutcome = { kind: "miss", miss: "timeout", reason: "t", ms: 1 };
    expect(readWorkerOutcome(t, specs)).toEqual({ kind: "miss", miss: "timeout" });
    const e: JevOutcome = { kind: "miss", miss: "error", reason: "e", ms: 1 };
    expect(readWorkerOutcome(e, specs)).toEqual({ kind: "miss", miss: "error" });
  });

  test("Body without answers", () => {
    const o: JevOutcome = { kind: "ok", body: { model: "jev-1.14.0" }, ms: 1 };
    expect(readWorkerOutcome(o, specs)).toEqual({ kind: "miss", miss: "schema" });
  });

  test("One bad answer", () => {
    const tierSpec = specs["tier"];
    const effortSpec = specs["effort"];
    if (tierSpec?.type !== "choice" || effortSpec?.type !== "choice") throw new Error("specs");
    const body = {
      answers: {
        tier: choice(tierSpec.options[0] ?? "", [...tierSpec.options]),
        effort: choice("extreme", [...effortSpec.options]),
      },
    };
    const r = readWorkerOutcome({ kind: "ok", body }, specs);
    if (r.kind !== "read") throw new Error("expected read");
    expect(r.answers["tier"]).toBeDefined();
    expect(r.unanswered["effort"]).toBe("choice");
  });

  test("Cancelled", () => {
    expect(readWorkerOutcome({ kind: "cancelled" }, specs)).toEqual({ kind: "cancelled" });
  });
});

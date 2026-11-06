import { describe, expect, test } from "bun:test";

import {
  readAnswers,
  type ReadResult,
  type QuestionSpec,
  type UnansweredReason,
} from "../../src/policy/answers";

const EFFORT: QuestionSpec = { type: "choice", options: ["low", "medium", "high", "xhigh", "max"] };
const STRATEGY: QuestionSpec = {
  type: "choice",
  options: ["direct", "delegate", "parallel", "graph"],
};
const NOUL: QuestionSpec = { type: "noul" };

function validEffort(): {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
} {
  return {
    type: "choice",
    choice: "low",
    confidence: 0.73,
    probabilities: { low: 0.78, medium: 0.15, high: 0.06, xhigh: 0.01, max: 0 },
  };
}

function withEffort(answer: unknown) {
  return readAnswers({ effort: EFFORT }, { answers: { effort: answer } });
}

function unansweredEffort(reason: UnansweredReason): ReadResult {
  return { kind: "read", answers: {}, unanswered: { effort: reason } };
}

describe("Envelope check", () => {
  test("Missing answers", () => {
    expect(readAnswers({ effort: EFFORT }, { model: "jev-1.14.0" })).toEqual({
      kind: "miss",
      miss: "schema",
    });
  });

  test.each([[{ answers: [] }], [{ answers: null }], [[]], [null], ["x"]])(
    "Answers is not an object %#",
    (body) => {
      expect(readAnswers({ effort: EFFORT }, body)).toEqual({ kind: "miss", miss: "schema" });
    },
  );
});

describe("Every asked question is accounted for", () => {
  test("Unasked key ignored", () => {
    const r = readAnswers(
      { risky: NOUL },
      { answers: { risky: { type: "noul", noul: 0.2 }, effort: validEffort() } },
    );
    expect(r).toEqual({
      kind: "read",
      answers: { risky: { type: "noul", noul: 0.2 } },
      unanswered: {},
    });
    expect(JSON.stringify(r)).not.toContain("effort");
  });

  test("Asked key absent", () => {
    expect(readAnswers({ effort: EFFORT }, { answers: {} })).toEqual(unansweredEffort("missing"));
  });

  test("Inherited key reads as missing", () => {
    expect(readAnswers({ toString: NOUL }, { answers: {} })).toEqual({
      kind: "read",
      answers: {},
      unanswered: Object.fromEntries([["toString", "missing"]]) as Record<string, UnansweredReason>,
    });
  });
});

describe("Choice answers are strict", () => {
  test("Valid choice", () => {
    expect(withEffort(validEffort())).toEqual({
      kind: "read",
      answers: {
        effort: {
          type: "choice",
          choice: "low",
          confidence: 0.73,
          probabilities: { low: 0.78, medium: 0.15, high: 0.06, xhigh: 0.01, max: 0 },
        },
      },
      unanswered: {},
    });
  });

  test("Unknown choice", () => {
    expect(withEffort({ ...validEffort(), choice: "extreme" })).toEqual(unansweredEffort("choice"));
  });

  test("Missing probability key", () => {
    const { max: _max, ...rest } = validEffort().probabilities;
    expect(withEffort({ ...validEffort(), probabilities: rest })).toEqual(
      unansweredEffort("probabilities"),
    );
  });

  test("Extra probability key", () => {
    const probabilities = { ...validEffort().probabilities, ultra: 0 };
    expect(withEffort({ ...validEffort(), probabilities })).toEqual(
      unansweredEffort("probabilities"),
    );
  });

  test("__proto__ key in probabilities", () => {
    const probabilities = JSON.parse(
      '{"__proto__":1,"low":0.5,"medium":0.1,"high":0.1,"xhigh":0.1}',
    );
    expect(withEffort({ ...validEffort(), probabilities })).toEqual(
      unansweredEffort("probabilities"),
    );
  });

  test.each([[1.2], [-0.1], ["0.5"], [Number.NaN], [null]])(
    "Probability out of range %#",
    (bad) => {
      const probabilities = { ...validEffort().probabilities, medium: bad };
      expect(withEffort({ ...validEffort(), probabilities })).toEqual(unansweredEffort("range"));
    },
  );

  test.each([[{ type: "noul", noul: 0.4 }], [null], ["low"], [undefined], [[]]])(
    "Wrong type for a choice question %#",
    (answer) => {
      expect(withEffort(answer)).toEqual(unansweredEffort("type"));
    },
  );

  test.each([[null], [[]], ["x"], [undefined]])(
    "Probabilities not an object %#",
    (probabilities) => {
      expect(withEffort({ ...validEffort(), probabilities })).toEqual(
        unansweredEffort("probabilities"),
      );
    },
  );
});

describe("Noul answers are strict", () => {
  test("Valid noul at a boundary", () => {
    expect(
      readAnswers(
        { risky: NOUL, corrects: NOUL },
        { answers: { risky: { type: "noul", noul: 0 }, corrects: { type: "noul", noul: 1 } } },
      ),
    ).toEqual({
      kind: "read",
      answers: { risky: { type: "noul", noul: 0 }, corrects: { type: "noul", noul: 1 } },
      unanswered: {},
    });
  });

  test.each([
    [{ type: "noul", noul: 1.01 }],
    [{ type: "noul" }],
    [{ type: "noul", noul: "0.5" }],
    [{ type: "noul", noul: -0.01 }],
  ])("Noul out of range %#", (answer) => {
    expect(readAnswers({ risky: NOUL }, { answers: { risky: answer } })).toEqual({
      kind: "read",
      answers: {},
      unanswered: { risky: "range" },
    });
  });

  test("Wrong type for a noul question", () => {
    expect(
      readAnswers(
        { risky: NOUL },
        { answers: { risky: { type: "choice", choice: "yes", probabilities: { yes: 1 } } } },
      ),
    ).toEqual({ kind: "read", answers: {}, unanswered: { risky: "type" } });
  });
});

describe("One bad answer leaves the others", () => {
  test("Mixed good and bad", () => {
    const r = readAnswers(
      { effort: EFFORT, risky: NOUL, strategy: STRATEGY },
      {
        answers: {
          effort: validEffort(),
          risky: { type: "noul", noul: 0.08 },
          strategy: {
            type: "choice",
            choice: "solo",
            probabilities: { direct: 1, delegate: 0, parallel: 0, graph: 0 },
          },
        },
      },
    );
    expect(r).toEqual({
      kind: "read",
      answers: {
        effort: {
          type: "choice",
          choice: "low",
          confidence: 0.73,
          probabilities: validEffort().probabilities,
        },
        risky: { type: "noul", noul: 0.08 },
      },
      unanswered: { strategy: "choice" },
    });
  });
});

describe("Confidence is carried, never required", () => {
  test("Confidence absent", () => {
    const { confidence: _c, ...answer } = validEffort();
    const r = withEffort(answer);
    expect(r.kind === "read" && r.answers.effort).toEqual({
      type: "choice",
      choice: "low",
      probabilities: validEffort().probabilities,
    });
    expect(r.kind === "read" && "confidence" in (r.answers.effort ?? {})).toBe(false);
  });

  test("Confidence invalid", () => {
    const r = withEffort({ ...validEffort(), confidence: 7 });
    expect(r.kind === "read" && r.answers.effort).toEqual({
      type: "choice",
      choice: "low",
      probabilities: validEffort().probabilities,
    });
    expect(r.kind === "read" && "confidence" in (r.answers.effort ?? {})).toBe(false);
  });
});

describe("Reading is pure", () => {
  test("Same input, same result", () => {
    const specs = { effort: EFFORT, risky: NOUL };
    const body = {
      answers: { effort: validEffort(), risky: { type: "noul", noul: 0.5 }, extra: 1 },
    };
    const specsCopy = structuredClone(specs);
    const bodyCopy = structuredClone(body);
    const a = readAnswers(specs, body);
    const b = readAnswers(specs, body);
    expect(a).toEqual(b);
    expect(specs).toEqual(specsCopy);
    expect(body).toEqual(bodyCopy);
  });
});

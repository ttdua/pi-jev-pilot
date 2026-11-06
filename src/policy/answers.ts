// Pure answer reading for Jev responses. Imports nothing outside src/policy/.

export type MissKind = "timeout" | "error" | "schema";

export type QuestionSpec =
  | { readonly type: "choice"; readonly options: readonly string[] }
  | { readonly type: "noul" };

export type ChoiceAnswer = {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence?: number;
};

export type NoulAnswer = { type: "noul"; noul: number };

export type Answer = ChoiceAnswer | NoulAnswer;

export type UnansweredReason = "missing" | "type" | "choice" | "probabilities" | "range";

export type ReadResult =
  | { kind: "miss"; miss: "schema" }
  | {
      kind: "read";
      answers: Record<string, Answer>;
      unanswered: Record<string, UnansweredReason>;
    };

type Checked = { ok: true; answer: Answer } | { ok: false; reason: UnansweredReason };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function fail(reason: UnansweredReason): Checked {
  return { ok: false, reason };
}

function checkChoice(options: readonly string[], raw: unknown): Checked {
  if (!isRecord(raw) || raw["type"] !== "choice") return fail("type");
  const choice = raw["choice"];
  if (typeof choice !== "string" || !options.includes(choice)) return fail("choice");
  const probs = raw["probabilities"];
  if (!isRecord(probs)) return fail("probabilities");
  const keys = Object.keys(probs);
  if (keys.length !== options.length || !options.every((o) => keys.includes(o))) {
    return fail("probabilities");
  }
  const probabilities: Record<string, number> = {};
  for (const key of keys) {
    const p = probs[key];
    if (!isUnit(p)) return fail("range");
    Object.defineProperty(probabilities, key, {
      value: p,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  const answer: ChoiceAnswer = { type: "choice", choice, probabilities };
  if (isUnit(raw["confidence"])) answer.confidence = raw["confidence"];
  return { ok: true, answer };
}

function checkNoul(raw: unknown): Checked {
  if (!isRecord(raw) || raw["type"] !== "noul") return fail("type");
  const noul = raw["noul"];
  if (!isUnit(noul)) return fail("range");
  return { ok: true, answer: { type: "noul", noul } };
}

export function readAnswers(
  specs: Readonly<Record<string, QuestionSpec>>,
  body: unknown,
): ReadResult {
  if (!isRecord(body) || !isRecord(body["answers"])) return { kind: "miss", miss: "schema" };
  const given = body["answers"];
  const answers: Record<string, Answer> = {};
  const unanswered: Record<string, UnansweredReason> = {};
  for (const key of Object.keys(specs)) {
    const spec = specs[key];
    if (spec === undefined) continue;
    if (!Object.hasOwn(given, key)) {
      unanswered[key] = "missing";
      continue;
    }
    const raw = given[key];
    const checked = spec.type === "choice" ? checkChoice(spec.options, raw) : checkNoul(raw);
    if (checked.ok) answers[key] = checked.answer;
    else unanswered[key] = checked.reason;
  }
  return { kind: "read", answers, unanswered };
}

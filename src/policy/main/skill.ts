import type { Answer, ChoiceAnswer, ReadResult } from "../answers.ts";
import { cutCodePoints } from "../../shared/text.ts";

/** One catalog skill; `body` is already without frontmatter. */
export type SkillEntry = { name: string; description?: string; body?: string };

/** Option meaning "no skill fits". */
export const NONE_OPTION = "(none)";

/** Most options one request may carry. */
export const MAX_BATCH = 254;

const EXCERPT_LENGTH = 300;
const SEPARATOR = " — ";

/** Option text: trimmed description, then the body's first 300 code points. */
export function skillCriterion(entry: SkillEntry): string {
  const description = entry.description?.trim() ?? "";
  const excerpt = cutCodePoints(entry.body?.trim() ?? "", EXCERPT_LENGTH);
  const parts = [description, excerpt].filter((part) => part !== "");
  return parts.length === 0 ? `A skill named ${entry.name}.` : parts.join(SEPARATOR);
}

/** Catalog split into near-equal batches of at most `MAX_BATCH`, in order. */
export function skillBatches(entries: readonly SkillEntry[]): SkillEntry[][] {
  const seen = new Set<string>([NONE_OPTION]);
  const unique = entries.filter((entry) => {
    if (seen.has(entry.name)) return false;
    seen.add(entry.name);
    return true;
  });
  if (unique.length === 0) return [];
  const count = Math.ceil(unique.length / MAX_BATCH);
  const size = Math.ceil(unique.length / count);
  return Array.from({ length: count }, (_, i) => unique.slice(i * size, (i + 1) * size));
}

/** Gate questions sent with the first batch, in request order. */
export const GATE_KEYS = [
  "gate::acts_on_user_system",
  "gate::would_follow_documented_procedure",
  "gate::prose_suffices",
] as const;

export type GateKey = (typeof GATE_KEYS)[number];

// Thresholds follow upstream jev-pilot 0.12.1's skill-suggestion policy, which
// replay measured on 16 prompts (docs/evidence/2026-11-05-replay.md, "Skill .5 and .3").

/** Leader probability at which a skill is picked without a gate. */
export const SURE_PICK = 0.5;

/** Lowest leader probability at which the gate mean may support a pick. */
export const FIT_PICK = 0.3;

/** Lowest gate mean that supports a leader between `FIT_PICK` and `SURE_PICK`. */
export const GATE_PICK = 0.3;

export type SkillPick =
  | { kind: "picked"; name: string; p: number; gate?: number }
  | { kind: "none"; reason: "below"; p: number; gate?: number }
  | { kind: "none"; reason: "none-leads"; gate?: number }
  | { kind: "none"; reason: "no-batch" | "failed" };

/** Option with the strict maximum probability (first in asked order); undefined when `(none)`. */
export function batchLeader(
  options: readonly string[],
  answer: ChoiceAnswer,
): { name: string; p: number } | undefined {
  let best: { name: string; p: number } | undefined;
  for (const name of options) {
    const p = answer.probabilities[name];
    if (p !== undefined && (best === undefined || p > best.p)) best = { name, p };
  }
  return best === undefined || best.name === NONE_OPTION ? undefined : best;
}

/** Mean over the gates present, `prose_suffices` as `1 - p`; undefined with none present. */
export function gateMean(answers: Record<string, Answer>): number | undefined {
  const values: number[] = [];
  for (const key of GATE_KEYS) {
    const answer = answers[key];
    if (answer?.type !== "noul") continue;
    values.push(key === "gate::prose_suffices" ? 1 - answer.noul : answer.noul);
  }
  if (values.length === 0) return undefined;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

type PickBatch = { options: readonly string[]; read: ReadResult | undefined };

function whichAnswer(read: ReadResult | undefined): ChoiceAnswer | undefined {
  if (read?.kind !== "read") return undefined;
  const which = read.answers["which"];
  return which?.type === "choice" ? which : undefined;
}

function withGate<T extends object>(base: T, gate: number | undefined): T & { gate?: number } {
  return gate === undefined ? base : { ...base, gate };
}

type Leader = { name: string; p: number };

// The leader with the strictly highest p across batches; the earlier batch wins ties.
function bestLeader(
  batches: readonly PickBatch[],
  whichAnswers: readonly (ChoiceAnswer | undefined)[],
): Leader | undefined {
  let best: Leader | undefined;
  for (const [i, batch] of batches.entries()) {
    const answer = whichAnswers[i];
    const leader = answer === undefined ? undefined : batchLeader(batch.options, answer);
    if (leader !== undefined && (best === undefined || leader.p > best.p)) best = leader;
  }
  return best;
}

// A sure leader needs no gate; a weaker one needs the gate mean to support it.
function supportsPick(best: Leader, gate: number | undefined): boolean {
  const sure = best.p >= SURE_PICK;
  const fits = best.p >= FIT_PICK && gate !== undefined && gate >= GATE_PICK;
  return sure || fits;
}

/** Pick one skill from the batches' `which` answers; batch 0's gates support weaker leaders. */
export function pickSkill(batches: readonly PickBatch[]): SkillPick {
  if (batches.length === 0) return { kind: "none", reason: "no-batch" };
  const whichAnswers = batches.map((batch) => whichAnswer(batch.read));
  if (whichAnswers.some((answer) => answer === undefined)) {
    return { kind: "none", reason: "failed" };
  }
  const first = batches[0]?.read;
  const gate = first?.kind === "read" ? gateMean(first.answers) : undefined;
  const best = bestLeader(batches, whichAnswers);
  if (best === undefined) return withGate({ kind: "none", reason: "none-leads" }, gate);
  if (supportsPick(best, gate)) {
    return withGate({ kind: "picked", name: best.name, p: best.p }, gate);
  }
  return withGate({ kind: "none", reason: "below", p: best.p }, gate);
}

export type DeliveryForm = "content" | "suggest" | "reference";

/** Pure lookup: `reference` only when the same name with the same fingerprint is already in context. */
export function deliveryForm(o: {
  name: string;
  fingerprint: string;
  inject: "content" | "suggest";
  loaded: readonly { name: string; fingerprint: string }[];
}): DeliveryForm {
  const same = o.loaded.some((l) => l.name === o.name && l.fingerprint === o.fingerprint);
  return same ? "reference" : o.inject;
}

export function deliveryText(
  form: DeliveryForm,
  skill: { name: string; path: string; baseDir: string; body: string },
): string {
  const { name, path, baseDir, body } = skill;
  const head = [
    "<skill_relevance>",
    `Relevant to the current request: ${name}. Ignore this if it does not fit what the user actually asked for.`,
  ];
  const tail = ["</skill_relevance>"];
  if (form === "content") {
    return [
      ...head,
      `<skill name="${name}" location="${path}">`,
      `References are relative to ${baseDir}.`,
      "",
      body,
      "</skill>",
      ...tail,
    ].join("\n");
  }
  if (form === "suggest") {
    return [
      ...head,
      `Its instructions are in ${path}, with references relative to ${baseDir}. Read that file before you start if the skill fits.`,
      ...tail,
    ].join("\n");
  }
  return [
    ...head,
    `Skill ${name} is already loaded above; its instructions are unchanged.`,
    ...tail,
  ].join("\n");
}

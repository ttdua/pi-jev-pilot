// Plans the requests of a replay run: one change per variant, each with a named base.
import type { QuestionSpec } from "../../src/policy/answers.ts";
import { buildWorkerState, mainState, pickRich, type RichGroup } from "../../src/jev/state.ts";
import { buildWorkerQuestions, mainQuestions, offeredTiers } from "../../src/jev/questions.ts";
import { MAIN_EFFORT_INSTRUCTION, type WireQuestion } from "../../src/jev/rubrics.ts";
import type { AgentFacts, TierName } from "../../src/policy/launch.ts";
import type { ModeName } from "../../src/policy/worker/index.ts";
import type { RebuiltMain, RebuiltWorker } from "./inputs.ts";

/** The operator config, already merged with the mode and switches kept in `state.json`. */
export type PlainConfig = {
  tiers: Partial<Record<TierName, string>>;
  slots: { name: string; model: string; when: string }[];
  mode: ModeName;
  expertOn: boolean;
};

export type PlannedRequest = {
  variant: string;
  base: string;
  sample: number;
  kind: "main" | "worker";
  state: unknown;
  questions: unknown;
  specs: Record<string, QuestionSpec>;
};

/** Keys a variant by kind. `rerun-a` and `rerun-b` exist in both kinds, so a worker id is `worker:<id>`. */
export function variantKey(kind: "main" | "worker", id: string): string {
  return kind === "worker" ? `worker:${id}` : id;
}

const WORKER_PREFIX = "worker:";

/** What a `variantKey` stands for: its kind and the key of the variant it is compared with. */
export function baseOfKey(key: string): { kind: "main" | "worker"; base: string } {
  if (key.startsWith(WORKER_PREFIX)) return { kind: "worker", base: variantKey("worker", "base") };
  const onFull = key.startsWith("full-") || isNewFull(key);
  return { kind: "main", base: onFull ? "full" : "minimal" };
}

/** Variants that change one thing against `full`. Their ids are always valid for `--only`. */
export const NEW_FULL_VARIANTS = ["role-rule", "no-prompt-chars"] as const;

const isNewFull = (id: string): boolean => (NEW_FULL_VARIANTS as readonly string[]).includes(id);

/** The candidate sentence for replies to the assistant's own question, by role rather than length. */
export const ROLE_RULE_SENTENCE =
  "A reply to the assistant's own question, proposal, review or approval request, such as approving it, picking an option, answering it or asking to continue, whatever its length and however it is formatted, takes the size of the work it approves or starts, judged from the recent conversation rather than from the reply's own text.";

const SHORT_REPLY = "A short reply";

/** The shipped instruction cut before its short-reply sentence, plus the role rule. */
export function roleRuleInstruction(shipped: string): string {
  const at = shipped.indexOf(SHORT_REPLY);
  if (at < 0) throw new Error("the effort instruction has no short-reply sentence");
  return `${shipped.slice(0, at)}${ROLE_RULE_SENTENCE}`;
}

export type Plan = {
  requests: PlannedRequest[];
  skipped: string[];
  /** Counts by `variantKey`. */
  excluded: Record<string, number>;
};

export type PlanInput = {
  main: RebuiltMain[];
  workers: RebuiltWorker[];
  config: PlainConfig;
  hasSnapshot: boolean;
  /** When set, only the bases, the reruns and these variants are planned. */
  only?: readonly string[];
};

/** Variants every run keeps: the bases and the reruns they are measured against. */
const ALWAYS = new Set(["minimal", "rerun-a", "rerun-b", "base"]);

function selected(id: string, only: readonly string[] | undefined): boolean {
  if (only === undefined || ALWAYS.has(id) || only.includes(id)) return true;
  // `full` is the base of every `full-G` and of the new full-based variants.
  return id === "full" && only.some((o) => o.startsWith("full-") || isNewFull(o));
}

const GROUPS: readonly RichGroup[] = ["last_decision", "capabilities"];

type MainVariant = {
  id: string;
  base: string;
  groups: readonly RichGroup[];
  /** Groups a sample must have; a sample missing one is excluded from this variant. */
  needs: readonly RichGroup[];
  order?: "reversed";
  edit?: (typeof NEW_FULL_VARIANTS)[number];
};

function mainVariants(input: PlanInput): MainVariant[] {
  const plain = (id: string): MainVariant => ({ id, base: "minimal", groups: [], needs: [] });
  const head = [plain("minimal"), plain("rerun-a"), plain("rerun-b")];
  const candidates: RichGroup[] = GROUPS.filter((g) => g !== "capabilities" || input.hasSnapshot);
  const full: MainVariant = { id: "full", base: "minimal", groups: candidates, needs: candidates };
  const addOne = candidates.map((g) => ({ id: `+${g}`, base: "minimal", groups: [g], needs: [g] }));
  const leaveOne = candidates.map((g) => ({
    id: `full-${g}`,
    base: "full",
    groups: candidates.filter((c) => c !== g),
    needs: candidates, // the same sample set as `full`, so each request has a `full` pair
  }));
  const tail: MainVariant[] = [{ ...plain("effort-reversed"), order: "reversed" }];
  const onFull: MainVariant[] = input.hasSnapshot
    ? NEW_FULL_VARIANTS.map((id) => ({ ...full, id, base: "full", edit: id }))
    : [];
  return [...head, full, ...addOne, ...leaveOne, ...tail, ...onFull];
}

/** Every variant id a pass can plan, main and worker, for validating `--only`. */
export function variantIds(input: PlanInput): string[] {
  const main = [...mainVariants(input).map((v) => v.id), ...NEW_FULL_VARIANTS];
  const workers = WORKER_VARIANTS.map((v) => v.id);
  return [...new Set([...main, ...workers])];
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

type Questions = { wire: Record<string, WireQuestion>; specs: Record<string, QuestionSpec> };

/** Rebuilds the effort question with its options in `order`, on the wire and in the specs. */
function withEffortOrder<Q extends Questions>(q: Q, order: readonly string[]): Q {
  const effort = q.wire["effort"];
  const spec = q.specs["effort"];
  if (effort === undefined || spec?.type !== "choice") return q;
  const criteria = Object.fromEntries(
    order.flatMap((level) => (level in effort.criteria ? [[level, effort.criteria[level]]] : [])),
  );
  return {
    ...q,
    wire: { ...q.wire, effort: { ...effort, criteria } },
    specs: { ...q.specs, effort: { ...spec, options: Object.keys(criteria) } },
  };
}

const reversedOrder = (q: Questions): readonly string[] => {
  const spec = q.specs["effort"];
  return spec?.type === "choice" ? [...spec.options].reverse() : [];
};

/** The questions with the effort instruction replaced and nothing else changed. */
function withRoleRule(q: Questions): Questions {
  const effort = q.wire["effort"];
  if (effort === undefined) return q;
  const instructions = roleRuleInstruction(MAIN_EFFORT_INSTRUCTION);
  return { ...q, wire: { ...q.wire, effort: { ...effort, instructions } } };
}

/** A copy of the built state without `request.prompt_chars`. */
function withoutPromptChars(state: ReturnType<typeof mainState>): unknown {
  const copy = structuredClone(state) as { request: Record<string, unknown> };
  delete copy.request["prompt_chars"];
  return copy;
}

function planMain(variants: MainVariant[], main: RebuiltMain[], plan: Plan): void {
  const base = deepFreeze(mainQuestions({ askEffort: true, askStrategy: true }));
  const reversed = deepFreeze(withEffortOrder(base, reversedOrder(base)));
  const roleRule = deepFreeze(withRoleRule(base));
  for (const v of variants) {
    const q = v.order !== undefined ? reversed : v.edit === "role-rule" ? roleRule : base;
    main.forEach((m, sample) => {
      if (v.needs.some((g) => m.missing.includes(g))) {
        const key = variantKey("main", v.id);
        plan.excluded[key] = (plan.excluded[key] ?? 0) + 1;
        return;
      }
      const rich = pickRich(m.rich, v.groups);
      const built = mainState({
        prompt: m.sample.prompt,
        items: m.items,
        platforms: m.platforms,
        rich,
      });
      plan.requests.push({
        variant: v.id,
        base: v.base,
        sample,
        kind: "main",
        state: v.edit === "no-prompt-chars" ? withoutPromptChars(built) : built,
        questions: q.wire,
        specs: q.specs,
      });
    });
  }
}

export function initialState(w: RebuiltWorker, parentRequest?: string): WorkerState {
  if (w.agent === undefined) throw new Error("worker sample has no agent");
  return buildWorkerState({
    brief: w.sample.brief,
    ...(w.sample.description === undefined ? {} : { description: w.sample.description }),
    agent: w.agent,
    runInBackground: w.sample.runInBackground,
    ...(parentRequest === undefined ? {} : { parentRequest }),
  });
}

type WorkerState = ReturnType<typeof buildWorkerState>;
type WorkerVariant = {
  id: string;
  /** True when the edit would leave the state equal to `base`; such a sample is excluded. */
  noop?: (w: RebuiltWorker & { agent: AgentFacts }) => boolean;
  edit: (s: WorkerState, w: RebuiltWorker) => void;
};

const WORKER_VARIANTS: WorkerVariant[] = [
  { id: "base", edit: () => {} },
  { id: "rerun-a", edit: () => {} },
  { id: "rerun-b", edit: () => {} },
  {
    id: "parent-request",
    noop: (w) => w.sample.parentPrompt === undefined,
    edit: (s, w) => {
      if (w.sample.parentPrompt !== undefined) {
        // Reuse the builder's own truncation instead of repeating its limit here.
        const cut = initialState(w, w.sample.parentPrompt).parent_request;
        if (cut !== undefined) s.parent_request = cut;
      }
    },
  },
  {
    id: "no-description",
    noop: (w) => (w.sample.description ?? "") === "",
    edit: (s) => {
      s.agent.description = "";
    },
  },
  {
    id: "no-instructions",
    noop: (w) => w.agent.instructionsExcerpt === "",
    edit: (s) => {
      s.agent.instructions_excerpt = "";
    },
  },
];

export function workerQuestions(config: PlainConfig) {
  const offered = offeredTiers(config.tiers, config.expertOn);
  const slots = config.slots.map((s) => ({ name: s.name, model: s.model, when: s.when }));
  return buildWorkerQuestions(offered, {}, slots);
}

function planWorkers(
  workers: RebuiltWorker[],
  config: PlainConfig,
  plan: Plan,
  only: readonly string[] | undefined,
): void {
  const plain = deepFreeze(workerQuestions(config));
  for (const v of WORKER_VARIANTS.filter((w) => selected(w.id, only))) {
    const { questions, specs } = plain;
    workers.forEach((w, sample) => {
      if (w.agent === undefined || v.noop?.({ ...w, agent: w.agent }) === true) {
        const key = variantKey("worker", v.id);
        plan.excluded[key] = (plan.excluded[key] ?? 0) + 1;
        return;
      }
      const state = initialState(w);
      v.edit(state, w);
      plan.requests.push({
        variant: v.id,
        base: "base",
        sample,
        kind: "worker",
        state,
        questions,
        specs,
      });
    });
  }
}

export function planPass(input: PlanInput): Plan {
  const plan: Plan = { requests: [], skipped: [], excluded: {} };
  if (!input.hasSnapshot) plan.skipped.push("capabilities", "workers", ...NEW_FULL_VARIANTS);
  const variants = mainVariants(input).filter((v) => selected(v.id, input.only));
  planMain(variants, input.main, plan);
  if (input.hasSnapshot) planWorkers(input.workers, input.config, plan, input.only);
  return plan;
}

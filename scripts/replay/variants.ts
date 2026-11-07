// Plans the requests of a replay run: one change per variant, each with a named base.
import type { QuestionSpec } from "../../src/policy/answers.ts";
import { buildWorkerState, mainState, pickRich, type RichGroup } from "../../src/jev/state.ts";
import {
  buildWorkerQuestions,
  mainQuestions,
  offeredTiers,
  type MainQuestions,
} from "../../src/jev/questions.ts";
import type { TierName } from "../../src/policy/launch.ts";
import type { ModeName } from "../../src/policy/modes.ts";
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

export type Plan = {
  requests: PlannedRequest[];
  skipped: string[];
  excluded: Record<string, number>;
};

export type PlanInput = {
  main: RebuiltMain[];
  workers: RebuiltWorker[];
  config: PlainConfig;
  hasSnapshot: boolean;
  kept?: readonly RichGroup[];
};

const PASS1_GROUPS: readonly RichGroup[] = [
  "last_decision",
  "context_used_percent",
  "languages",
  "capabilities",
];

type MainVariant = {
  id: string;
  base: string;
  groups: readonly RichGroup[];
  /** Groups a sample must have; a sample missing one is excluded from this variant. */
  needs: readonly RichGroup[];
  reversed?: true;
};

function mainVariants(pass: 1 | 2, input: PlanInput): MainVariant[] {
  const plain = (id: string): MainVariant => ({ id, base: "minimal", groups: [], needs: [] });
  const head = [plain("minimal"), plain("rerun-a"), plain("rerun-b")];
  const kept = input.kept ?? [];
  const candidates: RichGroup[] =
    pass === 1
      ? PASS1_GROUPS.filter((g) => g !== "capabilities" || input.hasSnapshot)
      : [...kept, "git"];
  const full: MainVariant = { id: "full", base: "minimal", groups: candidates, needs: candidates };
  const probed = pass === 1 ? candidates : ["git" as const];
  const addOne = probed.map((g) => ({ id: `+${g}`, base: "minimal", groups: [g], needs: [g] }));
  const leaveOne = probed.map((g) => ({
    id: `full-${g}`,
    base: "full",
    groups: candidates.filter((c) => c !== g),
    needs: [g],
  }));
  const tail: MainVariant[] = pass === 1 ? [{ ...plain("effort-reversed"), reversed: true }] : [];
  return [...head, full, ...addOne, ...leaveOne, ...tail];
}

function reverseRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).reverse());
}

function withReversedEffort(q: MainQuestions): MainQuestions {
  const effort = q.wire["effort"];
  const spec = q.specs["effort"];
  if (effort === undefined || spec?.type !== "choice") return q;
  return {
    wire: { ...q.wire, effort: { ...effort, criteria: reverseRecord(effort.criteria) } },
    specs: { ...q.specs, effort: { ...spec, options: [...spec.options].reverse() } },
  };
}

function planMain(variants: MainVariant[], main: RebuiltMain[], plan: Plan): void {
  const base = mainQuestions({ askEffort: true, askStrategy: true });
  for (const v of variants) {
    const q = v.reversed === true ? withReversedEffort(base) : base;
    main.forEach((m, sample) => {
      if (v.needs.some((g) => m.missing.includes(g))) {
        plan.excluded[v.id] = (plan.excluded[v.id] ?? 0) + 1;
        return;
      }
      const rich = pickRich(m.rich, v.groups);
      plan.requests.push({
        variant: v.id,
        base: v.base,
        sample,
        kind: "main",
        state: mainState({ prompt: m.sample.prompt, items: m.items, platforms: m.platforms, rich }),
        questions: q.wire,
        specs: q.specs,
      });
    });
  }
}

type WorkerVariant = { id: string; edit: (s: ReturnType<typeof buildWorkerState>) => void };

const WORKER_VARIANTS: WorkerVariant[] = [
  { id: "base", edit: () => {} },
  { id: "rerun-a", edit: () => {} },
  { id: "rerun-b", edit: () => {} },
  { id: "parent-request", edit: () => {} },
  {
    id: "no-description",
    edit: (s) => {
      s.agent.description = "";
    },
  },
  {
    id: "no-instructions",
    edit: (s) => {
      s.agent.instructions_excerpt = "";
    },
  },
];

function workerQuestions(config: PlainConfig) {
  const offered = offeredTiers(config.tiers, config.expertOn);
  const slots = config.slots.map((s) => ({ name: s.name, model: s.model, when: s.when }));
  return buildWorkerQuestions(offered, {}, config.mode, slots);
}

function planWorkers(workers: RebuiltWorker[], config: PlainConfig, plan: Plan): void {
  const { questions, specs } = workerQuestions(config);
  for (const v of WORKER_VARIANTS) {
    workers.forEach((w, sample) => {
      if (w.agent === undefined) {
        plan.excluded[v.id] = (plan.excluded[v.id] ?? 0) + 1;
        return;
      }
      const state = buildWorkerState({
        brief: w.sample.brief,
        ...(w.sample.description === undefined ? {} : { description: w.sample.description }),
        agent: w.agent,
        runInBackground: w.sample.runInBackground,
        ...(v.id === "parent-request" && w.sample.parentPrompt !== undefined
          ? { parentRequest: w.sample.parentPrompt }
          : {}),
      });
      v.edit(state);
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

export function planPass(pass: 1 | 2, input: PlanInput): Plan {
  const plan: Plan = { requests: [], skipped: [], excluded: {} };
  if (pass === 1 && !input.hasSnapshot) plan.skipped.push("capabilities", "workers");
  planMain(mainVariants(pass, input), input.main, plan);
  if (pass === 1 && input.hasSnapshot) planWorkers(input.workers, input.config, plan);
  return plan;
}

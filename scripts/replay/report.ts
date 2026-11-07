// Plans the report pass: the shipped main and worker requests, one `report` and one `rerun` each.
import { mainState, pickRich, SHIPPED_MAIN_GROUPS } from "../../src/jev/state.ts";
import { mainQuestions } from "../../src/jev/questions.ts";
import type { RebuiltMain, RebuiltWorker } from "./inputs.ts";
import {
  initialState,
  type Plan,
  type PlainConfig,
  type PlannedRequest,
  variantKey,
  workerQuestions,
} from "./variants.ts";

export type ReportPlanInput = {
  main: RebuiltMain[];
  workers: RebuiltWorker[];
  config: PlainConfig;
  hasSnapshot: boolean;
};

/** The two identical variants every report run plans: the answer and its plain rerun. */
const REPORT_VARIANTS = ["report", "rerun"] as const;
const REPORT_BASE = "report";

function exclude(plan: Plan, key: string): void {
  plan.excluded[key] = (plan.excluded[key] ?? 0) + 1;
}

function planReportMain(input: ReportPlanInput, plan: Plan): void {
  const questions = mainQuestions({ askEffort: true, askStrategy: true });
  for (const variant of REPORT_VARIANTS) {
    input.main.forEach((m, sample) => {
      if (SHIPPED_MAIN_GROUPS.some((g) => m.missing.includes(g))) {
        exclude(plan, variantKey("main", variant));
        return;
      }
      const request: PlannedRequest = {
        variant,
        base: REPORT_BASE,
        sample,
        kind: "main",
        state: mainState({
          prompt: m.sample.prompt,
          items: m.items,
          platforms: m.platforms,
          rich: pickRich(m.rich, SHIPPED_MAIN_GROUPS),
        }),
        questions: questions.wire,
        specs: questions.specs,
      };
      plan.requests.push(request);
    });
  }
}

function planReportWorkers(input: ReportPlanInput, plan: Plan): void {
  const { questions, specs } = workerQuestions(input.config);
  for (const variant of REPORT_VARIANTS) {
    input.workers.forEach((w, sample) => {
      if (w.agent === undefined) {
        exclude(plan, variantKey("worker", variant));
        return;
      }
      plan.requests.push({
        variant,
        base: REPORT_BASE,
        sample,
        kind: "worker",
        state: initialState(w),
        questions,
        specs,
      });
    });
  }
}

export function planReport(input: ReportPlanInput): Plan {
  const plan: Plan = { requests: [], skipped: [], excluded: {} };
  planReportMain(input, plan);
  if (input.hasSnapshot) planReportWorkers(input, plan);
  else plan.skipped.push("workers");
  return plan;
}

import { isSlot, slotName, type Target } from "../../policy/launch.ts";

/** A routing target whose model cannot run, and what the launch used instead. */
export type CannotRun = {
  target: Target;
  model: string;
  why: string;
  /** The target used instead, or undefined when the launch was left unchanged. */
  to: Target | undefined;
};

/** Where the operator receives a warning; Pi's `ctx.ui` satisfies it. */
export type WarningSink = { notify(text: string, type: "warning"): void };

/** Where to fix a target that cannot run: a slot's model or a tier's model. */
function fixHint(target: Target): string {
  return isSlot(target) ? `crew.slots "${slotName(target)}" model` : `tiers.${target}`;
}

function targetLabel(target: Target): string {
  return isSlot(target) ? `slot ${slotName(target)}` : `tier ${target}`;
}

/** The operator-facing text for a target that cannot run. */
export function warningText(problem: CannotRun, configPath: string): string {
  const { target, model, why, to } = problem;
  const tail = to === undefined ? "launch left unchanged" : `using ${to}`;
  return `Jev: ${targetLabel(target)} (${model}) cannot run (${why}); ${tail}. Fix ${fixHint(target)} in ${configPath}.`;
}

/** Shows each target and model's "cannot run" warning once, until cleared. */
export class LaunchWarnings {
  readonly #shown = new Set<string>();
  readonly #configPath: () => string;

  constructor(configPath: () => string) {
    this.#configPath = configPath;
  }

  show(sink: WarningSink, problem: CannotRun): void {
    const key = `${problem.target}\u0000${problem.model}`;
    if (this.#shown.has(key)) return;
    this.#shown.add(key);
    sink.notify(warningText(problem, this.#configPath()), "warning");
  }

  clear(): void {
    this.#shown.clear();
  }
}

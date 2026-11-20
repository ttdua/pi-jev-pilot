import type { SubagentsService } from "@ttdua/pi-subagents";

/**
 * The raw executor service as found in the slot. Any implementation may publish it, so
 * every member is optional and `implementation` is unchecked; readiness reads it by capability.
 */
export type ExecutorService = Partial<
  Pick<SubagentsService, "registerLaunchPolicy" | "listAgentTypes">
> & {
  readonly implementation?: unknown;
};

const EXECUTOR_KEY: unique symbol = Symbol.for("@gotgenes/pi-subagents:service") as never;
/** Process-wide slot for the captured main-session service. */
export const MAIN_SERVICE_KEY: unique symbol = Symbol.for("pi-jev-pilot.mainService") as never;

type Slots = Record<symbol, unknown>;

function isObject(value: unknown): value is ExecutorService {
  return typeof value === "object" && value !== null;
}

/** Copy the executor's service into the package slot; store nothing for a non-object. */
export function captureMainService(): void {
  const g = globalThis as Slots;
  const found = g[EXECUTOR_KEY];
  if (isObject(found)) g[MAIN_SERVICE_KEY] = found;
  else delete g[MAIN_SERVICE_KEY];
}

export function clearMainService(): void {
  delete (globalThis as Slots)[MAIN_SERVICE_KEY];
}

export function mainService(): ExecutorService | undefined {
  const value = (globalThis as Slots)[MAIN_SERVICE_KEY];
  return isObject(value) ? value : undefined;
}

/** The slot this package copied at the last capture. */
export function capturedService(): unknown {
  return (globalThis as Slots)[MAIN_SERVICE_KEY];
}

/** The executor's service, as far as the tool assessment needs it. */
export type ServiceLike = { listAgents(): unknown[] };

const EXECUTOR_KEY: unique symbol = Symbol.for("@gotgenes/pi-subagents:service") as never;
/** Process-wide slot for the captured main-session service. */
export const MAIN_SERVICE_KEY: unique symbol = Symbol.for("pi-jev-pilot.mainService") as never;

type Slots = Record<symbol, unknown>;

function isServiceLike(value: unknown): value is ServiceLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { listAgents?: unknown }).listAgents === "function"
  );
}

/** Copy the executor service into the package slot; store nothing when it is absent or unusable. */
export function captureMainService(): void {
  const g = globalThis as Slots;
  const found = g[EXECUTOR_KEY];
  if (isServiceLike(found)) g[MAIN_SERVICE_KEY] = found;
  else delete g[MAIN_SERVICE_KEY];
}

export function clearMainService(): void {
  delete (globalThis as Slots)[MAIN_SERVICE_KEY];
}

export function mainService(): ServiceLike | undefined {
  const value = (globalThis as Slots)[MAIN_SERVICE_KEY];
  return isServiceLike(value) ? value : undefined;
}

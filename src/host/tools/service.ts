import type { SubagentsService } from "@ttdua/pi-subagents";

/** The vendored executor's service; a service published by any other implementation is not one. */
export type VendoredService = SubagentsService & {
  readonly implementation: "@ttdua/pi-subagents";
};

/** The executor's service, as far as the tool assessment needs it; records are read defensively. */
export type ServiceLike = { listAgents(): unknown[] };

const VENDORED_IMPLEMENTATION = "@ttdua/pi-subagents";
const EXECUTOR_KEY: unique symbol = Symbol.for("@gotgenes/pi-subagents:service") as never;
/** Process-wide slot for the captured main-session service. */
export const MAIN_SERVICE_KEY: unique symbol = Symbol.for("pi-jev-pilot.mainService") as never;

const SEEN_KEY: unique symbol = Symbol.for("pi-jev-pilot.seenService") as never;

type Slots = Record<symbol, unknown>;

function isVendoredService(value: unknown): value is VendoredService {
  if (typeof value !== "object" || value === null) return false;
  const service = value as { implementation?: unknown; listAgents?: unknown };
  return (
    service.implementation === VENDORED_IMPLEMENTATION && typeof service.listAgents === "function"
  );
}

/** Copy the vendored executor's service into the package slot; store nothing for any other value. */
export function captureMainService(): void {
  const g = globalThis as Slots;
  const found = g[EXECUTOR_KEY];
  g[SEEN_KEY] = found;
  if (isVendoredService(found)) g[MAIN_SERVICE_KEY] = found;
  else delete g[MAIN_SERVICE_KEY];
}

export function clearMainService(): void {
  delete (globalThis as Slots)[MAIN_SERVICE_KEY];
  delete (globalThis as Slots)[SEEN_KEY];
}

export function mainService(): VendoredService | undefined {
  const value = (globalThis as Slots)[MAIN_SERVICE_KEY];
  return isVendoredService(value) ? value : undefined;
}

/** The service slot as it stood at the last capture, whichever implementation put it there. */
export function publishedService(): unknown {
  return (globalThis as Slots)[SEEN_KEY];
}

/** The slot this package copied at the last capture. */
export function capturedService(): unknown {
  return (globalThis as Slots)[MAIN_SERVICE_KEY];
}

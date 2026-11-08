/** Process-wide slot for the main session's working directory. */
export const MAIN_CWD_KEY: unique symbol = Symbol.for("pi-jev-pilot.mainCwd") as never;

type Slots = Record<symbol, unknown>;

/** The directory the main session started in; unset before the first main `session_start`. */
export function mainCwd(): string | undefined {
  const value = (globalThis as Slots)[MAIN_CWD_KEY];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function setMainCwd(cwd: string): void {
  (globalThis as Slots)[MAIN_CWD_KEY] = cwd;
}

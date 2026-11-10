// Applying a `/jev` change: the directory-mode forms, or the state file edit plus the reset cleanup.
import { DECISION_FEATURES } from "../../store/defaults.ts";
import { resetState, updateState } from "../../store/state-file.ts";
import type { JevArgs } from "./args.ts";
import type { CliReviewChoice } from "./cli-review.ts";
import {
  clearDirectoryMode,
  NO_DIRECTORY_MODE,
  resetDirectoryMode,
  setDirectoryMode,
  type LocalOutcome,
} from "./local-mode.ts";

type Change = Exclude<JevArgs, { kind: "status" | "usage" | "slot" | "tune" | "mode-clear" }>;

export type ApplyOutcome =
  /** `partialReset` is set when the state reset worked but the directory mode file stayed. */
  { ok: true; partialReset?: string } | { ok: false; message: string; level: "info" | "error" };

function applyChange(
  parsed: Change,
  dir: string,
  cliReview: CliReviewChoice | undefined,
): ReturnType<typeof updateState> {
  switch (parsed.kind) {
    case "reset":
      return resetState(dir);
    case "mode":
      return updateState(dir, (st) => ({ ...st, mode: parsed.mode }));
    case "cli-review-switch":
      return updateState(dir, (st) => ({ ...st, cliReviewEnabled: parsed.on }));
    case "cli-review":
      return updateState(dir, (st) => ({
        ...st,
        cliReviewEnabled: true,
        cliReview: {
          cli: parsed.cli,
          ...(cliReview?.model ? { model: cliReview.model } : {}),
          ...(cliReview?.effort ? { effort: cliReview.effort } : {}),
        },
      }));
    case "set":
    case "all":
      return updateState(dir, (st) => {
        const features = parsed.kind === "all" ? DECISION_FEATURES : [parsed.feature];
        const switches = { ...st.switches };
        for (const f of features) switches[f] = parsed.on;
        return { ...st, switches };
      });
  }
}

/** The directory-mode forms; `undefined` for every other command. */
function runLocalForm(parsed: JevArgs, cwd: string): LocalOutcome | undefined {
  if (parsed.kind === "mode-clear") return clearDirectoryMode(cwd);
  if (parsed.kind === "mode" && parsed.target === "local")
    return setDirectoryMode(cwd, parsed.mode);
  return undefined;
}

/** The state reset succeeded but the directory mode file could not be removed. */
function partialResetLine(cleanupError: string): string {
  return `global settings reset; directory mode not removed: ${cleanupError}`;
}

function refusedLocal(local: LocalOutcome): ApplyOutcome | undefined {
  if (local.kind === "nothing") return { ok: false, message: NO_DIRECTORY_MODE, level: "info" };
  if (local.kind === "failed") return { ok: false, message: local.message, level: "error" };
  return undefined;
}

function applyToState(
  parsed: Change,
  where: { cwd: string; dir: string },
  cliReview: CliReviewChoice | undefined,
): ApplyOutcome {
  const result = applyChange(parsed, where.dir, cliReview);
  if (!result.ok) {
    const message = result.issues
      .map((i) => (i.path ? `${i.path}: ${i.message}` : i.message))
      .join("\n");
    return { ok: false, message, level: "error" };
  }
  const reset = parsed.kind === "reset" ? resetDirectoryMode(where.cwd) : undefined;
  return reset?.kind === "failed"
    ? { ok: true, partialReset: partialResetLine(reset.message) }
    : { ok: true };
}

/** Does what `parsed` asks for; the status form changes nothing. */
export function applyCommand(
  parsed: JevArgs,
  where: { cwd: string; dir: string },
  cliReview: CliReviewChoice | undefined,
): ApplyOutcome {
  const local = runLocalForm(parsed, where.cwd);
  if (local !== undefined) return refusedLocal(local) ?? { ok: true };
  if (parsed.kind === "status" || parsed.kind === "mode-clear") return { ok: true };
  return applyToState(parsed as Change, where, cliReview);
}

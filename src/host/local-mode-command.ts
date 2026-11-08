import type { Mode } from "../store/defaults.ts";
import { clearLocalMode, readLocalMode, writeLocalMode } from "../store/local-mode.ts";
import type { Issue, WriteResult } from "../store/validate.ts";

export const NO_DIRECTORY_MODE = "no directory mode set";

/** What a directory-mode command did; `nothing` means there was no file to clear. */
export type LocalOutcome =
  | { kind: "changed" }
  | { kind: "nothing" }
  | { kind: "failed"; message: string };

function issueMessage(issues: Issue[]): string {
  return issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("\n");
}

function outcomeOf(result: WriteResult): LocalOutcome {
  return result.ok ? { kind: "changed" } : { kind: "failed", message: issueMessage(result.issues) };
}

/** `/jev mode <m>`: writes the directory mode file. Never touches `state.json`. */
export function setDirectoryMode(cwd: string, mode: Mode): LocalOutcome {
  return outcomeOf(writeLocalMode(cwd, mode));
}

/** `/jev mode clear`: removes the file, whatever state it is in. */
export function clearDirectoryMode(cwd: string): LocalOutcome {
  if (readLocalMode(cwd).kind === "missing") return { kind: "nothing" };
  return outcomeOf(clearLocalMode(cwd));
}

/** After a successful `/jev reset`: removes the directory mode file when one exists. */
export function resetDirectoryMode(cwd: string): LocalOutcome {
  return clearDirectoryMode(cwd);
}

/** The report line when a global change is shadowed by a directory mode. */
export function shadowedLine(directoryMode: Mode, globalMode: Mode): string {
  return `directory mode ${directoryMode} still applies here; global mode is now ${globalMode}`;
}

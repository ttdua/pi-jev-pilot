// The status reply of a `/jev` command: the status text plus the lines a change adds.
import type { WindowEntry } from "../../policy/worker/index.ts";
import { EMPTY_TALLY, type Tally } from "../status/index.ts";
import type { Snapshot } from "../platform/index.ts";
import type { JevArgs } from "./args.ts";
import { shadowedLine } from "./local-mode.ts";
import { formatStatus } from "./status-format.ts";

const DEPRECATED_EXPERT = "notice: /jev expert is deprecated; use /jev frontier";

export type StatusReply = { text: string; level: "info" | "warning" };

/** `tally`, `window` and `problems` are called as methods of this object, only when the reply is built. */
type Readers = {
  tally?: () => Tally;
  window?: () => readonly WindowEntry[];
  problems?: () => readonly string[];
};

// DEPRECATED(remove next minor)
/** The notice a deprecated command name adds to its reply. */
function deprecatedLines(parsed: JevArgs): string[] {
  return parsed.kind === "set" && parsed.deprecatedName !== undefined ? [DEPRECATED_EXPERT] : [];
}

/** A partial reset leads the text and turns the level into a warning. */
export function statusReply(
  parsed: JevArgs,
  snapshot: Snapshot,
  readers: Readers,
  partialReset: string | undefined,
): StatusReply {
  const lines = [
    formatStatus(
      snapshot,
      readers.tally?.() ?? EMPTY_TALLY,
      readers.window?.(),
      readers.problems?.() ?? [],
    ),
  ];
  if (partialReset !== undefined) lines.unshift(partialReset);
  lines.push(...deprecatedLines(parsed));
  const { mode, modeSource } = snapshot.settings;
  if (parsed.kind === "mode" && parsed.target === "global" && modeSource === "local") {
    lines.push(shadowedLine(mode, parsed.mode));
  }
  return { text: lines.join("\n"), level: partialReset === undefined ? "info" : "warning" };
}

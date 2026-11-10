// The status reply of a `/jev` command: the status text plus the lines a change adds.
import type { WindowEntry } from "../../policy/worker/index.ts";
import { EMPTY_TALLY, type Tally } from "../status/index.ts";
import type { Snapshot } from "../platform/index.ts";
import type { JevArgs } from "./args.ts";
import { shadowedLine } from "./local-mode.ts";
import { formatStatus } from "./status-format.ts";

export type StatusReply = { text: string; level: "info" | "warning" };

/** `tally` and `window` are called as methods of this object, only when the reply is built. */
type Readers = { tally?: () => Tally; window?: () => readonly WindowEntry[] };

/** A partial reset leads the text and turns the level into a warning. */
export function statusReply(
  parsed: JevArgs,
  snapshot: Snapshot,
  readers: Readers,
  partialReset: string | undefined,
): StatusReply {
  const lines = [formatStatus(snapshot, readers.tally?.() ?? EMPTY_TALLY, readers.window?.())];
  if (partialReset !== undefined) lines.unshift(partialReset);
  const { mode, modeSource } = snapshot.settings;
  if (parsed.kind === "mode" && parsed.target === "global" && modeSource === "local") {
    lines.push(shadowedLine(mode, parsed.mode));
  }
  return { text: lines.join("\n"), level: partialReset === undefined ? "info" : "warning" };
}

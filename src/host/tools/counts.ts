import { toolCounts, type ToolCounts } from "../../policy/tools/index.ts";

/** What one launch's answered tool assessment decided, under the mode read at its policy call. */
export type ToolDecision = {
  mode: "observe" | "enforce";
  scored: readonly string[];
  flagged: ReadonlySet<string>;
  granted: ReadonlySet<string>;
};

/**
 * The counts for a launch's worker line. In `enforce`, granted counts only the grants the
 * executor reported as taken effect in the child; in `observe`, the grants Jev would have made.
 */
export function launchToolCounts(
  decision: ToolDecision,
  grantedInChild: readonly string[] | undefined,
): ToolCounts {
  const granted =
    decision.mode === "enforce"
      ? new Set((grantedInChild ?? []).filter((name) => decision.granted.has(name)))
      : decision.granted;
  return toolCounts(decision.scored, decision.flagged, granted);
}

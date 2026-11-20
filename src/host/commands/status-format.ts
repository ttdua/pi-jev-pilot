// The `/jev` status report text.
import { FEATURES, type Mode } from "../../store/defaults.ts";
import { recentMix, WINDOW_MIN, MODE_TARGETS } from "../../policy/worker/index.ts";
import type { WindowEntry } from "../../policy/worker/index.ts";
import { canRoute, type Snapshot } from "../platform/index.ts";
import { issueLines } from "../../policy/tuning/index.ts";
import { statusText, tallyLines, type Tally } from "../status/index.ts";

function mixLines(mode: Mode, window: readonly WindowEntry[]): string[] {
  const { n, shares } = recentMix(window);
  if (shares === undefined) return ["mix: no routed workers yet", "cut points: seed"];
  const tg = MODE_TARGETS[mode];
  const lines = [
    `mix (last ${n}, ${mode}): basic ${shares.basic}% / broad ${shares.broad}% / ` +
      `deep ${shares.deep}% / frontier ${shares.frontier}% · ` +
      `target ${tg.basic}/${tg.broad}/${tg.deep}/≤${tg.frontierCap}`,
  ];
  if (n < WINDOW_MIN) lines.push("cut points: seed");
  return lines;
}

function modeLine(s: Snapshot): string {
  const { mode, modeSource, globalMode } = s.settings;
  return modeSource === "local"
    ? `mode: ${mode} (this directory; global ${globalMode})`
    : `mode: ${mode}`;
}

function executorLine(e: Snapshot["executor"]): string {
  if (e.kind === "absent") return "executor: no executor; worker routing is off";
  const name = e.implementation ?? "unknown";
  const head = e.launchPolicy
    ? `executor: ${name}`
    : `executor: ${name}; no launch policy, worker routing is off`;
  return e.agentRegistry ? head : `${head}; no agent registry`;
}

/** The problem lines of the report: invalid or deprecated config, store issues, then `extra`. */
function problemLines(s: Snapshot, extra: readonly string[]): string[] {
  const problems: string[] = [];
  if (!s.config.valid) problems.push(...issueLines("config", s.config.issues));
  if (s.config.valid && s.config.deprecated.includes("tools"))
    problems.push("  deprecated: config tools is ignored");
  problems.push(...issueLines(`state (${s.state.kind})`, s.state.issues));
  problems.push(...issueLines(`tuning (${s.tuning.kind})`, s.tuning.issues));
  problems.push(...issueLines(`local mode (${s.localMode.kind})`, s.localMode.issues));
  problems.push(...extra.map((p) => `  ${p}`));
  return problems;
}

/** `extra` holds problems the snapshot cannot see, such as a launch policy slot held elsewhere. */
export function formatStatus(
  s: Snapshot,
  t?: Tally,
  window?: readonly WindowEntry[],
  extra: readonly string[] = [],
): string {
  const lines = [statusText(s), modeLine(s), "features:"];
  for (const f of FEATURES) lines.push(`  ${f}: ${s.settings.switches[f] ? "on" : "off"}`);
  lines.push(`key: ${s.keyVar} ${s.keySet ? "set" : "not set"}`);
  lines.push(executorLine(s.executor));
  const problems = problemLines(s, extra);
  if (problems.length > 0) lines.push("problems:", ...problems);
  if (s.config.valid) lines.push(...s.config.notices.map((n) => `notice: ${n}`));

  if (canRoute(s.executor) && window) lines.push(...mixLines(s.settings.mode, window));
  if (t) lines.push(...tallyLines(t));
  return lines.join("\n");
}

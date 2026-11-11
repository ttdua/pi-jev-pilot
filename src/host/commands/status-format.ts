// The `/jev` status report text.
import { FEATURES, type Mode } from "../../store/defaults.ts";
import { recentMix, WINDOW_MIN, MODE_TARGETS } from "../../policy/worker/index.ts";
import type { WindowEntry } from "../../policy/worker/index.ts";
import type { Snapshot } from "../platform/index.ts";
import { issueLines } from "../../policy/tuning/index.ts";
import { statusText, tallyLines, type Tally } from "../status/index.ts";

function reviewLine(r: Snapshot["settings"]["review"]): string {
  const parts = [
    ...(r.model ? [`model ${r.model}`] : []),
    ...(r.effort ? [`effort ${r.effort}`] : []),
  ];
  const detail = parts.length > 0 ? parts : ["CLI defaults"];
  return `cli review: ${r.enabled ? "on" : "off"} (${[r.cli, ...detail].join(", ")})`;
}

function mixLines(mode: Mode, window: readonly WindowEntry[]): string[] {
  const { n, shares } = recentMix(window);
  if (shares === undefined) return ["mix: no routed workers yet", "cut points: seed"];
  const tg = MODE_TARGETS[mode];
  const lines = [
    `mix (last ${n}, ${mode}): fast ${shares.fast}% / balanced ${shares.balanced}% / ` +
      `deep ${shares.deep}% / expert ${shares.expert}% · ` +
      `target ${tg.fast}/${tg.balanced}/${tg.deep}/≤${tg.expertCap}`,
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
  if (e.kind === "present") return "executor: present";
  if (e.kind === "absent") {
    return "executor: no executor; worker routing and tool assessment are off";
  }
  const other = e.path === undefined ? "" : ` (${e.path})`;
  return `executor: duplicate executor${other}; uninstall @gotgenes/pi-subagents; worker routing and tool assessment are off`;
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
  lines.push(reviewLine(s.settings.review));
  lines.push(`key: ${s.keyVar} ${s.keySet ? "set" : "not set"}`);
  lines.push(executorLine(s.executor));
  const problems: string[] = [];
  if (!s.config.valid) problems.push(...issueLines("config", s.config.issues));
  problems.push(...issueLines(`state (${s.state.kind})`, s.state.issues));
  problems.push(...issueLines(`tuning (${s.tuning.kind})`, s.tuning.issues));
  problems.push(...issueLines(`local mode (${s.localMode.kind})`, s.localMode.issues));
  problems.push(...extra.map((p) => `  ${p}`));
  if (problems.length > 0) lines.push("problems:", ...problems);
  if (s.executor.kind === "present" && window) lines.push(...mixLines(s.settings.mode, window));
  if (t) lines.push(...tallyLines(t));
  return lines.join("\n");
}

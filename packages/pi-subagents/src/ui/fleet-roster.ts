/**
 * fleet-roster.ts — Pure roster and renderer for the below-editor fleet list.
 *
 * Which subagents get a row, and the lines drawn for them. No Pi, timer or key
 * handling here; `fleet-list.ts` adapts this core to the TUI.
 *
 * The list behavior (row windowing, right-aligned stats, finished-agent linger,
 * elapsed/token formats) is ported from tintinweb/pi-subagents 0.23.2 (MIT).
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AgentConfigLookup } from "#src/config/agent-types";
import { isActiveStatus } from "#src/lifecycle/subagent-state";
import { getLifetimeTotal, type LifetimeUsage } from "#src/lifecycle/usage";
import { getDisplayName, type Theme } from "#src/ui/display";
import type { NavigableSubagent } from "#src/ui/session-navigation";

/** Max agent rows shown at once; extras collapse into a "↑/↓ N more" line. */
export const MAX_AGENT_ROWS = 5;
/** How long a finished agent lingers in the list before it drops out. */
export const FINISHED_LINGER_MS = 4000;

const HINT_INACTIVE = "esc to interrupt · ← for agents · ↓ to manage";
const HINT_ACTIVE = "↑↓ select · enter view · esc back";

/** A subagent the list can show: navigable, plus the usage its row reports. */
export type FleetAgent = NavigableSubagent & { readonly lifetimeUsage: Readonly<LifetimeUsage> };

/** Whether the agent has a transcript the pane can open, live or from file. */
function isOpenable(agent: FleetAgent): boolean {
  return agent.isSessionReady() || Boolean(agent.outputFile);
}

/** Whether the agent is live, recently finished, or the one being viewed. */
function isListed(agent: FleetAgent, now: number, viewingId: string | undefined): boolean {
  if (isActiveStatus(agent.status) || agent.id === viewingId) return true;
  return agent.completedAt !== undefined && now - agent.completedAt < FINISHED_LINGER_MS;
}

/** Agents to list, earliest-launched first. */
export function fleetRows(agents: readonly FleetAgent[], now: number, viewingId: string | undefined): FleetAgent[] {
  return agents
    .filter((agent) => isOpenable(agent) && isListed(agent, now, viewingId))
    .sort((a, b) => a.startedAt - b.startedAt);
}

/** `11s` — integer seconds. */
export function formatFleetElapsed(ms: number): string {
  return `${Math.max(0, Math.round(ms / 1000))}s`;
}

/** `↓ 13.1k tokens` — down-arrow prefix, compact magnitude. */
export function formatFleetTokens(count: number): string {
  let compact: string;
  if (count >= 1_000_000) compact = `${(count / 1_000_000).toFixed(1)}M`;
  else if (count >= 1_000) compact = `${(count / 1_000).toFixed(1)}k`;
  else compact = `${count}`;
  return `↓ ${compact} tokens`;
}

/** Place `right` flush to `width`, truncating `left` first; never exceeds `width`. */
export function rightAlign(left: string, right: string, width: number): string {
  const rightWidth = visibleWidth(right);
  if (rightWidth >= width) return truncateToWidth(right, width);
  const leftClamped = truncateToWidth(left, Math.max(0, width - rightWidth - 1));
  const gap = width - visibleWidth(leftClamped) - rightWidth;
  return leftClamped + " ".repeat(gap) + right;
}

function marker(selected: boolean, theme: Theme): string {
  return selected ? theme.fg("accent", "●") : theme.fg("dim", "○");
}

interface RowContext {
  readonly selected: boolean;
  readonly width: number;
  readonly now: number;
  readonly theme: Theme;
  readonly registry: AgentConfigLookup;
}

function renderAgentRow(agent: FleetAgent, ctx: RowContext): string {
  const { selected, theme } = ctx;
  const name = getDisplayName(agent.type, ctx.registry);
  const nameText = theme.fg(selected ? "text" : "muted", name);
  const description = selected ? theme.fg("text", agent.description) : agent.description;
  const left = `  ${marker(selected, theme)} ${nameText}  ${description}`;
  const elapsed = (agent.completedAt ?? ctx.now) - agent.startedAt;
  const stats = `${formatFleetElapsed(elapsed)} · ${formatFleetTokens(getLifetimeTotal(agent.lifetimeUsage))}`;
  return rightAlign(left, theme.fg(selected ? "text" : "dim", stats), ctx.width);
}

/** First row index of the window, keeping the selected row visible. */
function windowStart(selected: number, visible: number): number {
  const selectedRow = Math.max(0, selected - 1);
  return selectedRow < visible ? 0 : selectedRow - visible + 1;
}

/** Lines for the list: hint, blank, `main`, windowed agent rows, blank. `selected` 0 = main. */
export function renderFleetLines(p: {
  rows: readonly FleetAgent[];
  selected: number;
  active: boolean;
  width: number;
  now: number;
  theme: Theme;
  registry: AgentConfigLookup;
}): string[] {
  const { rows, width, theme } = p;
  if (rows.length === 0) return [];
  // An inactive list has no selection: every marker is hollow.
  const selected = p.active ? Math.min(p.selected, rows.length) : -1;

  const hint = p.active ? HINT_ACTIVE : HINT_INACTIVE;
  const lines = [
    truncateToWidth(`  ${theme.fg("dim", hint)}`, width),
    "",
    truncateToWidth(`  ${marker(selected === 0, theme)} main`, width),
  ];

  const visible = Math.min(MAX_AGENT_ROWS, rows.length);
  const start = windowStart(Math.max(selected, 0), visible);
  const hiddenBelow = rows.length - (start + visible);
  if (start > 0) lines.push(rightAlign("", theme.fg("dim", `↑ ${start} more`), width));
  for (let i = start; i < start + visible; i++) {
    const ctx: RowContext = { selected: i + 1 === selected, width, now: p.now, theme, registry: p.registry };
    lines.push(renderAgentRow(rows[i], ctx));
  }
  if (hiddenBelow > 0) lines.push(rightAlign("", theme.fg("dim", `↓ ${hiddenBelow} more`), width));
  lines.push("");
  return lines;
}

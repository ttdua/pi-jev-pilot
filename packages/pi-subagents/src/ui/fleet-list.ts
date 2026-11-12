/**
 * fleet-list.ts — Pi adapter for the below-editor fleet list.
 *
 * Owns the list's state (active, selection, the viewed agent), the 1 s refresh
 * timer, the `fleet` widget registration, the terminal-input listener and the
 * open call. Which rows exist and what they look like live in `fleet-roster.ts`.
 *
 * The key mechanics are ported from tintinweb/pi-subagents 0.23.2 (MIT); the
 * viewer and workflow parts are not.
 */

import { isKeyRelease, Key, matchesKey } from "@earendil-works/pi-tui";
import type { AgentConfigLookup } from "#src/config/agent-types";
import type { SubagentManager, SubagentManagerObserver } from "#src/lifecycle/subagent-manager";
import { isActiveStatus } from "#src/lifecycle/subagent-state";
import type { Theme } from "#src/ui/display";
import { fleetRows, renderFleetLines } from "#src/ui/fleet-roster";
import { navigationEntryFor, type NavigationEntry } from "#src/ui/session-navigation";
import { type SessionNavigatorUI, openTranscript } from "#src/ui/session-navigator";

/** Widget key for the below-editor fleet list. */
export const FLEET_WIDGET_KEY = "fleet";
/** Refresh cadence while the list is shown or an agent is running or queued. */
export const TICK_MS = 1000;

const CONSUMED = { consume: true } as const;
/** Selection sentinel for the `main` entry; agent ids select their row. */
const MAIN = null;

/** Builds the widget body; Pi calls it once the widget is mounted. */
export type FleetWidgetFactory = (
  tui: FleetTui,
  theme: Theme,
) => { render(width: number): string[]; invalidate(): void };

/** Structural subset of pi-tui `TUI` the list reads and redraws. */
export interface FleetTui {
  getFocusedComponent(): unknown;
  requestRender(): void;
}

/** The `ctx.ui` surface the list needs: the navigator's surface plus widget, input and editor. */
export interface FleetUI extends SessionNavigatorUI {
  setWidget(key: string, content: FleetWidgetFactory | undefined, options?: { placement?: "aboveEditor" | "belowEditor" }): void;
  onTerminalInput(handler: (data: string) => { consume?: boolean; data?: string } | undefined): () => void;
  getEditorText(): string;
}

export interface FleetListDeps {
  manager: Pick<SubagentManager, "listAgents">;
  registry: AgentConfigLookup;
  enabled: () => boolean;
  cwd: () => string;
  readFile: (path: string) => string;
  open?: typeof openTranscript;
}

/**
 * Whether the focused component is the prompt editor, recognized structurally.
 * An editor with its autocomplete menu open owns the keys, so it does not count.
 */
function isEditor(component: unknown): boolean {
  if (typeof component !== "object" || component === null) return false;
  const candidate = component as { getText?: unknown; setText?: unknown; isShowingAutocomplete?: () => boolean };
  if (typeof candidate.getText !== "function" || typeof candidate.setText !== "function") return false;
  return !candidate.isShowingAutocomplete?.();
}

export class FleetList implements SubagentManagerObserver {
  private ui: FleetUI | undefined;
  private tui: FleetTui | undefined;
  private inputUnsub: (() => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private widgetRegistered = false;
  /** Whether arrow keys currently navigate the list (vs. flow to the editor). */
  private active = false;
  /** The selected agent's id, or `MAIN`; the row index is derived so a shifting roster cannot move the cursor. */
  private selectedId: string | typeof MAIN = MAIN;
  /** Index the selection last resolved to; the clamp target when the selected agent is gone. */
  private lastIndex = 0;
  /** Id of the agent whose pane the list opened; set while that pane is up. */
  private viewingId: string | undefined;

  constructor(private readonly deps: FleetListDeps) {}

  /** Captures the UI and installs the input listener, replacing any previous one. */
  setUICtx(ui: FleetUI): void {
    this.inputUnsub?.();
    this.ui = ui;
    this.forgetWidget();
    this.resetSelection();
    this.viewingId = undefined;
    this.inputUnsub = ui.onTerminalInput((data) => this.handleKey(data));
  }

  /** Re-derives rows, shows or clears the widget and runs or stops the timer. */
  update(): void {
    if (!this.ui) return;
    const agents = this.deps.manager.listAgents();
    const rowCount = this.rowsOf(agents).length;
    const shown = this.deps.enabled() && rowCount > 0;
    this.syncTimer(shown || agents.some((agent) => isActiveStatus(agent.status)));
    if (shown) this.show();
    else this.hide();
  }

  /** Handles one terminal input; returns `{ consume: true }` when the list takes the key. */
  handleKey(data: string): { consume: true } | undefined {
    if (!this.ui || !this.deps.enabled()) return undefined;
    if (isKeyRelease(data) || this.viewingId !== undefined) return undefined;
    if (!this.tui) return undefined;
    if (!isEditor(this.tui.getFocusedComponent())) {
      this.deactivate();
      return undefined;
    }
    return this.active ? this.handleActiveKey(data) : this.handleInactiveKey(data);
  }

  onSubagentCreated(): void {
    this.update();
  }

  onSubagentRunStarted(): void {
    this.update();
  }

  onSubagentRunFinished(): void {
    this.update();
  }

  onSubagentCompacted(): void {
    // Intentionally empty: compaction does not change the list.
  }

  /** Clears the widget, the timer and the input listener, and drops the UI. */
  dispose(): void {
    if (this.ui && this.widgetRegistered) this.ui.setWidget(FLEET_WIDGET_KEY, undefined);
    this.stopTimer();
    this.inputUnsub?.();
    this.inputUnsub = undefined;
    this.forgetWidget();
    this.ui = undefined;
  }

  // ---- Roster ----

  private rows() {
    return this.rowsOf(this.deps.manager.listAgents());
  }

  private rowsOf(agents: ReturnType<SubagentManager["listAgents"]>) {
    return fleetRows(agents, Date.now(), this.viewingId);
  }

  // ---- Widget ----

  private show(): void {
    if (!this.ui) return;
    this.resolveIndex(this.rows());
    if (!this.widgetRegistered) {
      this.ui.setWidget(FLEET_WIDGET_KEY, (tui, theme) => this.createWidget(tui, theme), { placement: "belowEditor" });
      this.widgetRegistered = true;
      return;
    }
    this.redraw();
  }

  private hide(): void {
    if (this.ui && this.widgetRegistered) this.ui.setWidget(FLEET_WIDGET_KEY, undefined);
    this.forgetWidget();
    this.resetSelection();
  }

  /** Leaves the list and points the selection back at `main`. */
  private resetSelection(): void {
    this.active = false;
    this.selectedId = MAIN;
    this.lastIndex = 0;
  }

  /**
   * The selected row index (0 = `main`, 1..N = agent rows) for these rows. When
   * the selected agent is gone, clamps the last index and rebinds to what is there.
   */
  private resolveIndex(rows: ReturnType<typeof fleetRows>): number {
    if (this.selectedId === MAIN) return this.bind(rows, 0);
    const found = rows.findIndex((row) => row.id === this.selectedId);
    return this.bind(rows, found >= 0 ? found + 1 : Math.min(this.lastIndex, rows.length));
  }

  private bind(rows: ReturnType<typeof fleetRows>, index: number): number {
    this.selectedId = index === 0 ? MAIN : rows[index - 1].id;
    this.lastIndex = index;
    return index;
  }

  /** Drops the registration so the next `show` registers the widget again. */
  private forgetWidget(): void {
    this.widgetRegistered = false;
    this.tui = undefined;
  }

  private createWidget(tui: FleetTui, theme: Theme): ReturnType<FleetWidgetFactory> {
    this.tui = tui;
    return {
      render: (width) => this.renderLines(width, theme),
      // Pi's invalidate only clears render caches; this renderer keeps none, and the widget stays mounted.
      invalidate: () => {},
    };
  }

  private renderLines(width: number, theme: Theme): string[] {
    const rows = this.rows();
    return renderFleetLines({
      rows,
      selected: this.active ? this.resolveIndex(rows) : 0,
      active: this.active,
      width,
      now: Date.now(),
      theme,
      registry: this.deps.registry,
    });
  }

  private redraw(): void {
    this.tui?.requestRender();
  }

  // ---- Timer ----

  private syncTimer(needed: boolean): void {
    if (needed && !this.timer) {
      this.timer = setInterval(() => this.update(), TICK_MS);
      this.timer.unref?.();
    }
    if (!needed) this.stopTimer();
  }

  private stopTimer(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  // ---- Keys ----

  private handleInactiveKey(data: string): { consume: true } | undefined {
    if (this.ui?.getEditorText() !== "") return undefined;
    if (this.rows().length === 0) return undefined;
    if (!matchesKey(data, Key.down) && !matchesKey(data, Key.left)) return undefined;
    this.active = true;
    this.bind(this.rows(), 1);
    this.redraw();
    return CONSUMED;
  }

  private handleActiveKey(data: string): { consume: true } | undefined {
    if (matchesKey(data, Key.down)) return this.moveDown();
    if (matchesKey(data, Key.up)) return this.moveUp();
    if (matchesKey(data, Key.escape)) return this.leave();
    if (matchesKey(data, Key.enter)) return this.enter();
    this.deactivate();
    return undefined;
  }

  private moveDown(): { consume: true } {
    const rows = this.rows();
    this.bind(rows, Math.min(this.resolveIndex(rows) + 1, rows.length));
    this.redraw();
    return CONSUMED;
  }

  private moveUp(): { consume: true } {
    const rows = this.rows();
    const index = this.resolveIndex(rows);
    if (index === 0) return this.leave();
    this.bind(rows, index - 1);
    this.redraw();
    return CONSUMED;
  }

  private enter(): { consume: true } {
    if (this.resolveIndex(this.rows()) === 0) return this.leave();
    this.openSelected();
    return CONSUMED;
  }

  private leave(): { consume: true } {
    this.deactivate();
    return CONSUMED;
  }

  private deactivate(): void {
    if (!this.active) return;
    this.resetSelection();
    this.redraw();
  }

  // ---- Open ----

  private openSelected(): void {
    const rows = this.rows();
    const row = rows[this.resolveIndex(rows) - 1];
    if (!row) return;
    const entry = navigationEntryFor(row, this.deps.registry);
    if (!entry) return;
    void this.openPane(row.id, entry);
  }

  /** Opens the pane for one agent and reselects it when the pane closes. */
  private async openPane(id: string, entry: NavigationEntry): Promise<void> {
    const ui = this.ui;
    if (!ui) return;
    this.viewingId = id;
    try {
      await (this.deps.open ?? openTranscript)(ui, entry, { cwd: this.deps.cwd(), readFile: this.deps.readFile });
    } catch {
      ui.notify("Could not open the session pane.", "error");
    } finally {
      this.reselect(id);
      this.viewingId = undefined;
      this.update();
    }
  }

  /** Selects the viewed agent's row by id, or keeps the index within the rows that remain. */
  private reselect(id: string): void {
    this.selectedId = id;
    this.resolveIndex(this.rows());
  }
}

## Context

The vendored executor (`packages/pi-subagents/`, fork of `gotgenes/pi-packages` 25.0.5) has two UI surfaces for subagents: the above-editor `AgentWidget` (background runs only, ADR 0004 A) and the `/subagents:sessions` command, which picks an agent with `ui.select` and opens a `TranscriptPane` (docked in regular mode per ADR 0007, a focused overlay in fullscreen per ADR 0012). The pane is read-only and renders through Pi's own entry components via a `TranscriptSource` (`liveSource` for a record with a session, `fileSnapshotSource` for a released one).

`tintinweb/pi-subagents` 0.23.2 (`src/ui/fleet-list.ts`, commit `83fdf77f`) implements FleetView as a `belowEditor` widget plus an `onTerminalInput` listener, opening its own `ConversationViewer`. Its list logic is separable from that viewer and from its workflows, mentions, cost and handoff features.

## Goals / Non-Goals

**Goals:**
- A below-editor roster of `main` and the subagents that have a transcript to open, with one-key entry to the existing session pane.
- Never steal keys from a typed prompt, a dialog, or the pane itself.
- Keep the vendored diff small and recorded: one new UI module, a shared open step, one setting.

**Non-Goals:**
- Steer, stop, background handoff, workflows, mentions, cost.
- Row facts beyond name, description, elapsed and tokens (ttdua/pi-jev-pilot#63).
- Any change to jev-pilot's own `src/`.

## Decisions

### D1. Port the list behavior, not tintinweb's file wholesale
Write `src/ui/fleet-list.ts` in the fork's style (`#src/*` imports, narrow UI interfaces, `Subagent` records from `SubagentManager.listAgents()`), carrying over tintinweb's behavior and constants: `MAX_AGENT_ROWS = 5`, `FINISHED_LINGER_MS = 4000`, `rightAlign`, `formatFleetElapsed`, `formatFleetTokens`, the windowed rows with `↑/↓ N more`, the two hint lines, and the trailing blank line above Pi's footer. Dropped: workflow rows, agent color badges (the fork has no `agent-color`), cost, the viewer, `backgroundAction`.
*Why over a verbatim copy:* the verbatim file imports `AgentManager`, `agent-color`, `ConversationViewer` and workflow types the fork does not have.

### D2. Split the list into a pure roster/render core and a thin Pi adapter
- `fleet-roster.ts` (pure): `fleetRows(agents, now, viewingId)` picks and orders rows; `renderFleetLines({rows, selected, active, width, theme, now})` returns lines. No timers, no Pi types; unit-tested like `widget-renderer.ts`.
- `fleet-list.ts` (adapter): owns `active`, `selectedIndex`, the tick timer, the widget registration, the input listener, and the open call.
*Why:* matches the fork's `widget-renderer.ts` / `agent-widget.ts` split and the coding standards' single-responsibility units.

### D3. Rows are agents with a transcript the pane can open
A row is shown when `(isSessionReady() || outputFile)` **and** `(running || queued || settled less than 4 s ago || the one being viewed)`. A settled record whose session is still held drops out after 4 s like any other. That is exactly the condition under which `/subagents:sessions` can open it, so `Enter` never dead-ends. Foreground and background records both qualify (operator decision). The list shows when at least one agent row exists. Activation selects the first agent row (operator: "`↓` selects a running subagent"); `↑` from it reaches `main`, and `↑` on `main` leaves. This departs from tintinweb, which selected `main` first.

### D4. `Enter` reuses the session navigator's open step
Extract from `SessionNavigatorHandler.handle` an `openTranscript(ui, entry, deps)` function (probe TUI mode, pick `liveSource` or `fileSnapshotSource`, mount `TranscriptPane` with `viewerMountOptions`). `handle` keeps its picker and calls it; the fleet list builds the same `NavigationEntry` for one record (via an exported `navigationEntryFor(record, registry)` taken from `listNavigableAgents`) and calls it. The promise resolves when the pane closes; the list then reselects the viewed agent by id.
*Why over invoking the command:* an extension cannot run another command programmatically through public APIs, and duplicating the mount would drift.

### D5. Focus guard via public `tui.getFocusedComponent()`
The input listener acts only when: the list is enabled; the key is a press (not a kitty release); no pane opened from the list is up; and the focused component is the prompt editor. "Editor" is recognized structurally (`getText` and `setText` functions), as tintinweb does after its #374 fix, so custom editors work. `tui` comes from the `setWidget` factory, which Pi calls on the first render after the widget is set, before any key can target the list; until it is captured, the list consumes no key. Activation additionally needs `ui.getEditorText() === ""`.
*Why:* tintinweb read the private `focusedComponent`; pi-tui 1.5.0 exposes `getFocusedComponent()` publicly, so the "Public Pi APIs only" invariant holds.

### D6. Interaction with the fullscreen viewport
In fullscreen, Pi's viewport listener runs first and claims PgUp/PgDn/Home/End only; `↓`, `←`, `↑`, `Enter`, `Esc` reach the extension listener. The pane opened from the list mounts exactly as from the command (ADR 0012 overlay), so its keys work unchanged.

### D7. Setting `fleetView`
Add `fleetView?: boolean` to `SubagentsSettings`, `fleetView: boolean` to `SettingsSnapshot` (always written, like `midRunUpdates`), default `true`, `toggleFleetView()` on the settings manager, and a toggle row "Fleet view" in `/subagents:settings`. The list reads it live; turning it off clears the widget and leaves the list inactive.

### D8. Lifecycle
Constructed in `index.ts` after the manager, registered as a `SubagentManagerObserver` (run started/finished trigger `update()`), given the UI at `session_start` alongside the widget, disposed at `session_shutdown` after the lifecycle handler. The tick timer runs every 1000 ms while the list is shown or any subagent is running or queued, and stops otherwise. The "or running" part is needed because `onSubagentRunStarted` fires before the child session exists, so the first agent's row only becomes eligible later with no event; the observer has no session-ready hook and none is added. Rows show whole seconds and have no spinner, so a faster tick only costs frames (tintinweb used 200 ms for the same rows). `setUICtx` removes the previous input listener before adding one, so a reload or session replacement leaves exactly one. Print, JSON and child sessions get a UI context whose `setWidget` and `onTerminalInput` have no effect, the same context the widget already relies on.

### D9. Records of the departure
New executor ADR `0013-fleet-list-opens-the-session-pane.md`: the list is the "widget gesture" ADR 0004 left as a later option (Criterion 3), it opens the read-only pane, and it lists foreground runs because its job is navigation, not progress. `VENDORED.md` gets one row per new and edited file. `NOTICE.md` credits `tintinweb/pi-subagents` (MIT, Copyright (c) 2026 tintinweb) for the ported list behavior, at version 0.23.2.

## Risks / Trade-offs

- [`getFocusedComponent()` returns a delegating container for some editors] → structural check accepts any component with `getText`/`setText`; with no captured `tui` the list consumes nothing.
- [Arrow keys at an empty prompt no longer reach Pi's history while agents run] → only `↓`/`←` are taken, and only while the list is shown; `↑` (history) is untouched until the list is entered. Same trade-off tintinweb ships; the setting turns it off.
- [Two below-editor widgets from other extensions stack] → the widget key is `fleet`, unique to this extension.
- [Extra vendored diff makes upstream sync harder] → new code lives in new files; edits are the open-step extraction, wiring and one setting, each listed in `VENDORED.md`.
- [Rerender cost while idle] → 1 s timer, only while shown.

## Migration Plan

None. The setting defaults on; existing `subagents.json` files without `fleetView` load unchanged. Rollback is `fleetView: false` or reverting the change.

## Open Questions

None.

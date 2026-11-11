## Why

While several subagents run, the operator has no always-visible roster of them and must type `/subagents:sessions` and pick from a menu to open one. The FleetView they used in `tintinweb/pi-subagents` gave both at a glance and with one key; the vendored fork never shipped it. Tracked in ttdua/pi-jev-pilot#62.

## What Changes

- New below-editor list in the vendored executor: `main` plus every subagent that has a transcript to open, foreground included, earliest launched first, each row with name, description, elapsed seconds and tokens; finished agents linger 4 seconds; at most 5 agent rows with `↑ N more` / `↓ N more` indicators.
- Keys at an empty prompt with the editor focused: `↓` or `←` enters the list on the first agent, `↑`/`↓` move, `Esc` or `↑` above `main` leaves, `Enter` on an agent opens the existing `/subagents:sessions` pane for that agent, `Enter` on `main` leaves. Keys are never taken from a non-empty prompt or another focused component.
- `/subagents:sessions` keeps its behavior; its open-one-agent step is shared with the list.
- New persisted setting `fleetView` (default `true`) with a toggle in `/subagents:settings`.
- `VENDORED.md` lists every edited and new file; `NOTICE.md` credits `tintinweb/pi-subagents` for the ported list behavior; a new executor ADR records the list and why it opens the existing pane.
- Not in scope: steer or stop, a new viewer, workflows, `ctrl+b` handoff, `@mentions`, cost, extra row facts (ttdua/pi-jev-pilot#63).

## Capabilities

### New Capabilities
- `fleet-view`: the below-editor subagent list in the vendored executor, its rows, keys, focus guard, opening the existing session pane, and its on/off setting.

### Modified Capabilities
- `executor-vendoring`: "Upstream license kept" also requires `NOTICE.md` to credit `tintinweb/pi-subagents` (MIT) for code ported from it.

## Impact

- Code (vendored executor only): new `packages/pi-subagents/src/ui/fleet-list.ts`; edits to `src/index.ts` (wiring), `src/ui/session-navigator.ts` (shared open step), `src/settings.ts` and `src/ui/subagents-settings.ts` (`fleetView`); new tests under `packages/pi-subagents/test/ui/`. No change under `src/` of jev-pilot; Jev is not called.
- Docs updated: `docs/usage-guide.md` (what the list is and its keys), `packages/pi-subagents/README.md`, `packages/pi-subagents/docs/configuration.md` (`fleetView`), new `packages/pi-subagents/docs/decisions/0013-fleet-list-opens-the-session-pane.md`, `packages/pi-subagents/VENDORED.md`, `NOTICE.md`, `CHANGELOG.md`.
- No new dependency; public Pi APIs only (focus is read through pi-tui's public `getFocusedComponent()`).

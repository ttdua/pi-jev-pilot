## 1. Fleet view setting

Blocked by: none

- [x] 1.1 Add `fleetView` to `SubagentsSettings`, `SettingsSnapshot`, load (boolean only), snapshot and `toggleFleetView()` in `packages/pi-subagents/src/settings.ts`, default `true`, with tests in `test/settings.test.ts`
- [x] 1.2 Add the `Fleet view` toggle row to `packages/pi-subagents/src/ui/subagents-settings.ts`, with a test in `test/ui/subagents-settings.test.ts`

## 2. Shared open step for the session pane

Blocked by: none

- [ ] 2.1 Export `navigationEntryFor(record, registry)` from `packages/pi-subagents/src/ui/session-navigation.ts` (one record's live or snapshot entry, or undefined) and use it inside `listNavigableAgents`; extend `test/ui/session-navigation.test.ts`
- [ ] 2.2 Extract `openTranscript(ui, entry, deps)` from `SessionNavigatorHandler.handle` in `packages/pi-subagents/src/ui/session-navigator.ts` (source choice, read-error notify, mode probe, mount) and make `handle` call it; existing `test/ui/session-navigator.test.ts` stays green and gains direct tests for `openTranscript`

## 3. Pure fleet roster and renderer

Blocked by: none

- [ ] 3.1 Create `packages/pi-subagents/src/ui/fleet-roster.ts` with `fleetRows`, `formatFleetElapsed`, `formatFleetTokens`, `rightAlign`, `renderFleetLines` per design D1-D3
- [ ] 3.2 Unit tests `packages/pi-subagents/test/ui/fleet-roster.test.ts` for row inclusion, order, linger, layout, row text, overflow windowing and width clamping

## 4. Fleet list adapter and keys

Blocked by: 2, 3

- [ ] 4.1 Create `packages/pi-subagents/src/ui/fleet-list.ts` (`FleetList`): UI capture with listener replacement, widget registration below the editor, 1 s timer rule, the four required observer hooks, `enabled()` read live, dispose
- [ ] 4.2 Key handling: press-only, activation on the first agent row, navigation, focus guard via `tui.getFocusedComponent()`, no consumption before the TUI is captured, pass-through while a pane is open
- [ ] 4.3 `Enter` calls `openTranscript` with `navigationEntryFor`; reselect the viewed agent by id when the pane closes
- [ ] 4.4 Tests `packages/pi-subagents/test/ui/fleet-list.test.ts` covering the key, focus, open, selection, timer and lifecycle scenarios

## 5. Wiring in the executor

Blocked by: 1, 4

- [ ] 5.1 Wire `FleetList` in `packages/pi-subagents/src/index.ts`: construct after the manager, add as observer, UI at `session_start`, `enabled: () => settings.fleetView`, dispose at `session_shutdown` after the lifecycle handler, refresh on `subagents:settings_changed`; give the existing test UI fixtures `onTerminalInput` and `getEditorText`
- [ ] 5.2 Wiring test `packages/pi-subagents/test/seams/fleet-wiring.test.ts` (widget key `fleet` below the editor once a spawned agent's session is ready, one listener after two `session_start`s, settings toggle) and root host test `tests/host/fleet-print.test.ts` (print output identical with `fleetView` on and off)
- [ ] 5.3 Run `bun run test:executor`, `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun run test` from the root; all pass

## 6. Provenance and docs

Blocked by: 5

- [ ] 6.1 Add `VENDORED.md` rows for every new and edited file in `packages/pi-subagents/`; `tests/vendoring.test.ts` passes
- [ ] 6.2 Add the `tintinweb/pi-subagents` 0.23.2 MIT entry to `NOTICE.md`; extend `tests/vendoring.test.ts` (or the notice test) for the new scenario
- [ ] 6.3 Write `packages/pi-subagents/docs/decisions/0013-fleet-list-opens-the-session-pane.md`
- [ ] 6.4 Update `packages/pi-subagents/README.md`, `packages/pi-subagents/docs/configuration.md` (`fleetView`), `docs/usage-guide.md` and `CHANGELOG.md`

## 7. End-to-end check

Blocked by: 6

- [ ] 7.1 With `scripts/e2e/fleet-fixture.ts` (loopback fixture provider, slow children), install the checkout into a temporary agent dir with `PI_OFFLINE=1`, start Pi interactively in tmux, launch a background and a foreground subagent with a local fake provider, and confirm the list appears below the editor, `↓` selects the first agent, `Enter` opens the session pane, `Esc` returns, and the list clears 4 s after the last agent finishes; record the evidence under `docs/evidence/`

# Fleet View Port Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` (`specs/fleet-view/spec.md`, `specs/executor-vendoring/spec.md`) and `design.md`.

**Goal:** A below-editor list of running subagents in the vendored executor; `↓` selects one, `Enter` opens the existing `/subagents:sessions` pane on it.

**Architecture:** A pure roster/render module (`fleet-roster.ts`) and a thin Pi adapter (`fleet-list.ts`) that owns focus, keys, timer and widget registration. `Enter` reuses an open step extracted from `SessionNavigatorHandler`. A `fleetView` setting gates it. Ported behavior from `tintinweb/pi-subagents` 0.23.2 `src/ui/fleet-list.ts`, without its viewer, workflows, colors or cost.

**Tech Stack:** TypeScript, `@earendil-works/pi-coding-agent` / `@earendil-works/pi-tui` 1.5.0, vitest (executor package), bun test (root).

## Global Constraints

- All work is under `packages/pi-subagents/` plus `NOTICE.md`, `CHANGELOG.md`, `docs/usage-guide.md`, `docs/evidence/`, `tests/vendoring.test.ts`, `tests/host/fleet-print.test.ts` and `scripts/e2e/fleet-fixture.ts`. No file under the root `src/` changes.
- Public Pi APIs only. Focus is read with `tui.getFocusedComponent()`; never the private `focusedComponent`.
- Constants: widget key `fleet`, placement `belowEditor`, `MAX_AGENT_ROWS = 5`, `FINISHED_LINGER_MS = 4000`, `TICK_MS = 1000`.
- Exact strings: hints `esc to interrupt · ← for agents · ↓ to manage` and `↑↓ select · enter view · esc back`; markers `●` / `○`; `↑ N more`, `↓ N more`; stats `<s>s · ↓ <compact> tokens`; error `Could not read the session transcript file.`; settings label `Fleet view`.
- Executor style: tabs or two spaces as the edited file already uses, `#src/*` imports. The gates are the ones CI runs: root `bun run typecheck`, `bun run lint` (oxlint, ignores `packages/**`), `bun run fmt:check`, `bun run test`, and `bun run test:executor` (executor `tsc --noEmit` + vitest). The executor's own `lint` script is not a gate: it has no eslint config in this checkout and Biome already fails on the untouched baseline; new files follow the surrounding style and nothing reformats the vendored tree.
- Baseline (recorded 2026-11-11 after `bun install --frozen-lockfile`): `bun run test:executor` passes 95 files / 2288 tests.
- `VENDORED.md` is edited by Tasks 1, 2, 3 and 4. If the executor runs them in parallel lanes, the lane merge resolves `VENDORED.md` by keeping every row; each task adds rows for its source **and** test files.
- Every new or edited file in `packages/pi-subagents/` gets a `VENDORED.md` row in the same commit, or `tests/vendoring.test.ts` fails.
- Tests need no secrets, paid calls or network beyond loopback.

## Review Focus

1. Typing at a non-empty prompt, history `↑`, and cursor `←` inside text are unchanged while agents run → test `passes ← through when the prompt has text` in Task 4.
2. A `ctx.ui.select` dialog opened while agents run keeps its arrows and Enter → test `leaves a focused selector's keys alone` in Task 4.
3. Kitty key releases do not double-move → test `ignores key releases` in Task 4.
4. Very narrow terminal (width 10) and very long descriptions/names never exceed the width → test `clamps every line at width 10` in Task 3.
5. Agents finishing while the pane is open: list does not jump the selection or reopen anything → test `keeps the viewed agent listed while its pane is open` in Task 4.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `SubagentsSettings.fleetView` | new | `fleetView?: boolean` in `src/settings.ts` | yes (`subagents.json` key) |
| `SettingsSnapshot.fleetView` | new | `fleetView: boolean` (always written) | yes (`subagents.json` key) |
| `SubagentsSettingsManager.fleetView` / `toggleFleetView` | new | `get fleetView(): boolean`; `toggleFleetView(): { message: string; level: "info" \| "warning" }`, toast `Fleet view: on` / `Fleet view: off` | no |
| `navigationEntryFor` | new | `navigationEntryFor(record: NavigableSubagent, registry: AgentConfigLookup): NavigationEntry \| undefined` in `src/ui/session-navigation.ts` | no |
| `openTranscript` | new | `openTranscript(ui: SessionNavigatorUI, entry: NavigationEntry, deps: { cwd: string; readFile: (path: string) => string }): Promise<void>` in `src/ui/session-navigator.ts` | no |
| `FleetAgent` | new | `NavigableSubagent & { readonly lifetimeUsage: Readonly<LifetimeUsage> }` in `src/ui/fleet-roster.ts`; a `Subagent` satisfies it, so a row is the full record and `Enter` passes it to `navigationEntryFor` unchanged | no |
| `fleetRows` | new | `fleetRows(agents: readonly FleetAgent[], now: number, viewingId: string \| undefined): FleetAgent[]` | no |
| `renderFleetLines` | new | `renderFleetLines(p: { rows: readonly FleetAgent[]; selected: number; active: boolean; width: number; now: number; theme: Theme; registry: AgentConfigLookup }): string[]` — `selected` 0 = `main`, 1..N = rows | no |
| `formatFleetElapsed`, `formatFleetTokens`, `rightAlign` | new | `(ms: number) => string`; `(count: number) => string` returning `↓ 13.1k tokens`; `(left: string, right: string, width: number) => string` | no |
| `FleetWidgetFactory` | new | `(tui: FleetTui, theme: Theme) => { render(width: number): string[]; invalidate(): void }` | no |
| `FleetTui` | new | `{ getFocusedComponent(): unknown; requestRender(): void }` (structural subset of pi-tui `TUI`) | no |
| `FleetUI` | new | `SessionNavigatorUI & { setWidget(key: string, content: FleetWidgetFactory \| undefined, options?: { placement?: "aboveEditor" \| "belowEditor" }): void; onTerminalInput(handler: (data: string) => { consume?: boolean; data?: string } \| undefined): () => void; getEditorText(): string }` | no |
| `FleetList` | new | `class FleetList implements SubagentManagerObserver { constructor(deps: { manager: Pick<SubagentManager, "listAgents">; registry: AgentConfigLookup; enabled: () => boolean; cwd: () => string; readFile: (path: string) => string; open?: typeof openTranscript }); setUICtx(ui: FleetUI): void; update(): void; handleKey(data: string): { consume: true } \| undefined; onSubagentCreated(): void; onSubagentRunStarted(): void; onSubagentRunFinished(): void; onSubagentCompacted(): void; dispose(): void }`. `onSubagentCreated`, `onSubagentRunStarted`, `onSubagentRunFinished` call `update()`; `onSubagentCompacted` is a no-op. There is no `setEnabled`: `enabled()` is read on every `update()` and key, and the settings toggle triggers `update()` | no |

---

## Task 1: Fleet view setting — implements 1

**Covers:** 1.1, 1.2
**Difficulty:** Easy
**Blocked by:** none

**Files:**
- Modify: `packages/pi-subagents/src/settings.ts`, `packages/pi-subagents/src/ui/subagents-settings.ts`, `packages/pi-subagents/VENDORED.md`
- Test: `packages/pi-subagents/test/settings.test.ts`, `packages/pi-subagents/test/ui/subagents-settings.test.ts`

**Interfaces:** Produces `SubagentsSettings.fleetView`, `SettingsSnapshot.fleetView`, `fleetView` getter, `toggleFleetView()`.

- [ ] **Step 1:** Add tests next to the `midRunUpdates` ones: `defaults fleetView to true`; `keeps fleetView when it is a boolean`; `drops a non-boolean fleetView` (`"no"` → `true`); `snapshot always writes fleetView`; `toggleFleetView() flips, persists and returns "Fleet view: off"`. In `subagents-settings.test.ts`: `lists Fleet view with on/off and flips it`.
- [ ] **Step 2:** Run `bun run --cwd packages/pi-subagents test -- settings subagents-settings`; expect the new tests to FAIL.
- [ ] **Step 3:** Implement following the `midRunUpdates` pattern (field `_fleetView = true`, load boolean only, snapshot, getter, toggle via `saveAndNotify`), and a `toggle` descriptor labeled `Fleet view` after the mid-run row.
- [ ] **Step 4:** Rerun; expect PASS. Run `bun run --cwd packages/pi-subagents check`.
- [ ] **Step 5:** Add `VENDORED.md` rows for both edited files; commit `feat(executor): add the fleetView setting`.

---

## Task 2: Shared open step for the session pane — implements 2

**Covers:** 2.1, 2.2
**Difficulty:** Normal
**Blocked by:** none

**Files:**
- Modify: `packages/pi-subagents/src/ui/session-navigation.ts`, `packages/pi-subagents/src/ui/session-navigator.ts`, `packages/pi-subagents/VENDORED.md`
- Test: `packages/pi-subagents/test/ui/session-navigation.test.ts`, `packages/pi-subagents/test/ui/session-navigator.test.ts`

**Interfaces:** Produces `navigationEntryFor`, `openTranscript` (see Contracts).

- [ ] **Step 1:** Tests: `navigationEntryFor returns a live entry for a ready session`; `returns a snapshot entry when only outputFile is set`; `returns undefined with neither`. `openTranscript mounts a TranscriptPane on a live source`; `openTranscript renders the file's transcript for a snapshot entry` (reads a fixture JSONL as the existing handler test does); `notifies "Could not read the session transcript file." and mounts nothing when readFile throws`; `uses the overlay mount in fullscreen` (probe returns `fullscreen`). Existing `SessionNavigatorHandler` tests stay unchanged.
- [ ] **Step 2:** Run `bun run --cwd packages/pi-subagents test -- session-navigat`; expect the new tests to FAIL.
- [ ] **Step 3:** Move the per-record branch of `listNavigableAgents` into `navigationEntryFor` and call it there; move the source choice, read-error notify, `probeTuiMode` and `ui.custom` mount out of `handle` into `openTranscript`; `handle` becomes picker + `openTranscript`.
- [ ] **Step 4:** Rerun the suite and `check`; expect PASS with no existing test edited.
- [ ] **Step 5:** `VENDORED.md` rows; commit `refactor(executor): share the session pane open step`.

---

## Task 3: Pure fleet roster and renderer — implements 3

**Covers:** 3.1, 3.2
**Difficulty:** Normal
**Blocked by:** none

**Files:**
- Create: `packages/pi-subagents/src/ui/fleet-roster.ts`
- Test: `packages/pi-subagents/test/ui/fleet-roster.test.ts`
- Modify: `packages/pi-subagents/VENDORED.md`

**Interfaces:** Produces `FleetAgent`, `fleetRows`, `renderFleetLines`, `formatFleetElapsed`, `formatFleetTokens`, `rightAlign`.

- [ ] **Step 1:** Tests with an identity theme (`fg: (_, t) => t`, `bold: t => t`) and a registry stub:
  - `fleetRows`: `lists a running agent with a ready session`; `lists a foreground agent` (no background filter exists); `skips a queued agent with no session and no outputFile`; `orders by startedAt` (A 1000, B 500 → [B, A]); `keeps an agent finished 3000 ms ago` (and its row's elapsed is frozen at `completedAt`, asserted through `renderFleetLines`); `drops an agent finished 10000 ms ago with a held session`; `keeps the viewed agent past the linger`.
  - format: `formatFleetElapsed(12_400)` → `"12s"`; `formatFleetTokens(950)` → `"↓ 950 tokens"`, `13_100` → `"↓ 13.1k tokens"`, `1_200_000` → `"↓ 1.2M tokens"`.
  - render: `inactive layout` → `[hint, "", "  ○ main", row, ""]` with the inactive hint; `active hint and marker`; `row text` (`Explore`, `audit auth`, ends with `12s · ↓ 13.1k tokens`); `overflow shows ↓ 2 more` (7 rows, selected 1); `windows to keep the selected row visible` (7 rows, selected 7 → `↑ 2 more`); `clamps every line at width 20`; `clamps every line at width 10`.
- [ ] **Step 2:** Run `bun run --cwd packages/pi-subagents test -- fleet-roster`; expect FAIL (module missing).
- [ ] **Step 3:** Implement per design D1–D3 using `truncateToWidth`/`visibleWidth` from `@earendil-works/pi-tui` and `getDisplayName`, `getLifetimeTotal`; constants from Global Constraints. Header comment credits `tintinweb/pi-subagents` 0.23.2.
- [ ] **Step 4:** Rerun; PASS. `bun run --cwd packages/pi-subagents check` clean.
- [ ] **Step 5:** `VENDORED.md` row with kind `seam` (the kind this file uses for added files); commit `feat(executor): fleet roster and renderer`.

---

## Task 4: Fleet list adapter and keys — implements 4

**Covers:** 4.1, 4.2, 4.3, 4.4
**Difficulty:** Hard
**Blocked by:** Task 2, Task 3

**Files:**
- Create: `packages/pi-subagents/src/ui/fleet-list.ts`
- Test: `packages/pi-subagents/test/ui/fleet-list.test.ts`
- Modify: `packages/pi-subagents/VENDORED.md`

**Interfaces:** Consumes `fleetRows`, `renderFleetLines`, `navigationEntryFor`, `openTranscript`. Produces `FleetUI`, `FleetList`.

- [ ] **Step 1:** Tests with a fake UI (records `setWidget` calls, captures the input handler, `getEditorText` stub), a fake TUI (`getFocusedComponent`, `requestRender`), `vi.useFakeTimers()`, and an injected `open` spy:
  - visibility: `sets the fleet widget below the editor when an agent runs`; `clears it 4 s after the last agent finishes`; `sets nothing while disabled`; `clears it when disabled`.
  - activation: `↓ at an empty prompt selects the first agent and consumes`; `← activates too`; `passes ↓ through when the prompt has text`; `passes ← through when the prompt has text`; `passes keys through before the TUI is captured`; `ignores key releases` (kitty release sequence for down).
  - navigation: `↓ stops at the last row`; `↑ from the first agent selects main`; `↑ on main deactivates and consumes`; `Esc deactivates`; `Enter on main deactivates`; `another key deactivates and passes through`.
  - focus: `leaves a focused selector's keys alone` (focused component without `getText`); `accepts a custom editor with getText and setText`; `deactivates when focus moves away`.
  - open: `Enter on an agent calls open with its navigation entry`; `Enter on an agent with only outputFile opens a snapshot entry`; `passes every key through while the pane is open`; `keeps the viewed agent listed while its pane is open`; `reselects the viewed agent by id after close` (an earlier agent dropped out); `keeps a valid selection when the viewed agent is gone`.
  - observer: `onSubagentCreated, onSubagentRunStarted and onSubagentRunFinished refresh`; `onSubagentCompacted changes nothing`.
  - lifecycle: `replaces its input listener on a second setUICtx`; `runs the 1 s timer while an agent is running with no row yet`; `shows the row once the session becomes ready, without a run event`; `stops the timer when idle`; `dispose clears the widget, the timer and the listener`.
- [ ] **Step 2:** Run `bun run --cwd packages/pi-subagents test -- fleet-list`; expect FAIL.
- [ ] **Step 3:** Implement `FleetList` per design D2–D8. `handleKey` order: disabled or no UI → undefined; key release → undefined; pane open → undefined; no captured TUI → undefined; focused component lacks `getText`/`setText` → deactivate if active, undefined; then inactive/active handling. `Enter` builds the entry with `navigationEntryFor`, sets `viewingId`, awaits `open(ui, entry, { cwd: cwd(), readFile })`, then reselects by id and clears `viewingId` in `finally`.
- [ ] **Step 4:** Rerun; PASS. `bun run --cwd packages/pi-subagents check` clean. Keep each method short and single-purpose (coding standards); root CI gates run in Task 5.
- [ ] **Step 5:** `VENDORED.md` row; commit `feat(executor): fleet list below the editor`.

---

## Task 5: Wiring in the executor — implements 5

**Covers:** 5.1, 5.2, 5.3
**Difficulty:** Normal
**Blocked by:** Task 1, Task 4

**Files:**
- Modify: `packages/pi-subagents/src/index.ts`, `packages/pi-subagents/VENDORED.md`
- Test: `packages/pi-subagents/test/seams/fleet-wiring.test.ts` (new); `tests/host/fleet-print.test.ts` (new, root)
- Modify (fixtures that hand `ctx.ui` to `session_start`, which now needs `onTerminalInput` and `getEditorText`): `packages/pi-subagents/test/composition-root.test.ts` (`makeRecordingUI`, and the `toHaveBeenLastCalledWith("agents", …)` assertions become per-key: the last `setWidget` call whose key is `agents`), `packages/pi-subagents/test/print-mode.test.ts` (`makeHeadlessCtx`), `packages/pi-subagents/test/seams/service-wiring.test.ts`. Each gains `onTerminalInput: vi.fn(() => () => {})` and `getEditorText: () => ""`.

**Interfaces:** Consumes `FleetList`, `settings.fleetView`.

- [ ] **Step 1:** Tests through the real `index.ts` factory, firing every registered handler per event as `composition-root.test.ts` does, with fake timers: `registers the fleet widget below the editor once the spawned agent's session is ready` (spawn via `getSubagentsService()`, then `vi.advanceTimersByTimeAsync(1000)`); `one input listener after two session_start events`; `fleetView off from settings sets no widget`; `settings_changed to off clears the widget`; `session_shutdown removes the listener`. Root host test `tests/host/fleet-print.test.ts` using `runOnce` from `tests/host/harness.ts`: `print mode output is identical with fleetView on and off` — a fixture script whose main reply calls the `subagent` tool for a foreground child that answers with text, run twice with `<cwd>/.pi/subagents.json` `{"fleetView":true}` then `false`; same exit code 0 and identical stdout.
- [ ] **Step 1b:** Update the three existing fixtures listed above; run `bun run test:executor` and confirm only the new tests fail.
- [ ] **Step 2:** Run `bun run --cwd packages/pi-subagents test -- fleet-wiring`; FAIL.
- [ ] **Step 3:** In `index.ts`: construct `FleetList` after `widget` with `enabled: () => settings.fleetView`, `cwd` from the last `session_start` ctx, `readFile` via `readFileSync(path, "utf8")`; `observer.add(fleet)`; `pi.on("session_start", (_e, ctx) => fleet.setUICtx(ctx.ui))`; `pi.events.on("subagents:settings_changed", () => fleet.update())`; `pi.on("session_shutdown", () => fleet.dispose())` registered after the lifecycle handler.
- [ ] **Step 4:** Run `bun run test:executor`, `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun run test` at the repo root; all exit 0.
- [ ] **Step 5:** `VENDORED.md` row for `src/index.ts` (extend its existing reason); commit `feat(executor): wire the fleet list`.

---

## Task 6: Provenance and docs — implements 6

**Covers:** 6.1, 6.2, 6.3, 6.4
**Difficulty:** Easy
**Blocked by:** Task 5

**Files:**
- Modify: `packages/pi-subagents/VENDORED.md`, `NOTICE.md`, `tests/vendoring.test.ts`, `packages/pi-subagents/README.md`, `packages/pi-subagents/docs/configuration.md`, `docs/usage-guide.md`, `CHANGELOG.md`
- Create: `packages/pi-subagents/docs/decisions/0013-fleet-list-opens-the-session-pane.md`

- [ ] **Step 1:** Add test `notice credits tintinweb for the fleet list` to `tests/vendoring.test.ts`: `NOTICE.md` contains `tintinweb/pi-subagents`, `0.23.2` and `MIT`. Run `bun test tests/vendoring.test.ts`; FAIL.
- [ ] **Step 2:** Add the `NOTICE.md` line: tintinweb/pi-subagents 0.23.2 at commit `83fdf77f918e37c0b0116cade493569d7e745ae1`, Copyright (c) 2026 tintinweb, MIT; the fleet list behavior in `packages/pi-subagents/src/ui/fleet-roster.ts` and `fleet-list.ts`. Rerun; PASS.
- [ ] **Step 3:** Write ADR 0013 (status accepted; context ADR 0004 criterion 3; decision per design D3, D4, D9; consequences). Audit `VENDORED.md` against `git diff --name-only <feature base>...HEAD -- packages/pi-subagents/` (the base branch from `apply.md`); every source and test file has one row.
- [ ] **Step 4:** Docs: README feature bullet and a `Fleet list` section with the keys; `configuration.md` `fleetView` row and example; `docs/usage-guide.md` short "Subagent list" note under "What changes in your sessions"; `CHANGELOG.md` Unreleased entry linking ttdua/pi-jev-pilot#62.
- [ ] **Step 5:** `bun run test` and `bun run test:executor`; commit `docs: fleet list provenance and usage`.

---

## Task 7: End-to-end check — implements 7

**Covers:** 7.1
**Difficulty:** Normal
**Blocked by:** Task 6

**Files:**
- Create: `docs/evidence/<date>-fleet-list.md`, `scripts/e2e/fleet-fixture.ts`

- [ ] **Step 1:** Write `scripts/e2e/fleet-fixture.ts` (run with `bun`) that starts `startFixture` from `tests/host/fixture.ts` with this script: the first main request replies with two `subagent` tool calls (`run_in_background: true` for one, `false` for the other, `subagent_type: "general-purpose"`, model `fixture/fixture-fast`); child requests (matched on model `fixture-fast`) reply `done` after `delayMs: 20000`; the follow-up main request replies `ok`. A second main prompt containing `again` replies with one background `subagent` call whose child also waits 20 s, so the setting-off check has a real launch; the script asserts that child's request reached the fixture. It prints the base URL, writes `models.json` with `fixtureModelsJson`, and installs the checkout into a fresh temp agent dir with `PI_OFFLINE=1` via `PI_BIN`, as `prepare()` in `tests/host/harness.ts` does.
- [ ] **Step 2:** Start `pi --provider fixture --model fixture-main` interactively inside `tmux new -d -x 120 -y 40` with that agent dir, send any prompt, wait up to 10 s (poll `capture-pane`); ask for one background and one foreground subagent; `tmux capture-pane -p` and confirm the list below the editor with both agents.
- [ ] **Step 3:** Send `Down`; confirm the first agent row is `●`. Send `Enter`; confirm the session pane header names that agent. Send `Escape` twice; confirm the prompt is back and empty. Type `abc` then `Down`; confirm the list did not activate.
- [ ] **Step 4:** Let agents finish; confirm the list is gone about 4 s later. Toggle `Fleet view` off in `/subagents:settings`; send `again`; once the fixture has recorded the child request, confirm no list.
- [ ] **Step 5:** Kill the tmux session and the fixture, remove temp dirs. Record commands, captured screens (no prompt text beyond fixture markers) and versions in `docs/evidence/<date>-fleet-list.md`; commit `docs(evidence): fleet list end to end`.

---

## Scenario → test

- Shown while an agent runs → `fleet-list.test.ts` "sets the fleet widget below the editor when an agent runs"; `fleet-wiring.test.ts` "registers the fleet widget below the editor once the spawned agent's session is ready"
- Cleared when nothing remains → `fleet-list.test.ts` "clears it 4 s after the last agent finishes"
- Off by setting → `fleet-list.test.ts` "sets nothing while disabled"; `fleet-wiring.test.ts` "fleetView off from settings sets no widget"
- Narrow terminal → `fleet-roster.test.ts` "clamps every line at width 20"
- Inactive layout → `fleet-roster.test.ts` "inactive layout"
- Active hint → `fleet-roster.test.ts` "active hint and marker"
- Foreground run listed → `fleet-roster.test.ts` "lists a foreground agent"
- Queued agent without a session is not listed → `fleet-roster.test.ts` "skips a queued agent with no session and no outputFile"
- Earliest first → `fleet-roster.test.ts` "orders by startedAt"
- Settled agent with a held session drops out → `fleet-roster.test.ts` "drops an agent finished 10000 ms ago with a held session"
- Finished agent lingers → `fleet-roster.test.ts` "keeps an agent finished 3000 ms ago" (inclusion and frozen elapsed)
- Row text → `fleet-roster.test.ts` "row text"
- Overflow → `fleet-roster.test.ts` "overflow shows ↓ 2 more"
- Activate at an empty prompt → `fleet-list.test.ts` "↓ at an empty prompt selects the first agent and consumes"
- Typing is untouched → `fleet-list.test.ts` "passes ↓ through when the prompt has text"
- Key release ignored → `fleet-list.test.ts` "ignores key releases"
- Down stops at the last row → `fleet-list.test.ts` "↓ stops at the last row"
- Up above main leaves → `fleet-list.test.ts` "↑ on main deactivates and consumes"
- Other key leaves and passes through → `fleet-list.test.ts` "another key deactivates and passes through"
- Dialog keeps its keys → `fleet-list.test.ts` "leaves a focused selector's keys alone"
- Custom editor still works → `fleet-list.test.ts` "accepts a custom editor with getText and setText"
- No TUI yet → `fleet-list.test.ts` "passes keys through before the TUI is captured"
- Pane keeps its keys → `fleet-list.test.ts` "passes every key through while the pane is open"
- Enter opens the live pane → `fleet-list.test.ts` "Enter on an agent calls open with its navigation entry"; `session-navigator.test.ts` "openTranscript mounts a TranscriptPane on a live source"
- Released session opens from file → `fleet-list.test.ts` "Enter on an agent with only outputFile opens a snapshot entry"; `session-navigator.test.ts` "openTranscript renders the file's transcript for a snapshot entry"
- Unreadable file → `session-navigator.test.ts` "notifies \"Could not read the session transcript file.\" and mounts nothing when readFile throws"
- Command unchanged → existing `session-navigator.test.ts` `SessionNavigatorHandler` suite, unedited
- Selection kept after close → `fleet-list.test.ts` "reselects the viewed agent by id after close"
- Viewed agent gone → `fleet-list.test.ts` "keeps a valid selection when the viewed agent is gone"
- Default on → `settings.test.ts` "defaults fleetView to true"
- Toggle off applies now → `subagents-settings.test.ts` "lists Fleet view with on/off and flips it"; `fleet-wiring.test.ts` "settings_changed to off clears the widget"
- Invalid value ignored → `settings.test.ts` "drops a non-boolean fleetView"
- Shutdown releases everything → `fleet-list.test.ts` "dispose clears the widget, the timer and the listener"; `fleet-wiring.test.ts` "session_shutdown removes the listener"
- Reload keeps one listener → `fleet-list.test.ts` "replaces its input listener on a second setUICtx"; `fleet-wiring.test.ts` "one input listener after two session_start events"
- Print mode → `tests/host/fleet-print.test.ts` "print mode output is identical with fleetView on and off"
- No timer while idle → `fleet-list.test.ts` "stops the timer when idle"
- Session ready after the run started → `fleet-list.test.ts` "shows the row once the session becomes ready, without a run event"
- Notice entry → existing `tests/vendoring.test.ts` "NOTICE.md has an entry for the vendored package"
- Ported fleet list credited → `tests/vendoring.test.ts` "notice credits tintinweb for the fleet list"

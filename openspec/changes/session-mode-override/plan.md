# Session Mode Override Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Let the operator set a worker mode for one session (`/jev mode <m> session`), recorded in the session file, that wins over the saved mode only in that session.

**Architecture:** The pure resolver gains a `sessionMode` input. A pure reader in `src/jev/` takes the session mode from branch entries. A host holder, tagged with its session id, is rebuilt at `session_start`/`session_tree` and updated after a successful `pi.appendEntry`. `loadSnapshot` feeds the holder's value to the resolver, so its callers stay unchanged.

**Tech Stack:** TypeScript on Pi (`@earendil-works/pi-coding-agent` 1.5.0), Bun test, oxlint, oxfmt.

## Global Constraints

- Public Pi APIs only: `pi.appendEntry`, `ctx.sessionManager.getBranch()`, `ctx.sessionManager.getSessionId()`, `pi.on("session_start" | "session_tree")`.
- `src/policy/`, `src/store/` and `src/jev/` import no Pi and do no host I/O; `scripts/` still imports no `src/host/` or `src/store/`.
- Mode names are exactly `budget`, `standard`, `premium` (`MODES` / `MODE_NAMES`).
- The entry custom type is `jev-mode`, and its data is exactly `{"mode":"<m>"}` or `{"mode":null}`.
- Fixed copy: status `Jev · <m> (session)`; report `mode: <m> (session; saved <s>)`; `session mode <s> still applies here; saved mode is now <m>`; `no session mode set`; usage `/jev mode budget|standard|premium session` and `/jev mode session off`.
- The session mode never calls Jev and never reads or writes `state.json` or `config.json`.
- Tests need no secrets, no paid calls and no network beyond loopback.
- Repository text is in English.

## Review Focus

1. **Append succeeds, holder update throws, or the reverse.** The holder must change only after `appendEntry` returns. Test: "Append fails" in Task 4.
2. **A `/jev` run in session B right after a switch from A, before B's `session_start` handler runs.** The holder is tagged with A's id, so it must not apply. Test: `loadSnapshot ignores a holder of another session` in Task 3.
3. **Whitespace and case in the command** (`mode  premium   session`, `mode premium Session`). Split on whitespace and match case-sensitively. Tests in Task 4's parse step.
4. **A branch with a `jev-mode` entry whose data is `null`, a string, or `{mode: 1}`.** Skip it and read the next older entry. Test: `readSessionMode skips malformed data` in Task 2.
5. **`/jev all off` with a session mode set.** The status line shows `Jev · off`, and the report still shows the session mode. Test: "Base state wins over a session mode" in Task 5.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `resolveSettings` input | modified | `{ config: Config; state: State; tuning?: Tuning; sessionMode?: Mode }` | no |
| `Settings` | modified | adds `modeSource: "session" \| "saved"` and `savedMode: Mode`; `mode` stays the effective mode | no |
| `SESSION_MODE_TYPE` | new | `const SESSION_MODE_TYPE = "jev-mode"` in `src/jev/session-mode.ts` | no |
| `readSessionMode` | new | `(entries: readonly SessionEntryLike[]) => Mode \| undefined` in `src/jev/session-mode.ts` | no |
| `jev-mode` session entry | new | custom entry, `customType: "jev-mode"`, `data: { mode: Mode \| null }`, nothing else | public (session file format) |
| `SessionModeHolder` | new | `{ rebuild(sessionId: string, entries: readonly SessionEntryLike[]): void; set(sessionId: string, mode: Mode \| undefined): void; modeFor(sessionId: string \| undefined): Mode \| undefined }`, from `createSessionModeHolder()` in `src/host/session-mode.ts` | no |
| `sessionModes()` | new | process-wide `SessionModeHolder` on `globalThis` under `Symbol.for("pi-jev-pilot.sessionMode")` | no |
| `loadSnapshot` | modified | `(pi, sessionId?: string) => Snapshot`; it uses `sessionModes().modeFor(sessionId ?? currentMainSession())` | no |
| `buildSnapshot` input | modified | adds `sessionMode?: Mode` | no |
| `JevArgs` | modified | adds `{ kind: "session-mode"; mode: Mode \| undefined }` | no |
| `runJev` deps | modified | adds `appendEntry: (type: string, data: unknown) => void` and `sessionModes: SessionModeHolder` | no |
| `/jev mode <m> session`, `/jev mode session off` | new | CLI forms as in `specs/jev-command` and `specs/session-mode` | public |

`currentMainSession()` is the id of the newest main session that ran `session_start`. The holder stores it at `rebuild`, so `modeFor(undefined)` resolves against that id. Hot paths without a `ctx` stay correct, because the holder holds only one session at a time.

---

## Task 1: Resolver session layer — implements 1.1

**Files:**
- Modify: `src/store/settings.ts`
- Test: `tests/store/settings.test.ts`

**Interfaces:**
- Produces: `resolveSettings` input and `Settings` from Contracts.

- [ ] **Step 1: Write failing tests** in `describe("resolveSettings")`:
  - `Session mode over state`: state `{mode:"premium"}`, `sessionMode:"budget"` → `mode "budget"`, `modeSource "session"`, `savedMode "premium"`.
  - `Session mode over the default`: state `{}`, `sessionMode:"premium"` → `mode "premium"`, `modeSource "session"`, `savedMode "standard"`.
  - `Session mode changes only the mode`: state `{switches:{skills:false}}`. With and without `sessionMode:"premium"`, the results are equal after deleting `mode` and `modeSource`.
  - Extend `Everything defaulted` and `Mode from state` to expect `modeSource "saved"` and `savedMode` equal to `mode`.
- [ ] **Step 2:** Run `bun test tests/store/settings.test.ts`. Expected: FAIL on the missing `modeSource`.
- [ ] **Step 3:** Implement it. `savedMode = state.mode ?? DEFAULTS.mode`, `mode = sessionMode ?? savedMode`, `modeSource = sessionMode ? "session" : "saved"`.
- [ ] **Step 4:** Run `bun test tests/store/settings.test.ts && bun run typecheck`. Expected: PASS. Fix any test literal of `Settings` that the type check flags.
- [ ] **Step 5:** Commit `feat(settings-resolution): add a session mode layer`.

## Task 2: Session entry reader — implements 2.1

**Files:**
- Create: `src/jev/session-mode.ts`
- Test: `tests/jev/session-mode.test.ts`

**Interfaces:**
- Consumes: `SessionEntryLike` from `src/jev/branch.ts`, `MODE_NAMES` from `src/policy/modes.ts`.
- Produces: `SESSION_MODE_TYPE`, `readSessionMode`.

- [ ] **Step 1: Write failing tests:**
  - `Damaged entry skipped`: entries `[custom jev-mode {mode:"budget"}, custom jev-mode {mode:"ultra"}]` → `"budget"`.
  - `Clear is the newest`: `[{mode:"premium"}, {mode:null}]` → `undefined`.
  - `readSessionMode skips malformed data`: newest entries with data `null`, `"premium"`, `{mode:1}` and `{}` above `{mode:"premium"}` → `"premium"`.
  - `no entry` → `undefined`. `other custom types ignored`: `jev-turn` with `{mode:"budget"}` → `undefined`.
- [ ] **Step 2:** Run `bun test tests/jev/session-mode.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3:** Implement it. Scan from newest to oldest, look only at `type === "custom" && customType === SESSION_MODE_TYPE`, and return on the first valid entry (a mode name, or `null` → `undefined`).
- [ ] **Step 4:** Run `bun test tests/jev/session-mode.test.ts tests/boundaries.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(session-mode): read the session mode from the branch`.

## Task 3: Host holder and snapshot — implements 3.1, 3.2, 3.3

**Files:**
- Create: `src/host/session-mode.ts`
- Modify: `src/host/readiness.ts`, `src/host/setup.ts`
- Test: `tests/host/session-mode.test.ts`, `tests/host/setup.test.ts`, `tests/host/readiness.test.ts`

**Interfaces:**
- Consumes: `readSessionMode` (Task 2), the `resolveSettings` input (Task 1).
- Produces: `SessionModeHolder`, `createSessionModeHolder`, `sessionModes()`, `loadSnapshot(pi, sessionId?)`, `buildSnapshot({..., sessionMode})`.

- [ ] **Step 1: Write failing holder tests** in `tests/host/session-mode.test.ts`:
  - `rebuild then modeFor` returns the branch mode for that id, and `modeFor(undefined)` returns the same.
  - `Worker in a new session`: `rebuild("A", [premium])` then `rebuild("B", [])`, so `modeFor("A")` and `modeFor(undefined)` are both `undefined`.
  - `set` for a different id than the current one is ignored.
- [ ] **Step 2: Write failing snapshot tests** in `tests/host/readiness.test.ts`:
  - `buildSnapshot` with `sessionMode:"premium"` has `settings.mode "premium"` and `modeSource "session"`.
  - `loadSnapshot ignores a holder of another session`: the holder is rebuilt for `"A"` with premium, and `loadSnapshot(pi, "B")` gives the saved mode.
- [ ] **Step 3: Write failing setup tests** in `tests/host/setup.test.ts`, using `fakePi` with `getBranch`:
  - `session_start rebuilds the session mode`: the branch holds `jev-mode {mode:"budget"}`, `session_start` fires with each of `startup`, `reload`, `resume`, `fork`, `new`, and the widget reads `Jev · budget (session)`. Covers "Survives reload" at the fake-host level.
  - `Tree navigation before the entry`: after a start with `[premium]`, `getBranch` returns `[]` and `session_tree` fires. The widget is redrawn as `Jev · standard` and `/jev` reports `mode: standard`.
  - `Child start does not rebuild`: the holder is rebuilt for main with `budget`, then `session_start` fires for a child id whose `getBranch` is `[]`, and `modeFor(undefined)` stays `budget`.
  - The handler list now includes `session_tree`. Update the existing `subscribes to both child events` expectation.
- [ ] **Step 4:** Run `bun test tests/host/session-mode.test.ts tests/host/readiness.test.ts tests/host/setup.test.ts`. Expected: FAIL.
- [ ] **Step 5:** Implement it.
  - The holder lives in a `Symbol.for` slot on `globalThis`, like `tool-service.ts`.
  - `loadSnapshot` reads `sessionModes().modeFor(sessionId)`.
  - In `setup.ts`, the main `session_start` calls `sessionModes().rebuild(id, ctx.sessionManager.getBranch())` before `drawStatus`. A new `pi.on("session_tree")` (main only) rebuilds the holder and redraws, and errors are swallowed as in `session_start`.
- [ ] **Step 6:** Run the Step 4 tests plus `bun run typecheck`. Expected: PASS.
- [ ] **Step 7:** Commit `feat(session-mode): keep the session mode per main session`.

## Task 4: Command forms — implements 4.1, 4.2, 4.3, 4.4

**Files:**
- Modify: `src/host/commands.ts`, `src/host/setup.ts` (wire `appendEntry` and `sessionModes` into `runJev`)
- Test: `tests/host/commands.test.ts`

**Interfaces:**
- Consumes: `SESSION_MODE_TYPE` (Task 2), `SessionModeHolder` (Task 3).
- Produces: the `JevArgs` `session-mode` kind and the `runJev` deps from Contracts.

- [ ] **Step 1: Write failing parse tests** in `describe("parseJevArgs")`:
  - `mode premium session` → `{kind:"session-mode", mode:"premium"}`.
  - `mode session off` → `{kind:"session-mode", mode: undefined}`.
  - `  mode  budget   session ` → the budget form.
  - Usage for each of `mode premium Session`, `mode session`, `mode session on`, `mode premium session now`, `mode Session off`.
- [ ] **Step 2: Write failing usage test.** `usageText()` contains `/jev mode budget|standard|premium session` and `/jev mode session off` (extend "Usage lists the mode form").
- [ ] **Step 3: Write failing `describe("runJev session mode")` tests.** Use a fake `appendEntry` that records calls and a fresh holder rebuilt for `"main-1"`.
  - `Set a session mode`: with state mode `standard`, `mode premium session` appends exactly `["jev-mode", {mode:"premium"}]`, leaves the `state.json` bytes unchanged, reports `mode: premium (session; saved standard)`, and draws the widget `Jev · premium (session)`.
  - `Entry content`: `mode budget session` appends data deep-equal to `{mode:"budget"}`.
  - `Set while state is unreadable` (skip as root): with `state.json` at mode `0000`, the entry is appended and the report contains `mode: budget (session` and `state (`.
  - `Clear back to the saved mode`: holder set to premium, state budget, `mode session off` appends `{mode:null}`, the report contains `mode: budget` and no `(session`, and the widget reads `Jev · budget`.
  - `Nothing to clear`: one `info` note `no session mode set`, no append, no widget.
  - `Append fails`: `appendEntry` throws, so there is one `error` note, the handler resolves, and `modeFor("main-1")` is unchanged.
  - `Saving keeps the session mode`: holder budget, `mode premium` writes state `premium`, makes no append, and the report contains `mode: budget (session; saved premium)` and `session mode budget still applies here; saved mode is now premium`. The widget reads `Jev · budget (session)`.
  - `Reset clears the session mode`: holder premium, `reset` appends `{mode:null}`, the report shows `mode: standard`, and the widget reads `Jev · standard`.
  - `Refused reset keeps the session mode` (skip as root): with `state.json` at `0000`, there is an `EACCES` error, no append, and the holder is still premium.
  - `Command in a child`: the child id is in the registry, so there is no append, no note, and the holder is unchanged.
- [ ] **Step 4:** Run `bun test tests/host/commands.test.ts`. Expected: FAIL.
- [ ] **Step 5:** Implement it.
  - Parse inside the `head === "mode"` branch.
  - The `session-mode` path runs before `applyChange`. It never calls `updateState`. It appends, then calls `holder.set`, then loads the snapshot, draws and notifies.
  - `reset` calls `holder.set(id, undefined)` and appends the clear entry only after `resetState` returns ok and a session mode exists.
  - The `still applies here` line is added by `runJev` after a successful `mode` change while `modeSource === "session"`.
  - `setup.ts` passes `appendEntry: (t, d) => pi.appendEntry(t, d)` and `sessionModes()`.
- [ ] **Step 6:** Run `bun test tests/host/commands.test.ts && bun run typecheck`. Expected: PASS.
- [ ] **Step 7:** Commit `feat(jev-command): add session mode forms`.

## Task 5: Visible text — implements 5.1, 5.2

**Files:**
- Modify: `src/host/status.ts`, `src/host/commands.ts` (`formatStatus`)
- Test: `tests/host/status.test.ts`, `tests/host/commands.test.ts`

**Interfaces:**
- Consumes: `Settings.modeSource` and `savedMode` (Task 1).

- [ ] **Step 1: Write failing `statusText` tests** with `buildSnapshot({..., sessionMode})`:
  - `Session mode marked`: state `standard`, session `premium` → `Jev · premium (session)`.
  - `Session mode with a suffix`: session `budget`, decision level `high` → `Jev · budget (session) · high`.
  - `Session mode in the tally form`: session `premium`, overlay `10 prompts · 0 workers · 0 fallbacks` → `Jev · premium (session) · 10 prompts · 0 workers · 0 fallbacks`.
  - `Base state wins over a session mode`: all decision features off, session `premium` → `Jev · off`.
- [ ] **Step 2: Write failing `formatStatus` test.** `Session mode in the report`: state `standard`, session `premium`, a window of 120 entries. The output contains `mode: premium (session; saved standard)` and `mix (last 120, premium)` ending in `target 0/50/45/≤5`.
- [ ] **Step 3:** Run `bun test tests/host/status.test.ts tests/host/commands.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement it. In `statusText`, the first part becomes ``Jev · ${mode}${source === "session" ? " (session)" : ""}``. In `formatStatus`, the mode line uses the report copy from Global Constraints.
- [ ] **Step 5:** Run the Step 3 tests. Expected: PASS, and every existing status scenario stays green.
- [ ] **Step 6:** Commit `feat(status-line): mark a session mode`.

## Task 6: End-to-end host tests — implements 6.1

**Files:**
- Create: `tests/host/session-mode-e2e.test.ts`
- Test helpers used: `startHostSession`, `startFixture`, `startJevFixture` and the RPC `send`, as in `tests/host/effort-hold.test.ts` and `tests/host/worker-routing.test.ts`.

**Interfaces:**
- Consumes: everything above, through real Pi in RPC mode.

Real Pi RPC has `new_session`, `fork` and `--continue` (resume), but no command for `/reload` or `/tree`. Those two are covered at the fake-host level in Task 3, which is a stated limit.

- [ ] **Step 1: Write the RPC tests.** Each reads `/jev` through the `notify` UI request and the widget through `setWidget`.
  - `Survives resume`: persist session A, run `/jev mode premium session`, close, start B with `--continue` in the same dirs, and `/jev` contains `mode: premium (session; saved standard)` before any prompt.
  - `Fork carries the session mode`: set budget, send one prompt, then `fork` from that prompt's entry id (from `get_fork_messages`), and `/jev` reports `budget` as the session mode. The entry precedes the forked message.
  - `New session starts without one`: set premium, send `new_session`, and `/jev` contains `mode: standard` and no `(session`.
  - `Next launch uses the session mode`: with state `premium` and the session mode `budget`, one worker launch through the fixture executor (as in `worker-routing.test.ts`) writes a ledger `worker` line with `mode` `budget`.
  - `Other sessions keep the saved mode`: two RPC processes share an agent directory. A sets premium session, and `/jev` in B contains `mode: standard` with no `(session`.
- [ ] **Step 2:** Run `bun test tests/host/session-mode-e2e.test.ts`. Expected: PASS. A failure here is a defect in Tasks 3–5; fix it there with a failing unit test first.
- [ ] **Step 3:** Commit `test(session-mode): cover resume, fork, new session and routing end to end`.

## Task 7: Docs and full check — implements 7.1, 7.2

**Files:**
- Modify: `docs/usage-guide.md`, `README.md`, `docs/architecture.md`, `docs/glossary.md`

- [ ] **Step 1:** Update the docs.
  - `docs/usage-guide.md`: the two forms, the lifetime (resume, reload, fork, `/tree`), saving while a session mode is set, and reset.
  - `README.md`: one line under the mode commands.
  - `docs/architecture.md`: the settings line becomes `session (mode only) > tuning > state > config > default`, and `src/jev/session-mode.ts`, `src/host/session-mode.ts` and the `jev-mode` entry are added.
  - `docs/glossary.md`: a **Session mode** row.
- [ ] **Step 2:** Run `bun run typecheck && bun run lint && bun run fmt:check && bun test`. Expected: all pass.
- [ ] **Step 3:** Commit `docs(session-mode): document the session mode`.

---

## Scenario → test

**session-mode**
- Set a session mode → `tests/host/commands.test.ts` "Set a session mode"
- Next launch uses the session mode → `tests/host/session-mode-e2e.test.ts` "Next launch uses the session mode"
- Set while state is unreadable → `tests/host/commands.test.ts` "Set while state is unreadable"
- Other sessions keep the saved mode → `tests/host/session-mode-e2e.test.ts` "Other sessions keep the saved mode"
- Clear back to the saved mode → `tests/host/commands.test.ts` "Clear back to the saved mode"
- Nothing to clear → `tests/host/commands.test.ts` "Nothing to clear"
- Entry content → `tests/host/commands.test.ts` "Entry content"
- Append fails → `tests/host/commands.test.ts` "Append fails"
- Survives resume → `tests/host/session-mode-e2e.test.ts` "Survives resume"
- Survives reload → `tests/host/setup.test.ts` "session_start rebuilds the session mode" (reason `reload`; fake host, as RPC has no reload command)
- Fork carries the session mode → `tests/host/session-mode-e2e.test.ts` "Fork carries the session mode"
- Tree navigation before the entry → `tests/host/setup.test.ts` "Tree navigation before the entry" (fake host, as RPC has no tree command)
- New session starts without one → `tests/host/session-mode-e2e.test.ts` "New session starts without one"
- Damaged entry skipped → `tests/jev/session-mode.test.ts` "Damaged entry skipped"
- Clear is the newest → `tests/jev/session-mode.test.ts` "Clear is the newest"
- Worker in a new session → `tests/host/session-mode.test.ts` "Worker in a new session"
- Command in a child → `tests/host/commands.test.ts` "Command in a child"
- Child start does not rebuild → `tests/host/setup.test.ts` "Child start does not rebuild"

**settings-resolution**
- Everything defaulted, Config over default, Tuning over config, Forked launch from config, Switch off, CLI review default from state, Config review without state → existing tests in `tests/store/settings.test.ts`; "Everything defaulted" extended in Task 1
- Mode from state → `tests/store/settings.test.ts` "Mode from state" (extended)
- Session mode over state / over the default / changes only the mode → `tests/store/settings.test.ts`, same names

**jev-command**
- Session mode in the report → `tests/host/commands.test.ts` "Session mode in the report"
- Unknown mode, Usage lists the mode form → `tests/host/commands.test.ts` parse and usage tests (extended in Task 4)
- Reset clears the session mode, Refused reset keeps the session mode, Saving keeps the session mode → `tests/host/commands.test.ts`, same names
- Every other scenario of Status report, Usage text for other input, Reset and Mode → unchanged existing tests in `tests/host/commands.test.ts`

**status-line**
- Session mode marked, Session mode with a suffix, Session mode in the tally form, Base state wins over a session mode → `tests/host/status.test.ts`, same names
- Every other scenario of Status line text → unchanged existing tests in `tests/host/status.test.ts`, `tests/host/setup.test.ts` and `tests/host/main*.test.ts`

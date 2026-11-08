# Directory Mode Implementation Plan (iteration 2)

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** `/jev mode <m>` sets the mode for the current directory in `<cwd>/.pi/jev-mode.json`, `/jev mode <m> global` sets the global mode in `state.json`, and `/jev mode clear` removes the directory mode. The directory mode wins over the global mode in every Pi session in that directory.

**Architecture:** The pure resolver keeps one precedence function and gains a `localMode` input (renamed from iteration 1's `sessionMode`). A new store module reads, validates, writes and removes the directory file. `loadSnapshot` reads that file on every call, for the command's `ctx.cwd`, or for the cwd of the newest main `session_start` on paths without a `ctx`. The iteration 1 session-entry code is removed.

**Tech Stack:** TypeScript on Pi (`@earendil-works/pi-coding-agent` 1.5.0), Bun test, oxlint, oxfmt.

## Global Constraints

- Public Pi APIs only. `ctx.cwd` is the session's working directory.
- `src/policy/`, `src/store/` and `src/jev/` import no Pi. `src/store/` may do file I/O. `scripts/` imports no `src/host/` or `src/store/`.
- Mode names are exactly `budget`, `standard`, `premium` (`MODES`).
- The directory file is `<cwd>/.pi/jev-mode.json`, with content exactly `{"version":1,"mode":"<m>"}`. It is written with `writeFileAtomic`. No other project file is created or changed, and `.gitignore` is never touched.
- Fixed copy:
  - status: `Jev · <m> (local)`
  - report: `mode: <m> (this directory; global <g>)`
  - global note: `directory mode <d> still applies here; global mode is now <m>`
  - clear with nothing set: `no directory mode set`
  - problem labels: `local mode (malformed)`, `local mode (unreadable)`
  - usage: `/jev mode budget|standard|premium [global]` and `/jev mode clear`
- The directory mode never calls Jev and never writes `state.json` or `config.json`.
- Tests need no secrets, no paid calls and no network beyond loopback. Every test that writes a directory file uses a temp cwd.
- Repository text is in English.

## Review Focus

1. **A cwd whose `.pi` is a file, or is read-only.** The set is refused with the error code and `.pi/jev-mode.json`, and nothing else changes. Test: "Directory not writable" in Task 3.
2. **A command in a session whose cwd differs from the last main `session_start` cwd.** The command must use `ctx.cwd`, not the holder. Test: `/jev uses ctx.cwd over the main cwd holder` in Task 3.
3. **A file with extra keys, `version` 2, or `mode: null`.** All of these are malformed, and the global mode applies. Test: `readLocalMode rejects extra keys and other versions` in Task 2.
4. **`/jev mode clear` when the file exists but cannot be removed (`EACCES`).** Report the error and keep the mode. Test: `clear refused keeps the file` in Task 3.
5. **The symlinked temp dir on macOS (`/var` vs `/private/var`) in E2E.** Compare file contents, not paths. Covered by Task 5's use of `readFileSync(join(cwd, ".pi/jev-mode.json"))`.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `resolveSettings` input | modified | `{ config: Config; state: State; tuning?: Tuning; localMode?: Mode }` (was `sessionMode`) | no |
| `Settings` | modified | `modeSource: "local" \| "global"` and `globalMode: Mode` (were `"session" \| "saved"` and `savedMode`) | no |
| `LocalModeRead` | new | `{ kind: "missing" } \| { kind: "ok"; mode: Mode } \| { kind: "malformed" \| "unreadable"; issues: Issue[] }`, in `src/store/local-mode.ts` | no |
| `readLocalMode` | new | `(cwd: string) => LocalModeRead`, never throws | no |
| `writeLocalMode` | new | `(cwd: string, mode: Mode) => WriteResult`; failure issue message `cannot write .pi/jev-mode.json (<code>)` | no |
| `clearLocalMode` | new | `(cwd: string) => WriteResult`; a missing file is `{ ok: true }`; failure message `cannot remove .pi/jev-mode.json (<code>)` | no |
| `LOCAL_MODE_FILE` | new | `".pi/jev-mode.json"` | no |
| `.pi/jev-mode.json` | new | `{"version":1,"mode":"<m>"}` | public (file format) |
| `mainCwd()` / `setMainCwd(cwd)` | new | process-wide slot `Symbol.for("pi-jev-pilot.mainCwd")` in `src/host/main-cwd.ts`; `mainCwd(): string \| undefined` | no |
| `loadSnapshot` | modified | `(pi, cwd?: string) => Snapshot`; uses `readLocalMode(cwd ?? mainCwd() ?? process.cwd())` | no |
| `buildSnapshot` input / `Snapshot` | modified | input `localModeRead?: LocalModeRead` (replaces `sessionMode`); `Snapshot.localMode: { kind: LocalModeRead["kind"]; issues: Issue[] }` | no |
| `JevArgs` | modified | `{ kind: "mode"; mode: Mode; target: "local" \| "global" }` and `{ kind: "mode-clear" }`; `session-mode` removed | no |
| `runJev` deps | modified | `load: (cwd: string) => Snapshot`; `appendEntry` and `sessionModes` removed | no |
| `/jev mode <m>`, `/jev mode <m> global`, `/jev mode clear` | modified / new | CLI forms as in `specs/jev-command` and `specs/directory-mode`; `/jev mode <m> session` and `/jev mode session off` removed | public |
| removed | removed | `src/jev/session-mode.ts`, `src/host/session-mode.ts`, `jev-mode` session entry, `session_tree` handler | no |

---

## Task 8: Resolver directory layer — implements 8.1

**Files:**
- Modify: `src/store/settings.ts`, `src/host/readiness.ts` (pass-through rename only), `src/host/status.ts` and `src/host/commands.ts` (field rename only)
- Test: `tests/store/settings.test.ts`, plus field renames in `tests/host/status.test.ts`, `tests/host/commands.test.ts` and `tests/host/readiness.test.ts`

**Interfaces:**
- Produces: `resolveSettings` input and `Settings` from Contracts.

- [ ] **Step 1:** Rename the tests. They become `Directory mode over state` (state premium, local budget → `mode "budget"`, `modeSource "local"`, `globalMode "premium"`), `Directory mode over the default` and `Directory mode changes only the mode`. `Everything defaulted` and `Mode from state` now expect `modeSource "global"`.
- [ ] **Step 2:** Run `bun test tests/store/settings.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Rename `sessionMode`→`localMode`, `"session"`→`"local"`, `"saved"`→`"global"`, `savedMode`→`globalMode` in the resolver and every reader. Display strings stay unchanged here; Task 4 changes them.
- [ ] **Step 4:** Run `bun run typecheck && bun test tests/store tests/host/status.test.ts tests/host/commands.test.ts tests/host/readiness.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `refactor(settings-resolution): name the mode layer local and global`.

## Task 9: Directory mode store — implements 9.1

**Files:**
- Create: `src/store/local-mode.ts`
- Test: `tests/store/local-mode.test.ts`

**Interfaces:**
- Consumes: `writeFileAtomic` (`src/store/atomic.ts`), the validators in `src/store/validate.ts`, `MODES`.
- Produces: `LocalModeRead`, `readLocalMode`, `writeLocalMode`, `clearLocalMode`, `LOCAL_MODE_FILE`.

- [ ] **Step 1: Write failing tests** with a temp cwd:
  - `File content`: `writeLocalMode(cwd,"budget")` creates `.pi/` and the file parses to exactly `{version:1,mode:"budget"}`. `readLocalMode` returns `{kind:"ok",mode:"budget"}`.
  - `missing`: no file → `{kind:"missing"}`.
  - `Unknown mode name`: `{"version":1,"mode":"ultra"}` → `malformed`, with an issue at `mode`.
  - `readLocalMode rejects extra keys and other versions`: `{"version":2,"mode":"budget"}`, `{"version":1,"mode":"budget","x":1}` and `{"version":1,"mode":null}` → `malformed`. Invalid JSON → `malformed` at `(file)`.
  - `unreadable` (skip as root): file mode `0000` → `unreadable` naming `EACCES`.
  - `clearLocalMode` removes the file. On a missing file it returns ok. `No other project file touched`: a `.gitignore` in cwd is byte-identical after write and clear, and the cwd lists only `.gitignore` and `.pi`.
  - `Directory not writable` (skip as root): `.pi` exists as a regular file → `writeLocalMode` returns ok false, with a message that contains `.pi/jev-mode.json` and an error code.
- [ ] **Step 2:** Run `bun test tests/store/local-mode.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3:** Implement it, following `state-file.ts` (an `object` validator with `version` and `mode` `oneOf(MODES)` that rejects unknown keys, and `writeFileAtomic(join(cwd,".pi"),"jev-mode.json",...)`).
- [ ] **Step 4:** Run `bun test tests/store/local-mode.test.ts tests/boundaries.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(directory-mode): store the mode in .pi/jev-mode.json`.

## Task 10: Snapshot, cwd holder and removal — implements 9.2, 10.1

**Files:**
- Create: `src/host/main-cwd.ts`
- Modify: `src/host/readiness.ts`, `src/host/setup.ts`, `src/host/commands.ts` (drop the `ensure` call and the session-mode deps)
- Delete: `src/jev/session-mode.ts`, `src/host/session-mode.ts`, `tests/jev/session-mode.test.ts`, `tests/host/session-mode.test.ts`
- Test: `tests/host/readiness.test.ts`, `tests/host/setup.test.ts`, `tests/load.test.ts`

**Interfaces:**
- Consumes: `readLocalMode` (Task 9).
- Produces: `mainCwd`, `setMainCwd`, `loadSnapshot(pi, cwd?)`, `buildSnapshot({localModeRead})`, `Snapshot.localMode`.

- [ ] **Step 1: Write failing tests:**
  - `readiness`: `buildSnapshot({localModeRead:{kind:"ok",mode:"premium"}})` → `settings.mode "premium"`, `modeSource "local"`. With `{kind:"malformed",issues:[...]}` → `mode "standard"`, `modeSource "global"`, and `snapshot.localMode.kind "malformed"` with those issues.
  - `readiness`: `loadSnapshot(pi, cwdA)` reads A's file. `loadSnapshot(pi)` after `setMainCwd(cwdB)` reads B's file.
  - `setup`: main `session_start` with `ctx.cwd = A`, where A holds premium, draws `Jev · premium (session)` (Task 4 changes this string). `Child start in another directory`: a child `session_start` with cwd B leaves `mainCwd()` at A.
  - Remove `session_tree` from the handler lists in `tests/host/setup.test.ts` and `tests/load.test.ts`, and delete the tree and holder tests.
- [ ] **Step 2:** Run the files above. Expected: FAIL.
- [ ] **Step 3:** Implement `main-cwd.ts` (same slot pattern as `tool-service.ts`). In `setup.ts`, the main `session_start` calls `setMainCwd(ctx.cwd)` before `drawStatus`, the `session_tree` handler is removed, and `/jev` is wired as `load: (cwd) => loadSnapshot(pi, cwd)`. `readiness.ts` replaces the holder read with `readLocalMode`. Delete the session-mode modules and tests. `commands.ts` drops the `ensure` call and the `SessionModeDeps` type but keeps compiling: the session-mode forms are replaced in Task 11.
- [ ] **Step 4:** Run `bun run typecheck && bun test tests/host tests/load.test.ts tests/jev`. Expected: PASS, except command tests for the old `session` forms. Delete those in this task, since Task 11 adds the new ones.
- [ ] **Step 5:** Commit `refactor(directory-mode): read the mode from the directory, drop session entries`.

## Task 11: Command forms — implements 11.1, 11.2, 11.3, 11.4

**Files:**
- Modify: `src/host/commands.ts`
- Test: `tests/host/commands.test.ts`

**Interfaces:**
- Consumes: `writeLocalMode`, `clearLocalMode`, `readLocalMode` (Task 9), and `runJev` `load: (cwd) => Snapshot` (Task 10).
- Produces: the `JevArgs` from Contracts.

- [ ] **Step 1: Write failing parse and usage tests:**
  - `mode premium` → `{kind:"mode",mode:"premium",target:"local"}`.
  - `mode premium global` → target `global`.
  - `mode clear` → `{kind:"mode-clear"}`.
  - Each of these is usage: `mode`, `mode Premium`, `mode premium now`, `mode premium Global`, `mode global`, `mode clear now`, `mode Clear`, `mode premium session`.
  - `usageText()` contains `/jev mode budget|standard|premium [global]` and `/jev mode clear`.
- [ ] **Step 2: Write failing `describe("runJev directory mode")` tests** with `ctx.cwd` set to a temp dir:
  - `Set a directory mode`: state `standard`, then `mode premium`. The file holds premium, the state bytes are unchanged, the report contains `mode: premium (this directory; global standard)`, and the widget reads `Jev · premium (session)` (Task 12 changes this string).
  - `Set while state is unreadable` (skip as root).
  - `Directory not writable` (skip as root): `.pi` is a file. One `error` note contains `.pi/jev-mode.json`, and there is no widget.
  - `Clear back to the global mode`, `Nothing to clear` (one `info` note `no directory mode set`, no file created, no widget), and `Clear removes a damaged file`.
  - `clear refused keeps the file` (skip as root): with `.pi` at mode `0500`, there is an error and the file still holds the mode.
  - `Overwrite a damaged file`.
  - `Plain form targets the directory`, `Set premium` / `Mode survives a restart` / `Back to standard` / `Refused mode change` (now with `global`), and `Global set keeps the directory mode`. The latter writes state premium, leaves the file at budget, and adds the note line.
  - `Reset removes the directory mode`, and `Refused reset keeps the directory mode` (skip as root).
  - `Command in a child`: no file and no note.
  - `/jev uses ctx.cwd over the main cwd holder`: `setMainCwd(B)`, then a command with `ctx.cwd = A` writes A's file and reports A's mode.
- [ ] **Step 3:** Run `bun test tests/host/commands.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement it. The parse lives in the existing `mode` branch. The local set, clear and reset cleanup go in one small helper module or function, kept out of `runJev`'s body. Every snapshot is `deps.load(ctx.cwd)`. The global note is added only after a successful `global` set while `modeSource === "local"`.
- [ ] **Step 5:** Run `bun test tests/host/commands.test.ts && bun run typecheck`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(jev-command): target the directory with /jev mode`.

## Task 12: Visible text — implements 12.1

**Files:**
- Modify: `src/host/status.ts`, `src/host/commands.ts` (`formatStatus`)
- Test: `tests/host/status.test.ts`, `tests/host/commands.test.ts`, `tests/host/setup.test.ts`

- [ ] **Step 1: Update the failing expectations:**
  - `Directory mode marked` → `Jev · premium (local)`.
  - `Directory mode with a suffix` → `Jev · budget (local) · high`.
  - `Directory mode in the tally form` → `Jev · premium (local) · 10 prompts · 0 workers · 0 fallbacks`.
  - `Base state wins over a directory mode` → `Jev · off`.
  - `Directory mode in the report` (window of 120) → `mode: premium (this directory; global standard)` and `target 0/50/45/≤5`.
  - `Malformed directory mode reported` → `local mode (malformed)` at `(file)`.
  - Replace every `(session)` expectation from Tasks 10–11 with `(local)`.
- [ ] **Step 2:** Run those files. Expected: FAIL.
- [ ] **Step 3:** Change the marker and the report line, and add `problems.push(...issueLines(\`local mode (${s.localMode.kind})\`, s.localMode.issues))`.
- [ ] **Step 4:** Run the files again. Expected: PASS.
- [ ] **Step 5:** Commit `feat(status-line): mark a directory mode`.

## Task 13: End-to-end host tests — implements 13.1

**Files:**
- Replace: `tests/host/session-mode-e2e.test.ts` → `tests/host/directory-mode-e2e.test.ts`

Keep the iteration 1 helpers that still apply: `widgetShows`, the `/jev` notify reader, and the worker routing setup that asserts the child model `fixture-fast` and the ledger `tier: fast`, `answered: true`, `mode: budget`.

- [ ] **Step 1: Write the RPC tests:**
  - `New session uses it`: set premium in A and close it. B starts in the same cwd (no `--continue`). Its `/jev` report contains `mode: premium (this directory; global standard)`, and its widget reads `Jev · premium (local)`.
  - `Set before the first message`: a fresh session runs `/jev mode budget` with no prompt and closes. A new process in the same cwd reports `budget` for this directory.
  - `Other directory keeps the global mode`: A has premium. A process with the same agentDir but another cwd reports `mode: standard` with no `(this directory`, and its widget reads `Jev · standard`.
  - `Second process sees a change`: two processes share a cwd. One runs `/jev mode budget`, and the other's `/jev` then reports `budget` for this directory.
  - `Next launch uses the directory mode`: global premium, local budget, then one worker launch. The child model is `fixture-fast`, and the ledger line has `mode budget`, `tier fast` and `answered true`.
  - `No other project file touched`: `.gitignore` in cwd is unchanged after set and clear.
- [ ] **Step 2:** Run `bun test tests/host/directory-mode-e2e.test.ts`. Expected: PASS. A failure is a defect in Tasks 9–12; fix it there with a failing unit test first.
- [ ] **Step 3:** Commit `test(directory-mode): cover sessions, processes and routing end to end`.

## Task 14: Docs and full check — implements 14.1, 14.2

**Files:**
- Modify: `docs/usage-guide.md`, `README.md`, `docs/architecture.md`, `docs/glossary.md`

- [ ] **Step 1:** Rewrite the iteration 1 session-mode text.
  - `docs/usage-guide.md`:
    - the three forms, and that every session in the directory shares the mode
    - a **breaking change** note: `/jev mode <m>` now targets the directory, so use `global` for the old effect
    - the `git status` warning and `/jev mode clear`
    - the status line row `Jev · premium (local)`
    - the reset row
    - the command table
  - `README.md`: the mode block.
  - `docs/architecture.md`:
    - precedence `directory (mode only) > tuning > state > config > default`
    - add `store/local-mode.ts` and `host/main-cwd.ts`
    - remove both `session-mode.ts` lines
    - the data-flow line about `.pi/jev-mode.json`
  - `docs/glossary.md`: replace **Session mode** with **Directory mode**.
- [ ] **Step 2:** Run `grep -rn "session mode\|jev-mode entry\|/jev mode .* session" docs README.md`. Expected: no match.
- [ ] **Step 3:** Run `bun run typecheck && bun run lint && bun run fmt:check && bun test`. Expected: all pass.
- [ ] **Step 4:** Commit `docs(directory-mode): document the directory mode`.

---

## Scenario → test

**directory-mode**
- Set a directory mode → `tests/host/commands.test.ts` "Set a directory mode"
- Next launch uses the directory mode → `tests/host/directory-mode-e2e.test.ts` "Next launch uses the directory mode"
- Set while state is unreadable → `tests/host/commands.test.ts` "Set while state is unreadable"
- Directory not writable → `tests/store/local-mode.test.ts` and `tests/host/commands.test.ts` "Directory not writable"
- Clear back to the global mode → `tests/host/commands.test.ts` "Clear back to the global mode"
- Nothing to clear → `tests/host/commands.test.ts` "Nothing to clear"
- Clear removes a damaged file → `tests/host/commands.test.ts` "Clear removes a damaged file"
- File content → `tests/store/local-mode.test.ts` "File content"
- No other project file touched → `tests/store/local-mode.test.ts` and `tests/host/directory-mode-e2e.test.ts` "No other project file touched"
- New session uses it → `tests/host/directory-mode-e2e.test.ts` "New session uses it"
- Set before the first message → `tests/host/directory-mode-e2e.test.ts` "Set before the first message"
- Other directory keeps the global mode → `tests/host/directory-mode-e2e.test.ts` "Other directory keeps the global mode"
- Second process sees a change → `tests/host/directory-mode-e2e.test.ts` "Second process sees a change"
- Subdirectory is separate → `tests/host/readiness.test.ts` "Subdirectory is separate" (loadSnapshot on `<cwd>/sub`, added in Task 10)
- Unknown mode name → `tests/store/local-mode.test.ts` "Unknown mode name", plus the report in `tests/host/commands.test.ts`
- Overwrite a damaged file → `tests/host/commands.test.ts` "Overwrite a damaged file"
- Command in a child → `tests/host/commands.test.ts` "Command in a child"
- Child start in another directory → `tests/host/setup.test.ts` "Child start in another directory"

**settings-resolution**
- Directory mode over state / over the default / changes only the mode → `tests/store/settings.test.ts`, same names
- Every other scenario → existing tests in `tests/store/settings.test.ts`

**jev-command**
- Directory mode in the report, Malformed directory mode reported → `tests/host/commands.test.ts`, same names
- Unknown mode, Usage lists the mode form → parse and usage tests in `tests/host/commands.test.ts`
- Reset removes the directory mode, Refused reset keeps the directory mode, Partial reset reports a warning and redraws → `tests/host/commands.test.ts`, same names
- Set premium, Mode survives a restart, Back to standard, Refused mode change (now with `global`), Plain form targets the directory, Global set keeps the directory mode → `tests/host/commands.test.ts`, same names
- Every other scenario → unchanged existing tests in `tests/host/commands.test.ts`

**status-line**
- Directory mode marked, with a suffix, in the tally form, Base state wins over a directory mode → `tests/host/status.test.ts`, same names
- Every other scenario → unchanged existing tests

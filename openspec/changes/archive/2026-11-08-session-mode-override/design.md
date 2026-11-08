## Context

The effective mode comes from `resolveSettings` (`src/store/settings.ts`), a pure function of the config, `state.json` and the tuning layer. Every host path builds its settings through `loadSnapshot(pi)` (`src/host/readiness.ts`), which reads the files afresh on each call: worker classification, `/jev`, the status line, the tools gate, review, main effort and the verbose log. `loadSnapshot` takes no `ctx`, so today it cannot see the session's working directory.

Pi gives every handler and command `ctx.cwd`, the session's working directory. Session replacement (new, resume, fork) can enter a different cwd, and each replacement emits `session_start`. Pi's own per-project files live under `<cwd>/.pi/`.

The first apply iteration implemented a session-entry design: `src/jev/session-mode.ts` (reader of `jev-mode` entries), `src/host/session-mode.ts` (per-session holder rebuilt from the branch), a `session_tree` handler, `resolveSettings({sessionMode})` with `modeSource`/`savedMode`, the `(session)` marker, and the `/jev mode <m> session` forms. This design replaces the storage and the command surface and keeps the resolver and display seams.

Constraints: public Pi APIs only (ADR 0001); `policy/` and `store/` stay pure of Pi; `store/` may do file I/O; fail open; no prompt text stored; never write any project file other than `.pi/jev-mode.json`.

## Goals / Non-Goals

**Goals:**
- A directory mode that wins over the global mode for every reader of `settings.mode`, in every main session whose cwd is that directory.
- `/jev mode <m>` targets the directory; `/jev mode <m> global` targets `state.json`; `/jev mode clear` removes the directory mode.
- No change to the worker, cut-point, ledger or tally code paths beyond the mode they already receive.

**Non-Goals:**
- A directory layer for switches, the CLI review default, slots or the classifier settings.
- Resolving the directory to the git root or walking up to parent directories.
- Editing `.gitignore` or any other project file.
- Changing the shape of `state.json`, `config.json`, the ledger or any Jev request.

## Decisions

### D1. The resolver takes the directory mode as an input
`resolveSettings` takes an optional `localMode?: Mode` and returns `mode: localMode ?? state.mode ?? DEFAULTS.mode`, `modeSource: "local" | "global"` and `globalMode` (the mode without the directory layer). This renames the first iteration's `sessionMode`, `"session" | "saved"` and `savedMode`.
- Why: the precedence stays in one pure function (`settings-resolution` "One resolver for effective settings").
- Alternative: overriding `settings.mode` in the host after resolving. Rejected because it splits the precedence over two places.

### D2. A store module for the directory file
`src/store/local-mode.ts` owns `<cwd>/.pi/jev-mode.json`:
- `readLocalMode(cwd): LocalModeRead`, which is `{ kind: "missing" }`, `{ kind: "ok", mode }`, or `{ kind: "malformed" | "unreadable", issues }`. It never throws.
- `writeLocalMode(cwd, mode): WriteResult` writes `{"version":1,"mode":"<m>"}` through `writeFileAtomic` into `<cwd>/.pi/`, creating the directory when missing.
- `clearLocalMode(cwd): WriteResult` removes the file. A missing file is success.
- Content rule: an object with exactly `version` `1` and `mode`, a mode name. Anything else is malformed.
- Why: it follows the `state-file.ts` pattern (read, validate, atomic write, problems by field path). It is pure of Pi, so the store stays testable without a host.
- File mode: `writeFileAtomic` creates `0600` files and a `0700` directory. In `<cwd>/.pi/` an existing directory keeps its mode, because `mkdirSync` with `recursive` does not change it. The file holds no secret, so `0600` is fine.

### D3. `loadSnapshot` reads the file for the current main cwd
A small host holder, `src/host/main-cwd.ts`, records the cwd of the newest main `session_start`. It lives in a process-wide `Symbol.for("pi-jev-pilot.mainCwd")` slot, like `tool-service.ts`. `loadSnapshot(pi, cwd?)` reads `readLocalMode(cwd ?? mainCwd())` on every call, next to `readState`, and passes the mode as `localMode`. Commands pass `ctx.cwd` explicitly. Child `session_start` never changes the holder.
- Why: `loadSnapshot` runs on paths without `ctx`, such as the verbose log. Reading the file each time matches how `state.json` is read, so a change made in another process in the same directory shows on the next read with no cache to invalidate.
- Alternative: cache the mode in memory. Rejected because two Pi processes in one directory would disagree until restart.
- This replaces the session-mode holder, `readSessionMode`, the `session_tree` handler and the `ensure`/`rebuild` calls of the first iteration.

### D4. Command parsing
- `/jev mode <m>` parses to `{ kind: "mode", mode: m, target: "local" }`.
- `/jev mode <m> global` parses to `{ kind: "mode", mode: m, target: "global" }`.
- `/jev mode clear` parses to `{ kind: "mode-clear" }`.
- Every other form is usage, including `/jev mode`, `/jev mode Premium`, `/jev mode premium Global`, `/jev mode clear now`, `/jev mode global` and `/jev mode premium session`.

### D5. Running the forms
- **Local set:** `writeLocalMode(ctx.cwd, m)`. On failure, report the error with the file path and change nothing. On success, report the status and redraw. It never touches `state.json`.
- **Global set:** `updateState` as today. If the reloaded snapshot's `modeSource` is `local`, the report adds `directory mode <d> still applies here; global mode is now <m>`.
- **Clear:** when no file exists, report `no directory mode set` as info, write nothing and do not redraw. Otherwise call `clearLocalMode(ctx.cwd)`, then report and redraw.
- **Reset:** `resetState`. When it succeeds and a directory mode exists, also `clearLocalMode`. A refused reset leaves the file alone. When `resetState` succeeds but `clearLocalMode` fails, the command still reloads and redraws, and reports one `warning`, `global settings reset; directory mode not removed: <error>`, followed by the status. There is no rollback of `state.json`, because the two stores cannot be updated in one transaction.
- All forms are inert in a child session (already the case for `/jev`).

### D6. Malformed or unreadable file
`loadSnapshot` treats it as no directory mode, so the global mode applies (fail open). `/jev` lists it under problems as `local mode (malformed)` or `local mode (unreadable)`, with its field path, like the state problems. `/jev mode <m>` overwrites a malformed file. `/jev mode clear` and `/jev reset` remove it.

### D7. Visible text
- Status line: `Jev · <m> (local)` when the source is local, otherwise unchanged. The marker follows the mode in the base form and in the tally form, before any suffix.
- `/jev` report: `mode: <m> (this directory; global <g>)` when local, otherwise `mode: <m>`.
- Usage: `/jev mode budget|standard|premium [global]` and `/jev mode clear`.
- `(local)` is shorter than `(directory)` on a line the operator reads at a glance. The report spells it out.

### D8. Children and the ledger
Worker classification already records `settings.mode` on each launch and ledger line, so the ledger shows the effective mode, and the window, tally and tuning signals stay correct. Child sessions do nothing.

## Risks / Trade-offs

- [Breaking: `/jev mode <m>` no longer changes every directory] → The usage guide, README and the report wording make the change clear. Running `/jev mode <m> global` restores the old effect.
- [The file shows up in the user's `git status`] → Documented. The package never edits `.gitignore`. The operator can ignore the file or remove it with `/jev mode clear`.
- [cwd not writable, for example a read-only checkout] → The set is refused with the error code and file path, and nothing else changes. The global form still works.
- [A file read on every `loadSnapshot`] → One small file next to `state.json`, which is already read on each call. Missing is the common case and costs one failed `open`.
- [Two Pi processes in one directory] → Both read the file on every snapshot, so they agree from the next read. Writes are atomic.
- [Main cwd holder out of date after a cwd change Pi does not signal] → Every session replacement emits `session_start`, and commands use `ctx.cwd` directly. Only paths without a `ctx` use the holder.

## Migration Plan

A mode already saved in `state.json` keeps applying as the global mode; nothing is migrated. A directory without the file behaves as before. To roll back, remove the code: a leftover `.pi/jev-mode.json` is ignored by older versions, and the operator can delete it.

## Open Questions

None.

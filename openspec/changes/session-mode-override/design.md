## Context

The effective mode comes from `resolveSettings` (`src/store/settings.ts`), a pure function of the config, `state.json` and the tuning layer. Every host path builds its settings through `loadSnapshot(pi)` (`src/host/readiness.ts`), which reads the three files afresh on each call. It is used by worker classification, the `/jev` command, the status line, the tools gate, review and the verbose log. `loadSnapshot` takes no session context, so it cannot see the session branch today.

Pi gives extensions two public tools for session data: `pi.appendEntry(customType, data)` writes a custom entry that never reaches the model, and `ctx.sessionManager.getBranch()` returns the entries of the current branch. The package already uses this pair for `jev-turn` entries (`src/host/context.ts`). Pi emits `session_start` with a reason of `startup`, `reload`, `new`, `resume` or `fork`, and emits `session_tree` after `/tree` navigation.

Constraints: public Pi APIs only (ADR 0001); `policy/` and `store/` stay pure and free of Pi; fail open; no prompt text stored.

## Goals / Non-Goals

**Goals:**
- A session mode that wins over the saved mode for every reader of `settings.mode`, in its own session only.
- Restored from the branch, so resume, reload, fork and `/tree` behave as the branch says.
- No change to the worker, cut-point, ledger or tally code paths beyond the mode they already receive.

**Non-Goals:**
- A session layer for switches, the CLI review default, slots or the classifier settings.
- Changing `state.json`, `config.json`, the ledger schema or any Jev request.
- Mode for child sessions, which stay inert.

## Decisions

### D1. The resolver takes the session mode as an input
`resolveSettings` gains an optional `sessionMode?: Mode` input and returns `mode: sessionMode ?? state.mode ?? DEFAULTS.mode`. It also returns `modeSource: "session" | "saved"` and `savedMode` (the mode without the session layer), so the report and the status line need no second resolve.
- Why: the precedence stays in one pure function (`settings-resolution` "One resolver for effective settings").
- Alternative: overriding `settings.mode` in the host after resolving. Rejected because it splits the precedence over two places.

### D2. A host-side holder, rebuilt from the branch
A small host module (`src/host/session-mode.ts`) keeps the session mode in memory, tagged with the session id it belongs to:
- At main `session_start` (every reason) and at `session_tree`, it is rebuilt from `ctx.sessionManager.getBranch()` with a pure reader.
- `/jev mode <m> session` and `/jev mode session off` append the entry and then update the holder.
- `loadSnapshot(pi)` reads the holder and passes its value to the resolver only when it belongs to the current main session. The call sites do not change.
- Why: `loadSnapshot` is called on hot paths (every `tool_call` for subagents) with no `ctx`. Scanning the branch there would put session I/O on every call and widen ten signatures.
- Alternative: pass branch entries into `loadSnapshot`. Rejected for the cost and blast radius above.

### D3. Entry shape: `jev-mode` custom entry
`pi.appendEntry("jev-mode", { mode: "<m>" })` sets the session mode, and `pi.appendEntry("jev-mode", { mode: null })` clears it. A pure reader in `src/jev/` returns the `mode` of the newest valid `jev-mode` entry on the branch, or nothing when that entry is a clear or no entry exists. An entry with any other `mode` value is skipped and the next older one is read, so a damaged entry falls back to the saved mode (fail open).
- Why: append-only entries follow the session tree with no extra code. Fork copies the branch, `/tree` changes the branch, and resume replays the file.
- The entry holds only the mode name, never prompt text.
- The reader sits in `src/jev/` next to `branch.ts`, so the replay script could read it without importing `host/`.

### D4. Command parsing
`/jev mode <m> session` parses to `{ kind: "session-mode", mode: m }` and `/jev mode session off` to `{ kind: "session-mode", mode: undefined }`. Every other three-word form stays usage text. `session` is not a mode name, so `/jev mode session` alone stays usage.
- `/jev mode session off` with no session mode set is reported as info (`no session mode set`), writes no entry and changes nothing.
- `/jev mode <m> session` with `m` equal to the current session mode still appends an entry. That is harmless, and the operator gets a confirmation.
- Setting a session mode never touches `state.json`. Setting it works even when `state.json` is unreadable.

### D5. Saving while a session mode is set
`/jev mode <m>` writes `state.json` exactly as today. Because the resolver puts the session layer first, the effective mode stays on the session mode. The report then adds the line `session mode <s> still applies here; saved mode is now <m>`.

### D6. Reset
`/jev reset` resets `state.json` as today. Then, if a session mode is set, it appends a clear entry. When the state reset is refused, the session mode is left alone too, so a refused command changes nothing.

### D7. Visible text
- Status line: `Jev · <mode> (session)` when the source is the session, otherwise unchanged. The marker follows the mode in the base form and in the tally form, before any suffix. The other base forms (`config error`, `no key`, `off`) are unchanged.
- `/jev` report: `mode: <mode> (session; saved <saved>)` when a session mode is set, otherwise `mode: <mode>` as today. The mix line uses the effective mode, as today.
- Usage gains `/jev mode <m> session` and `/jev mode session off`.
- Alternative: a `*` marker. Rejected because it is too cryptic for a line the operator reads at a glance.

### D8. Children and the ledger
Worker classification already records `settings.mode` on the launch and in the ledger line, so the ledger shows the effective mode, and the window, tally and tuning signals stay correct. Child sessions do nothing: `/jev` is inert there, and the holder is never filled for a child id.

## Risks / Trade-offs

- [Holder out of date after a branch change Pi does not signal] → The holder is rebuilt at every `session_start` and `session_tree`, which cover the documented branch changes (new, resume, fork, reload, tree). A missed rebuild can only show the previous session mode until the next event, and the holder is tagged with its session id, so it never leaks into a different session.
- [The session mode is unknown to other Pi processes] → Intended. `/jev` in another session reports its own saved mode.
- [`appendEntry` throws] → It is caught like every command failure. The holder is updated only after a successful append, so the in-memory value never claims a mode the file lacks.
- [Ledger lines from one day now mix modes from different sessions] → Already possible today, since the mode is recorded per launch. The cut-point window does not filter by mode.

## Migration Plan

Additive. Sessions without a `jev-mode` entry behave exactly as before. To roll back, remove the code: the `jev-mode` entries stay in session files as inert custom entries that older versions ignore.

## Open Questions

None.

## Context

Current state, as of `d0a74a8`:

- **Tuning code.** `src/policy/tuning.ts` exports `stepTuning`, `undoTuning`, `resetTuning` and `setTuningOff`. `src/policy/tuning-window.ts` exports the helpers `decisions`, `after`, `counts` and `p90`. `src/store/tuning-file.ts` exports `readTuning` and `updateTuning`. Nothing in `host/` imports any of them.
- **Snapshot.** `src/host/readiness.ts` `buildSnapshot` calls `resolveSettings({ config, state })`, with no tuning. Every reader of `classifier.timeoutMs` (`main.ts:246`, `worker.ts:346`, `tools.ts:131`) goes through `loadSnapshot`.
- **Settle handler.** `src/host/setup.ts` registers `agent_settled`, skips child sessions and awaits `main.agentSettled(event)`, which writes the main ledger line synchronously through `deps.append`.
- **Ledger.** `readLedger` returns the latest 2000 valid lines, oldest first. A seam test already asserts that `LedgerEntry` is assignable to the policy's `DecisionLine`.
- **Command.** `/jev` parsing lives in `src/host/commands.ts`. Slot forms are delegated to `src/host/slots.ts`, which returns an outcome that `runJev` turns into one notification.

Constraints: `policy/` imports only itself and `shared/`, and `store/` must not import `policy/`. No Pi import is allowed outside `host/`. No new handler may be added (spec `package-loading`), and no Jev call.

## Goals / Non-Goals

**Goals:**
- One host module owns tuning's side effects: reading, stepping, writing, notifying and the command.
- Pure, table-testable signals.
- A tuned value reaches every reader of `classifier.timeoutMs`, with no change at the call sites.

**Non-Goals:**
- Changing the tuning rules.
- Locking across processes: the policy's "last writer wins" stands.
- Acting on signals.

## Decisions

**D1. Module split.**

| Module | Responsibility | Imports |
|---|---|---|
| `src/policy/tuning-signals.ts` | Pure: per-mode windows and the four signal counts | policy only |
| `src/host/tuning-text.ts` | Pure text: change lines, session-start line, `/jev tune` report, subcommand messages, and the shared `issueLines` problem formatter | policy, store types |
| `src/host/tuning-deps.ts` | Types only: `UiCtx`, `TuningDeps` | store and readiness types |
| `src/host/tuning-step.ts` | `settleTuning(deps, ctx)`: skip rules, two-pass step, `seenAt`, change lines | store, policy, text |
| `src/host/tuning-seen.ts` | `showUnseenTuning(deps, ctx)`: the session-start line and its `seenAt` write | store, policy, text |
| `src/host/tune-command.ts` | `runTune(deps, sub, ctx)` and `buildTuneView`: the report and the four subcommands | store, policy, text |

`setup.ts` builds a fresh `TuningDeps` for each call (so the jev directory is resolved per call, as for the ledger) and calls the three entry points; there is no combined object. `commands.ts` adds a `tune` parse result and delegates it to `runTune`, the way it delegates slot forms. `commands.ts` imports `issueLines` from `tuning-text.ts`; the tune modules never import `commands.ts`, so there is no cycle. Alternatives considered:
- Putting the text in `policy/`: rejected, because wording is a host concern.
- One `createTuning` returning all three: rejected under the coding standards, since it would own three responsibilities and one dependency bag for all of them.

**D2. Dependencies are injected.** All three entry points take the same `TuningDeps`:
- `dir`, `now`;
- `load`, which returns the snapshot: config validity, the untuned `timeoutMs`, and the tuning read (kind, issues, record);
- `updateTuning`, `readLedger`.

`setup.ts` passes the real functions, and unit tests use fakes. Child sessions are filtered in `setup.ts` (and `runJev`), as for every other handler, so the modules take no `isChild`. The snapshot is the only read of `tuning.json` before `updateTuning`, which reads it again for the atomic update.

**D3. Snapshot.** `buildSnapshot` takes an optional `tuningRead` (default: missing) and returns:
- `settings`, resolved with `tuning: tuningRead.record` only when the config is valid;
- `tuning: { kind, issues, record }`;
- `untunedTimeoutMs`, from a new exported pure `untunedTimeout(config)` in `settings.ts`, which `resolveSettings` also uses.

`loadSnapshot` adds `readTuning(dir)`. The resolver's contract is unchanged, so `settings-resolution` is not modified. With an invalid config, the snapshot resolves from `{}` and passes no tuning layer, so `untunedTimeoutMs` and `classifier.timeoutMs` are both the default. That is why D5 skips tuning when the config is invalid. Test fixtures that build `Snapshot` literals (`tests/host/worker-fakes.ts`, `tests/host/tools.test.ts`) switch to `buildSnapshot`, so later fields do not break them.

**D4. The step at settle.** `setup.ts` calls `settleTuning(deps, ctx)` after `main.agentSettled(event)` returns, inside its own `try`, in the same non-child branch. The main line is already written then, since `write` is synchronous. Each step below stops the check when its condition holds:
1. It is a child session.
2. The config is invalid.
3. `readTuning` is `unreadable`.
4. `readLedger` is `unreadable`.

Otherwise the check runs in this order:
5. Run `stepTuning` on the read record. With no events, stop: nothing is written.
6. Otherwise call `updateTuning(dir, r => …)`. The mutate function runs `stepTuning` again on the freshly read record, with the same lines and `now`, and captures the events of that run. Recomputing inside the mutate keeps the write consistent with what is on disk at write time.
7. With `ctx.hasUI` and at least one visible event (`applied`, `reverted` or `superseded`), the mutate also sets `seenAt = now`. If the notification then throws, that one line is lost. The change stays in the history and in `/jev tune`. This loss is accepted: writing `seenAt` in a second update after the notify would double the writes on every change.
8. After a successful write, each visible event shows one info notification. When the write is refused, nothing is shown, so a line never announces a change that was not stored.

Every error is caught and swallowed, as for the ledger. A `kept` event writes (it clears `pending`) but shows nothing.

**D5. Why skip on an invalid config.** The untuned value would then be the code default, not the operator's value. A step could then supersede a tuned value that was correct, or tune from the wrong base. The status line already shows `config error`, and tuning resumes once the config is fixed.

**D6. `seenAt`.** It is an optional integer `at` (same range as other `at` values), added to `TuningDocument` and `TuningRecord`. The pure transitions spread the record, so they keep it. A history entry is unseen when its `at` is greater than `seenAt`, or when `seenAt` is absent.
- **Session start.** This runs in the main session with `ctx.hasUI`.
  1. Read the tuning file. Stop if the read is not `ok` or has no unseen entry.
  2. `updateTuning` with `seenAt` set to the latest unseen `at`.
  3. Only after that write succeeds, show one line built from the unseen entries: the `from` of the first, the `to` of the last, and their count.

  Writing first means a refused write never repeats the line every session.
- **Subcommands.** With `ctx.hasUI`, `undo` and `reset` set `seenAt = now` in their own update, since the operator just acted on it and is shown the result. Without a UI they leave it, which matches the settle rule. `on`, `off` and the plain report never touch `seenAt`.

`seenAt` never moves backwards: every update keeps the larger of the stored and the new value. `seenAt = now` from `undo` or `reset` also marks as seen any earlier unseen entry. Such entries can only come from a concurrent process without a UI, so this is accepted.

This refines brainstorm call 8 ("after a `/jev tune` subcommand") with the same UI condition as settle, after spec review.

**D7. Texts** (`tuning-text.ts`; exact strings are in the specs):
- **Applied:** `Jev tune: timeoutMs 1500→1700 · /jev tune undo`
- **Reverted:** `Jev tune: timeoutMs 1700→1500, reverted: timeouts did not improve · /jev tune`
- **Superseded:** `Jev tune: timeoutMs 1700→2000, your config value replaces the tuned one`
- **Session start:** `Jev tune since your last session: timeoutMs 1500→1900 (2 changes) · /jev tune`

`→` is U+2192, as in the docs.

**D8. `/jev tune` report.** The report has these lines, in order:
1. `tuning: on|off`
2. `timeoutMs: <effective> (tuned from <base>)`, or `timeoutMs: <untuned> (not tuned)`
3. When pending: `pending: <from>→<to>, <n>/40 decisions since`
4. When a block is active: `block: raises to <value> or above held back for <k> more decisions`
5. `history:` with the latest 5 entries, newest first, as `<ISO minute UTC> <cause> <from>→<to>`, or `history: none`
6. `signals (observed, not applied; latest 200 decisions per mode):`, then one line per mode that has decisions

The decision counts use `decisions` and `after` from `tuning-window.ts`. Further rules:
- The pending count is capped at 40, since it can grow past 40 while tuning is off.
- While the config is invalid, a `tuning paused: config error` line follows the `timeoutMs` line.
- When the ledger is unreadable, the report says `ledger unreadable` instead of the pending, block and signal lines.
- Problems in `tuning.json` come last under `problems:`, in the `/jev` format.

**D9. Subcommands.**

| Form | Calls | Message |
|---|---|---|
| `undo` | `undoTuning` | `Jev tune: timeoutMs 1700→1500 undone. The same raise is held back for 200 decisions.`, or `Jev tune: nothing to undo.` |
| `reset` | `resetTuning(record, untuned, now)` | `Jev tune: back to your settings (timeoutMs 1500).` |
| `off` | `setTuningOff(true)` | `Jev tune: off. A tuned value stays until /jev tune undo or reset.` |
| `on` | `setTuningOff(false)` | `Jev tune: on.` |

Preconditions for `undo` and `reset`:
- Both are refused with an error while the config is invalid, since the base cannot be trusted then.
- `undo` with a tuned value whose base no longer equals the untuned value reports "nothing to undo". That value does not apply, and the next settle supersedes it.
- `reset` writes nothing when the record has no tuned value, pending change or block.

- **Output.** Each goes through `updateTuning` and notifies once. A refused write shows only the problem, as an error.
- **Parsing.** `/jev tune` takes nothing or exactly one of the four words. Anything else is usage text.

**D10. Signals.**
- **Input.** `SignalLine` is a policy type with `kind`, `at`, `mode`, `turnId`, `tier`, `effort`, `effective`, `status`, `toolCalls`, `failures` and `outcome`, all optional except `kind` and `at`. A seam test asserts that `LedgerEntry` is assignable to it.
- **Window.** For each mode, the window is the latest 200 decisions of that mode (`main` and `worker` lines with that `mode`), ordered by `at`. Ties are broken by the line's JSON with sorted keys, so lines that differ only in signal fields still sort the same way. The tuning rules' tie-break key does not include signal fields.
- **The four signals**, each as `{ count, of }`:

  | Signal | count | of |
  |---|---|---|
  | `lowWorkerErrors` | low workers with `status: error` | worker lines with `tier: fast` or `effort` ∈ {off, minimal, low} |
  | `corrected` | main lines whose `turnId` appears on any `correction` line in the input | main lines |
  | `largeAtLow` | main lines with `toolCalls ≥ 15` | main lines with `effective` ∈ {off, minimal, low} and `toolCalls` set |
  | `highSmall` | main lines with `toolCalls ≤ 2`, `failures` equal to 0 (an absent value is not counted) and `outcome` `ok` | main lines with `effective: high` and `toolCalls` set |

- **Shown as** `<name> <count>/<of>`. A mode with no decisions is left out. With no decisions at all, the report says `signals: no decisions yet`.

## Risks / Trade-offs

- [The ledger is read on every settle, up to 2000 lines] → It is a small local read, bounded by the reader. The step stops early, without writing, when nothing changes.
- [Two processes settle at once] → Each recomputes inside its own update, and the last writer wins. Both see ledgers of the same age, so their results agree in practice (policy D8).
- [Change lines are only toasts] → Missed lines are replayed at the next session start through `seenAt`, and `/jev tune` shows the history.
- [`seenAt` written at session start races a settle in another process] → The worst case is one duplicated or skipped summary line. Nothing is lost from the history.
- [Host test timing for the tuned timeout] → The test uses a hanging Jev route and asserts that the ledger `ms` is at least the tuned value minus 50 and below the next step (`+200`). `ms` is rounded wall time from the client's `setTimeout`, so it can read a little early. It never asserts an exact time.
- [Print mode exits right after the run] → The settle handler is awaited before Pi exits, as the ledger already relies on. The host test still polls for `tuning.json`.
- [A clock set earlier than a history entry] → That entry stays unseen until the clock passes it. This is cosmetic: one repeated session-start line.

## Migration Plan

None. `tuning.json` may not exist, and a file without `seenAt` reads as "nothing seen", so the first interactive session shows any earlier changes once. Rollback is a revert of the commit.

## Open Questions

None.

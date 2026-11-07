## Design Summary

**Intent.** ADR 0005 wants tuning that applies itself within limits, so the operator has nothing to remember. `wg-18-tuning-policy` (#42) built the pure rules (`stepTuning`, `undoTuning`, `resetTuning`, `setTuningOff`) and the `tuning.json` store, but nothing calls them: a tuned `timeoutMs` never takes effect, and `/jev tune` prints usage text. This change does the host side and finishes WG-18.

**What the operator gets.**

- **Tuning that runs on its own.** After each main-session run settles, the package checks the tuning rules once against the ledger and stores any change in `tuning.json`.
- **A tuned value that takes effect.** Every place that reads `classifier.timeoutMs` (the main decision, worker routing and tool assessment) uses the tuned value while its base still matches the config.
- **One line on every change**, as an info notification: `Jev tune: timeoutMs 1500→1700 · /jev tune undo`. A revert and a config edit that replaces a tuned value each get their own line. A change that is kept after its evaluation window shows no line.
- **One line at session start** when tuning changed something the operator has not been shown yet, for example because it happened in a run with no UI.
- **`/jev tune`** reports the tuned value and its base, whether tuning is on, the pending change and its progress, the active block, the recent history, and the observed signals per mode.
- **`/jev tune undo | reset | on | off`** call the matching pure transition, write `tuning.json` and report the result.
- **Signals per mode, shown and never applied.** Each signal is counted over the latest 200 decisions of that mode and shown as `count/denominator`:
  - workers routed to `fast` or a low effort that ended in `error`;
  - main turns marked by a correction line;
  - large turns (at least 15 tool calls) at a low effective effort;
  - main turns at `high` that finished in at most two tool calls, with no failures and outcome `ok`.

**Goals.** Complete WG-18's "Done when": a host test fires a change, and the tuned value reaches the next Jev request's timeout. Undo, reset and off work through the command. `config.json` and `state.json` stay untouched.

**Non-goals.** Automatic changes to anything but `timeoutMs`. Any action taken on the signals. A question at idle. Cross-process locking. Any new Jev call: tuning only reads earlier outcomes from the ledger.

**Anti-goals.** Tuning must never slow down or break a turn: any failure is swallowed, the same way ledger failures are. It must never repeat a line the operator has already seen, and never show a line in print or JSON mode.

## Alternatives Considered

### Alternative A: Step inside `main.agentSettled`
- **Approach**: Extend the main-session controller in `src/host/main.ts` to run the tuning step after it writes the ledger line.
- **Pros**: The ordering is obvious: the line is written, then tuning runs.
- **Cons**: `main.ts` is already 748 lines and owns the effort decision. Tuning is a separate responsibility, with its own store, command and session-start behaviour. Its tests would need the whole main controller.
- **Why not chosen**: It piles a second responsibility onto a module that is already large, which the coding standards treat as a finding.

### Alternative B: Step on a timer, or only at session start
- **Approach**: Check the rules periodically, or once per session.
- **Pros**: The run-end path does no work.
- **Cons**: A timer contradicts "checked at `agent_settled`, never during a turn" (docs/domain-model.md). Checking only at session start delays a change for a whole session, and the line would appear long after its cause.
- **Why not chosen**: It conflicts with the documented rule.

### Alternative C: A separate host tuning module, called from the `agent_settled` handler (chosen)
- **Approach**: A new `src/host/tuning.ts` owns the step at settle, the line, the session-start line, the signals and the `/jev tune` subcommands. `setup.ts` calls it after `main.agentSettled` returns, and `commands.ts` delegates `tune` forms to it, the way slot forms go to `slots.ts`.
- **Pros**: One responsibility per module, testable with fake stores and a fake UI. It follows the existing `slots.ts` and `tally.ts` pattern.
- **Cons**: One more module, plus a small read of the ledger on each settle.
- **Why chosen**: See below.

## Agreed Approach

Alternative C. It keeps `main.ts` focused on the effort decision, follows the shape the host already uses for slots, and keeps the only cost, one ledger read per settle, inside the existing 2000-line bound.

## Key Decisions

Operator decisions (2026-11-07, Inbox thread `wg-18-tuning-host`):

1. The change line is shown with `ctx.ui.notify` (info). It is not added to the session file.
2. "Changed since the last session" is tracked with a new optional `seenAt` timestamp in `tuning.json`.
3. Signals are counted over the latest 200 decisions of each mode.
4. The four signal definitions are as listed in the Design Summary, with these details:
   - The worker signal counts `status: error` only: `aborted` and `stopped` come from the operator. A low effort is `off`, `minimal` or `low`.
   - The correction signal takes its mode from the corrected main line.
   - The `high` signal counts main turns only.
5. A `kept` evaluation shows no line. It appears in `/jev tune` only.

My calls, open to correction at this gate:

6. Tuning runs after the main run's own ledger line is written, so the run that just settled is counted. Worker sessions never run it.
7. Tuning does not run while `config.json` is invalid, since the untuned value would then be the default rather than what the operator wrote. It also does not run when `tuning.json` is unreadable.
8. `seenAt` moves forward whenever a line was shown: at settle, at session start, and after a `/jev tune` subcommand, since the operator made that change. Without a UI, nothing is shown and `seenAt` stays put, so the next interactive session shows the line.
9. The session-start line summarises every unseen change in one line. It gives the value before the first unseen change, the current value and the number of changes, and points to `/jev tune`.
10. `/jev tune on` exists. It is the inverse of `off`, which ADR 0005 implies but the usage guide did not list.

## Open Questions

None.

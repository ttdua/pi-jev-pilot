## Context

brainstorm.md records the probed behaviour and the agreed approach. This document covers how to build it inside the vendored executor.

Building blocks already in the code:
- `Subagent.claim()` returns a `CarrierClaim` on the current run. While any claim is held, `NotificationSystem.sendCompletion` and `sendUpdate` stay silent (`record.claimed`). Updates the run still owes stay in the run's ledger (`runUpdates`).
- `Subagent.waitUntilSettled(signal)` awaits the record's run promise. The promise is captured at spawn, so the wait also covers queue time. The method returns the run the wait began on, even when a resume replaced that run.
- `get_subagent_result` with `wait: true` already follows the pattern this change needs: claim, wait, then on settle mark the run consumed, or on interrupt release the claim.
- `SubagentEventsObserver` emits the record events. `launchFields(record)` adds `toolCallId` and `metadata`.

## Goals / Non-Goals

**Goals:**
- A caller can wait for one launch and read its terminal outcome or question, with no main-model nudge while it waits.
- Observers can see a child's question when it is asked (`subagents:asked`).
- `subagents:update` gets the same launch fields as the other record events.

**Non-Goals:**
- No new status, no change to `pendingQuestion`, no early resolve (brainstorm.md).
- No change to tool-call routing or to `get_subagent_result`.
- No change to `waitForAll()`.

## Decisions

### D1. `wait()` is a carrier, the same way `get_subagent_result` with `wait` is

`SubagentsServiceAdapter.wait(id, options)`:
1. Look up the record. An unknown id returns `Promise.reject(new Error(\`Unknown agent "${id}"\`))`.
2. If the current run has already settled, resolve with the snapshot at once and mark the run consumed. The signal is not checked, so a settled outcome wins over an aborted signal, as in `get_subagent_result`.
3. Otherwise `record.claim()`, then `await record.waitForRunEnd(signal ?? neverAborts)` (D5).
4. If the returned run has settled, mark it consumed and resolve with its snapshot (D2). Keep the claim: the run is over, and a resume starts a new, unclaimed run.
5. If the run is still active, the signal aborted: release this call's claim and reject with `signal.reason`. That reason is an `AbortError` `DOMException` when the caller called `abort()` with no argument, the same convention `fetch` uses.

Reason: one mechanism suppresses the nudge and the update messages, so a waited service launch behaves like a waited tool-call launch. Concurrent waits each hold their own claim; releasing one does not unclaim the run while another carrier, of any kind, still holds it. The adapter needs `claim` and `waitForRunEnd`, so `SubagentManagerLike.getRecord` returns `Subagent`.

`wait()` accepts any record id, including a tool-call launch's. Waiting on such a record holds its outcome exactly as a `get_subagent_result` wait does. Refusing would add an origin check with no consumer asking for it.

Rejected alternative: subscribing to `subagents:completed` inside the adapter. That would add a second completion path, and it does nothing about the nudge.

### D2. The snapshot is of the waited run, not of whatever run is current later

`waitUntilSettled` may return a run that a resume has already replaced, for example when a consumer resumes from the `subagents:completed` listener during `complete()`. In that case `toSubagentRecord(record)` would describe the new run. `wait()` therefore builds the snapshot with `toSubagentRecord(record)` and overlays the per-run fields of the run it waited for: `status`, `result`, `error`, `startedAt`, `completedAt`, `turnBudget` and `pendingQuestion`.

When the run was replaced, the overlay sets `pendingQuestion` to the question that run ended with, so the caller can see what was answered. This needs a `RunOutcome.question` field that ignores `replaced`, because the existing `pendingQuestion` getter returns `undefined` for a replaced run. `resumeRefusal` stays the live value, so it says whether a further resume is possible.

### D3. `subagents:asked` comes from the ask recorder, through the observer chain

The `askParent` callback in `Subagent.run()` records the question and then calls `execution.observer?.onQuestionAsked?.(this, question)`. The manager relays this as `SubagentManagerObserver.onSubagentQuestion?`, which the composite observer dispatches like `onSubagentUpdate`. `SubagentEventsObserver.onSubagentQuestion` emits `subagents:asked` with `{ id, type, description, question, ...launchFields(record) }`. The event is not persisted and sends no notification: the completion nudge already renders the question when no carrier holds the run.

The event fires for every launch that has `ask_parent`, including tool-call launches. It is an observation and changes no routing.

### D4. `subagents:update` gets `launchFields`

The payload becomes `{ ...identityOf(record), message, ...launchFields(record) }`. That one helper also adds `toolCallId`, so `executor-launch-identity` changes too, keeping all record events consistent.

### D5. Wait for the run's terminal funnel, not for the scheduler promise

`waitUntilSettled` awaits `record.promise`, which for a queued launch is the limiter's promise. `stopQueued()` makes the run terminal at once, but that promise only settles when a slot frees and the guarded thunk no-ops. A waiter on a launch stopped while queued would therefore hang until another run ends.

`SubagentRun` gains a `finished: Promise<void>` and a `markFinished()` that resolves it. `Subagent` calls `run.markFinished()` in every terminal funnel, right after it calls `observer.onRunFinished`: `complete`, `fail`, `endBeforeStart` and `stopQueued`. Each funnel marks the run it captured before the callback (`stopQueued` captures `const run = this.currentRun` first), because a synchronous terminal listener may resume the agent and replace `currentRun`. `manager.abortAll()` stops queued runs through `stopQueued` before `limiter.clear()`. `limiter.clear()` alone is not a terminal funnel. `Subagent.waitForRunEnd(signal)` captures `currentRun`, races `run.finished` against the signal, and returns the run, mirroring `waitUntilSettled`. A running run that `abort(id)` stops still ends through `complete` once its turn loop returns, so its result text is present, as today.

The resolution is a microtask after the funnel. The observer's synchronous `subagents:completed` listeners and `sendCompletion` therefore run while the claim is still held, unless a listener resumes the agent synchronously. In that case `sendCompletion` reads the new, unclaimed run, as it already does today for `get_subagent_result` waiters. This change leaves that path alone (see Risks). `waitUntilSettled` and `get_subagent_result` are not changed; their queued-stop behaviour is out of scope.

### D6. Public constants

`SUBAGENT_EVENTS` gains `UPDATE: "subagents:update"` and `ASKED: "subagents:asked"`. `update` is already emitted but was never declared, the same gap phase 18 closed for `steered`.

## Risks / Trade-offs

- [The caller sees the question one turn later than an early resolve would show it] → this is the child's final turn. `subagents:asked` gives the moment of asking to observers that want it.
- [A caller waits and then never answers] → as today, a run with an unanswered question stays on the long retention window (`resolveRetentionWindow`), so a later `resume()` still works until that window ends.
- [A caller relies on the waited run's updates, which are not announced to the main session while it waits] → they are emitted on `subagents:update`. If the wait is aborted, the owed updates ride on the completion nudge (`buildPointerLines` renders `runUpdates`), as without a wait.
- [Leaking a claim if `wait()` throws between claim and await] → claim and await sit in one `try`. Any exit other than a settled outcome releases the claim.
- [A `subagents:completed` listener resumes the agent synchronously while a `wait()` is pending] → the waiter still gets the old run's snapshot (D2). The notification system then reads the replaced record: it may withhold or emit a nudge about the resumed run, which nobody waits on. This is today's behaviour for every carrier, and it stays out of scope because fixing it means reordering the shared observer (emit vs persist/notify). The spec names the resume's own rules as the ones that apply.
- [Vendored-tree drift] → every edited upstream file gets a `VENDORED.md` row. The vendoring test enforces this.

## Migration Plan

Additive. No data migration and no setting. Rollback means reverting the change.

## Open Questions

None.

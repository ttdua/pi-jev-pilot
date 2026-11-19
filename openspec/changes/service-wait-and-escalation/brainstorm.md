## Design Summary

An extension that launches a child with `SubagentsService.spawn()` must be able to wait for that one child, read its outcome or its question, and answer the question itself, without the main model being told and without stitching events back to an id. The first consumer is pi-livespec (ttdua/pi-livespec#7): a tool builds a unit packet, spawns, waits and parses the result, so the main model never copies a long packet and cannot pick the wrong agent type.

### Current behaviour (probed)

A throwaway host probe (real Pi RPC session, recording fixture, `executor-only` install) ran a service launch with metadata `{ change: "c1" }` whose child called `notify_parent`, then `ask_parent`, then ended its turn; the probe then answered with `resume(id, answer)`. Foreground and background launches behaved identically:

| Step | Observed |
|---|---|
| `notify_parent` | `subagents:update` emitted with `id, type, description, message`, **without `metadata`**; a `subagent-update` message was sent to the main session, which triggered a main-model turn |
| `ask_parent` | the child did not block; the question was recorded and the child ended its turn |
| run end | `subagents:completed` emitted (with `metadata`, without the question); `getRecord(id)` read `status: "completed"`, `pendingQuestion` set, no `resumeRefusal` |
| after the run | a `subagent-notification` nudge reached the main session and triggered a main-model turn inviting it to answer by resuming |
| `resume(id, answer)` | resolved `resumed` / `completed`; `subagents:resuming` and `subagents:resumed` carried `metadata`; `pendingQuestion` cleared; a second nudge reached the main session |

So the child never waits forever; the problem is routing. The question and updates go to the main model, a foreground service launch is nudged like a background one, and the caller can only find the question by polling `getRecord`. The record already has the mechanism that silences nudges: a carrier claim, which `subagent` foreground calls and `get_subagent_result` with `wait` take.

Fork launches do not get `ask_parent` or `notify_parent` (`subagent-context-mode`, "A fork SHALL declare exactly the parent's tools"); this change does not alter that.

### What the change does

- `SubagentsService.wait(id, { signal? })` returns the terminal snapshot of the record's current run: completed, aborted, stopped or error. A record already settled resolves at once; an unknown id rejects at once.
- While a `wait()` is pending, the run's outcome belongs to the caller: no completion nudge and no update message reaches the main session. If the signal aborts, the wait rejects, the run continues, and the main session is told exactly as it would have been without the wait.
- A child's question reaches the caller in the settled snapshot (`status: "completed"`, `pendingQuestion`). The caller answers with `resume(id, answer)`, then calls `wait(id)` again for the resumed run.
- `subagents:asked` is emitted when a child calls `ask_parent`, with `id`, `type`, `description`, `metadata` (when the launch has it) and the question, for observers that do not wait.
- `subagents:update` gains `metadata` when the launch has it, as the other record events already do.

### Relation to living specs

- `launch-metadata`, "Metadata on record events and snapshots": lists the record events that carry `metadata`. This change **alters** that requirement by adding `subagents:update` and the new `subagents:asked` to the list.
- `host-seam-evidence`: the probe above becomes a pinned host test with an evidence entry, following "Answers are pinned by host tests" and "Evidence report". This adds a requirement; existing ones are unchanged.
- `subagent-context-mode` (fork tool set) and `builtin-role-agents` (bodies name `ask_parent`) are untouched.

## Alternatives Considered

### Alternative A: Claiming `wait()` plus additive events (chosen)
- **Approach**: `wait()` claims the current run's outcome and resolves at settle; `ask_parent` already ends the run, so the settled snapshot carries the question. Add `subagents:asked`; add `metadata` to `subagents:update`.
- **Pros**: no breaking change to `SubagentRecord` or `SubagentStatus`; reuses the claim mechanism foreground calls already use; the snapshot `wait()` returns is immediately resumable.
- **Cons**: the caller sees the question at settle, not at the moment it is asked (the gap is the child's final turn).

### Alternative B: The issue's original proposal (`waiting` status, early resolve)
- **Approach**: a new `waiting` status, `pendingQuestion: { text, askedAt }`, `wait()` resolving when `ask_parent` is called, `subagents:notified` for updates.
- **Pros**: the caller hears the question one turn earlier.
- **Cons**: breaking for `SubagentStatus` and `pendingQuestion` consumers; at that moment the run is still going, so `resume()` is refused `still-running` and the caller needs a second wait; `subagents:notified` duplicates `subagents:update`.
- **Why not chosen**: the probe shows the child already settles right after asking, so the early resolve adds complexity and a breaking change for no gain.

### Alternative C: Events only, no `wait()`
- **Approach**: add `subagents:asked` and metadata on `subagents:update`; callers keep correlating events by id.
- **Pros**: smallest change.
- **Cons**: keeps exactly the stitching the issue wants removed, and does nothing about the main model racing the caller to answer.
- **Why not chosen**: does not solve the routing problem.

## Agreed Approach

Alternative A, chosen by the user. While a caller waits, the outcome, the question and the updates go to the caller only; the main model is not nudged (user decision). Without a pending wait, behaviour stays as today, including for tool-call launches.

## Key Decisions

- Only the caller is told while a `wait()` is pending; the main model is not nudged in parallel (user decision).
- `wait()` resolves at the run's terminal transition, never mid-run; a question is read from the settled snapshot (user decision, Alternative A).
- No new status and no change to the `pendingQuestion` type: all additions are additive.
- No `subagents:notified` channel; the existing `subagents:update` is extended instead.
- An aborted wait signal rejects the wait and does not stop the run (from the issue).
- An unknown id rejects at once (from the issue).
- Tool-call launches keep today's `ask_parent` routing (from the issue).

## Open Questions

None blocking. Builder calls, to be settled in design: the rejection error shape for an unknown id and for an aborted signal; whether several concurrent `wait()` calls on one record are allowed (proposal: yes, each holds its own claim); the exact `subagents:asked` payload field name for the question.

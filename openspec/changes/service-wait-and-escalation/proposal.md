## Why

An extension that launches a child with `SubagentsService.spawn()` cannot wait for that one child. `waitForAll()` waits for runs it does not own, and events must be matched to ids by hand. A host probe showed that a service child's `ask_parent` question and its `notify_parent` updates go to the main model as nudges, so the main model and the launching extension race to answer. pi-livespec (ttdua/pi-livespec#7) needs to spawn, wait, read the result or question and answer it from inside its own tool.

## What Changes

**Per-launch wait**
- From: a caller can poll `getRecord(id)`, wait for every run with `waitForAll()`, or match `subagents:completed` / `subagents:failed` to an id.
- To: `SubagentsService.wait(id, { signal? })` returns the terminal snapshot of the record's current run: `completed`, `aborted`, `stopped` or `error`. A record that has already settled resolves at once. An unknown id rejects at once. An aborted signal rejects the wait and does not stop the run.
- Impact: additive service method.

**Routing while a caller waits**
- From: a service launch's completion nudge and its `notify_parent` update messages always reach the main session, which triggers main-model turns.
- To: while a `wait()` is pending, neither reaches the main session; the caller owns the outcome. An aborted wait gives the outcome back, and the main session is then told as it would have been without the wait.
- Impact: non-breaking. Nothing changes for callers that do not wait, or for tool-call launches.

**Questions reach the caller**
- From: a question is visible only through `getRecord(id).pendingQuestion` or the main model's nudge.
- To: `wait()` resolves at the run's end with `status: "completed"` and `pendingQuestion`. The caller answers with `resume(id, answer)` and calls `wait(id)` again. A new `subagents:asked` event carries `id`, `type`, `description`, `question` and the launch fields (`toolCallId`, `metadata`) when the child calls `ask_parent`.
- Impact: additive. No new status, and `pendingQuestion` stays a string.

**Update event fields**
- From: `subagents:update` carries `id`, `type`, `description` and `message`.
- To: it also carries `toolCallId` and `metadata` under the same rules as the other record events.
- Impact: additive.

**Out of scope**
- A `waiting` status and an early resolve while the child is still running (rejected in brainstorm.md).
- A `subagents:notified` channel, which would duplicate `subagents:update`.
- Fork launches, which get neither `ask_parent` nor `notify_parent`.
- jev-pilot's routing of service launches.

## Capabilities

### New Capabilities
- `service-launch-wait`: `SubagentsService.wait()`; routing of a waited launch's outcome, question and updates to the caller only; the `subagents:asked` event.

### Modified Capabilities
- `launch-metadata`: "Metadata on record events and snapshots" adds `subagents:update` and `subagents:asked` to the events that carry `metadata`.
- `executor-launch-identity`: "Record events carry the tool call id" adds `subagents:update` and `subagents:asked`.
- `host-seam-evidence`: adds "Service launch escalation host evidence", which pins how `ask_parent` and `notify_parent` behave in a service launch, with and without `wait()`.

## Impact

- **Vendored executor (`packages/pi-subagents/`):**
  - `src/service/service.ts` and `src/service/service-adapter.ts`
  - `src/lifecycle/subagent.ts` and `src/lifecycle/subagent-manager.ts`
  - `src/observation/subagent-events-observer.ts` and `src/observation/composite-subagent-observer.ts`
  - tests
- **Records:** `VENDORED.md` rows for edited upstream files. `dist/public.d.ts` is regenerated, and `verify:public-types` must pass.
- **Host tests:** a new probe extension under `tests/host/probes/` and a new host test.
- **Docs:**
  - `packages/pi-subagents/README.md`: the `spawn` contract, a `wait` contract and the Events table;
  - `docs/evidence/2026-11-05-host-seams.md`: a new section;
  - `docs/decisions/0009-vendored-executor.md`: the seam list;
  - `docs/testing.md`: the host test list.
- **jev-pilot `src/`:** no change.

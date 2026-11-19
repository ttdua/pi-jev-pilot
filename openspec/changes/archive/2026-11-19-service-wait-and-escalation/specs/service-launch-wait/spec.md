## ADDED Requirements

### Requirement: Wait for one launch
`SubagentsService.wait(id, options?)` SHALL return a promise of the `SubagentRecord` snapshot for the record's current run once that run reaches a terminal status (`completed`, `aborted`, `stopped` or `error`). A run still queued SHALL be waited for through its queue time and its run. If the current run has already settled, the promise SHALL resolve without waiting.

#### Scenario: Background launch completes
- **WHEN** an extension spawns a background launch, calls `wait(id)` and the child answers `done`
- **THEN** the promise resolves with `status` `completed` and `result` `done`

#### Scenario: Queued launch
- **WHEN** `wait(id)` is called while the launch is still waiting for a concurrency slot, and the launch later runs and completes
- **THEN** the promise resolves only after the run completes, with `status` `completed`

#### Scenario: Foreground service launch
- **WHEN** an extension spawns with `foreground: true` and calls `wait(id)`
- **THEN** the promise resolves with the terminal snapshot once the run ends

#### Scenario: Already settled
- **WHEN** `wait(id)` is called after the run has completed
- **THEN** the promise resolves with the completed snapshot without waiting

#### Scenario: Failure
- **WHEN** the child's run ends in an error while a `wait(id)` is pending
- **THEN** the promise resolves, not rejects, with `status` `error` and the error message

#### Scenario: Stopped
- **WHEN** the caller calls `abort(id)` while a `wait(id)` is pending
- **THEN** the promise resolves with `status` `stopped`

#### Scenario: Stopped while queued behind a busy slot
- **WHEN** `wait(id)` is pending on a queued launch, another run holds the only concurrency slot and keeps running, and the caller calls `abort(id)`
- **THEN** the promise resolves with `status` `stopped` before the other run ends

#### Scenario: Queued resume stopped
- **WHEN** `wait(id)` is pending on a resume still waiting for a concurrency slot, and the caller calls `abort(id)`
- **THEN** the promise resolves with `status` `stopped`

### Requirement: Snapshot of the waited run
The per-run fields of the snapshot `wait()` resolves with (`status`, `result`, `error`, `startedAt`, `completedAt`, `turnBudget` and `pendingQuestion`) SHALL describe the run the wait began on, even when a resume has replaced that run before the promise resolves. Every other field, including `resumeRefusal`, SHALL describe the record when the promise resolves.

#### Scenario: Resumed before the waiter reads it
- **WHEN** an observer resumes the agent from its `subagents:completed` listener while a `wait(id)` for the initial run is pending, and that run ended with question `Q`
- **THEN** the promise resolves with `status` `completed`, the initial run's result, `startedAt` and `completedAt`, `pendingQuestion` `Q`, and `resumeRefusal` `still-running`

### Requirement: Wait refusals
`wait()` MUST reject without waiting when `id` names no record. When `options.signal` aborts before the run settles, `wait()` MUST reject with the signal's reason and MUST NOT stop, abort or otherwise change the run. When the run has already settled, an aborted signal MUST NOT prevent the promise from resolving with the outcome.

#### Scenario: Unknown id
- **WHEN** `wait("missing")` is called
- **THEN** the promise rejects with an error naming `missing`

#### Scenario: Signal aborts the wait
- **WHEN** a caller's signal aborts while the child is running
- **THEN** the promise rejects with the signal's reason, the record still reads `running`, and the child's run later completes

#### Scenario: Signal already aborted on a settled run
- **WHEN** `wait(id, { signal })` is called with an already-aborted signal on a completed run
- **THEN** the promise resolves with the completed snapshot

### Requirement: Waited outcome belongs to the caller
While at least one `wait()` on a record is pending, the executor MUST NOT send the main session a completion notification for the waited run, nor an update message for a `notify_parent` call made during that run. A `wait()` that resolves with a settled outcome SHALL mark that run's outcome collected. A run no `wait()` holds MUST keep its current notifications, whatever its origin.

#### Scenario: No nudge while waited
- **WHEN** a background service launch completes while a `wait(id)` is pending
- **THEN** the main session receives no `subagent-notification` message for it

#### Scenario: No update message while waited
- **WHEN** the child calls `notify_parent` while a `wait(id)` is pending
- **THEN** `subagents:update` is emitted, and the main session receives no `subagent-update` message

#### Scenario: Unwaited service launch unchanged
- **WHEN** a background service launch completes and no caller ever called `wait(id)`
- **THEN** the main session receives the completion notification, as it does without this capability

### Requirement: Aborted wait gives the outcome back
A `wait()` that rejects because its signal aborted SHALL release only its own hold on the run. The main session SHALL then be notified exactly as it would be without that wait: not while any other carrier (another `wait()`, a `get_subagent_result` wait, a foreground `subagent` call or a `resume` with `claimOutcome`) still holds the run, and not once the outcome is collected. Updates that were not delivered during the wait SHALL stay owed and SHALL be rendered on the outcome's notification.

#### Scenario: Aborted wait with no other waiter
- **WHEN** a caller's wait signal aborts, and the run later completes with no other waiter
- **THEN** the main session receives the completion notification, and it renders any update the child sent during the wait

#### Scenario: Concurrent waiters
- **WHEN** two `wait(id)` calls are pending, the first one's signal aborts, and the run then completes
- **THEN** the second promise resolves with the outcome and the main session receives no completion notification

#### Scenario: Another carrier still holds the run
- **WHEN** a service `wait(id)` aborts while a `get_subagent_result` call with `wait: true` on the same id is pending, and the run then completes
- **THEN** the main session receives no completion notification, and the tool call returns the outcome

### Requirement: Questions reach the waiting caller
When a waited child calls `ask_parent` and its run then completes normally, the pending `wait()` SHALL resolve with `status` `completed` and the question in `pendingQuestion`, with no `resumeRefusal` while no resume has replaced the run. A `resume(id, answer)` SHALL continue the child with its context, and a `wait(id)` called before the resumed run settles SHALL wait for and hold the resumed run. Other outcomes MUST keep the existing question rules, as the scenarios show.

#### Scenario: Ask, answer, continue
- **WHEN** a waited child calls `ask_parent` with `Which config?` and ends its turn, the caller calls `resume(id, "The project one.")` and, without awaiting it, calls `wait(id)` again
- **THEN** the first wait resolves with `pendingQuestion` `Which config?` and no `resumeRefusal`; the second resolves with the resumed run's result and no `pendingQuestion`; the main session receives no completion notification for either run

#### Scenario: Question at the turn limit
- **WHEN** a waited child calls `ask_parent` with `Q` and its run is ended at its turn limit
- **THEN** the wait resolves with `status` `aborted` and `pendingQuestion` `Q`

#### Scenario: Failure after a question
- **WHEN** a waited child calls `ask_parent` and its run then fails
- **THEN** the wait resolves with `status` `error` and no `pendingQuestion`, and `subagents:asked` was emitted once

### Requirement: Question event
When a child calls `ask_parent`, the executor SHALL emit `subagents:asked` with `id`, `type`, `description` and `question` (the question text, as recorded), plus `toolCallId` and `metadata` under the same rules as the other record events. The event SHALL be emitted for every launch that has `ask_parent`, whether or not a caller waits. It MUST NOT be persisted and MUST NOT send the main session a message.

#### Scenario: Service launch with metadata asks
- **WHEN** a service launch with metadata `{ change: "c1" }` calls `ask_parent` with `Which config?`
- **THEN** `subagents:asked` is emitted with the record's `id`, `question` `Which config?` and `metadata` `{ change: "c1" }`, before the run's `subagents:completed`

#### Scenario: Tool-call launch asks
- **WHEN** a child launched by `subagent` call `call_5` calls `ask_parent`
- **THEN** `subagents:asked` carries `toolCallId` `call_5`, and the main session's routing of the question is unchanged

### Requirement: Event channel constants
`SUBAGENT_EVENTS` SHALL include `UPDATE` with value `subagents:update` and `ASKED` with value `subagents:asked`, and every existing constant MUST keep its value.

#### Scenario: Constants declared
- **WHEN** a consumer reads `SUBAGENT_EVENTS`
- **THEN** `UPDATE` is `subagents:update`, `ASKED` is `subagents:asked`, and `COMPLETED` is still `subagents:completed`

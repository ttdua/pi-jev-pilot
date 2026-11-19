## ADDED Requirements

### Requirement: Service launch escalation host evidence
Host tests SHALL show, through real Pi sessions against the recording fixture, how a service launch's `notify_parent` and `ask_parent` reach the main session and the launching extension, with and without a pending `wait()`, in foreground and background. The child is scripted to call `notify_parent`, then `ask_parent`, then end its turn. The evidence report SHALL record the answers in a section of its own, with the test, testing level and tested versions.

#### Scenario: Unwaited service launch escalates to the main session
- **WHEN** a service launch with metadata runs the scripted child and no caller waits, in foreground and in background
- **THEN** `subagents:update` and `subagents:asked` carry the launch's metadata, the main session receives one `subagent-update` and one `subagent-notification` message, and `getRecord(id)` reads `completed` with `pendingQuestion` and no `resumeRefusal`

#### Scenario: Waited service launch escalates to the caller only
- **WHEN** the same child runs while a probe extension's `wait(id)` is pending, in foreground and in background
- **THEN** the main session receives no `subagent-update` and no `subagent-notification` message, the probe records `subagents:asked` with the launch's metadata, and the wait resolves with `status` `completed` and the question

#### Scenario: Caller answers
- **WHEN** the probe calls `resume(id, answer)` and, without awaiting it, `wait(id)`
- **THEN** the child's next provider request contains the answer, the second wait resolves with the child's final text, and the main session receives no `subagent-notification` message for the resumed run

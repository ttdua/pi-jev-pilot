# child-registry Specification

## Purpose
A process-wide registry of child session ids, fed by the executor's child events, lets every extension instance tell a worker's child session from the main session.

## Requirements

### Requirement: Child sessions are recorded from the executor
The extension SHALL subscribe to `subagents:child:session-created` on `pi.events` and record the event's `sessionId` in a registry kept on `globalThis` under a `Symbol.for` key, so every extension instance in the process sees the same registry. It SHALL remove the id on `subagents:child:disposed`. Either event without a string `sessionId` MUST be ignored. Each extension instance SHALL unsubscribe its handlers on `session_shutdown`, so a reload does not leave stale handlers.

#### Scenario: Child recorded before its session starts
- **WHEN** the executor starts a child session
- **THEN** the registry holds the child's session id before the child's `session_start` handler runs

#### Scenario: Shared across instances
- **WHEN** one extension instance records a child id
- **THEN** another extension instance in the same process reports that id as a child

#### Scenario: Disposed child removed
- **WHEN** `subagents:child:disposed` arrives for a recorded id
- **THEN** the registry no longer holds that id

#### Scenario: Bad payload ignored
- **WHEN** `subagents:child:session-created` or `subagents:child:disposed` arrives without a string `sessionId`
- **THEN** the registry is unchanged and no error is thrown

#### Scenario: Unsubscribed on shutdown
- **WHEN** an extension instance has subscribed and its session shuts down
- **THEN** a later `subagents:child:session-created` event is not recorded by that instance's handler

### Requirement: Child check
`isChild(sessionId)` SHALL return true exactly when the registry holds that id. Without the executor, nothing is a child.

#### Scenario: Main session
- **WHEN** the main session's id is checked
- **THEN** `isChild` returns false

#### Scenario: Recorded child
- **WHEN** a recorded child id is checked
- **THEN** `isChild` returns true

#### Scenario: Subscribing twice
- **WHEN** two extension instances subscribe and one child is created
- **THEN** the registry holds the id once and `isChild` returns true

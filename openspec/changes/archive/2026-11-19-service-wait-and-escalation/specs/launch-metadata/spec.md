## MODIFIED Requirements

### Requirement: Metadata on record events and snapshots
`subagents:created`, `subagents:started`, `subagents:completed`, `subagents:failed`, `subagents:resuming`, `subagents:resumed`, `subagents:update` and `subagents:asked` SHALL carry `metadata` when the record's launch has metadata, and the `SubagentRecord` snapshot SHALL carry it from the moment `spawn()` returns, including while the record is queued. A resume, from the service or from a `subagent` tool call, SHALL carry the launch's metadata on its events. Events and snapshots MUST omit the field when the launch has none.

#### Scenario: Queued record
- **WHEN** a background launch with metadata is still queued
- **THEN** `getRecord(id).metadata` is the launch's metadata

#### Scenario: Every record event of a launch with metadata
- **WHEN** a background launch with metadata `{ change: "c1" }` is created, starts and completes, and is then resumed by `resume()` and completes again
- **THEN** `subagents:created`, `subagents:started`, `subagents:completed`, `subagents:resuming` and `subagents:resumed` each carry `metadata` `{ change: "c1" }`

#### Scenario: Failure
- **WHEN** a launch with metadata `{ change: "c1" }` fails
- **THEN** `subagents:failed` carries `metadata` `{ change: "c1" }`

#### Scenario: Record events without metadata
- **WHEN** a service launch without metadata is created, starts and completes
- **THEN** none of its record events has a `metadata` field

#### Scenario: Tool-call resume of a service launch
- **WHEN** the main model resumes, with `subagent` call `call_4`, an agent launched by `spawn()` with metadata `{ change: "c1" }`
- **THEN** `subagents:resuming` and `subagents:resumed` carry `toolCallId` `call_4` and `metadata` `{ change: "c1" }`

#### Scenario: Update and question of a launch with metadata
- **WHEN** a background launch with metadata `{ change: "c1" }` calls `notify_parent` and then `ask_parent`
- **THEN** `subagents:update` and `subagents:asked` each carry `metadata` `{ change: "c1" }`

#### Scenario: Update without metadata
- **WHEN** a launch without metadata calls `notify_parent`
- **THEN** `subagents:update` has no `metadata` field

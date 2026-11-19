## ADDED Requirements

### Requirement: Launch metadata on service launches
`SpawnOptions` SHALL accept an optional `metadata`, a map from string keys to string values chosen by the caller. The executor SHALL check its shape and limits and MUST NOT otherwise read, interpret or change it. An empty map SHALL count as no metadata. A `subagent` tool-call launch MUST carry no metadata, and `ResumeOptions` MUST NOT accept metadata.

#### Scenario: Metadata accepted
- **WHEN** an extension calls `spawn("implementer", "task", { metadata: { change: "c1", "lane.root": "/w/c1" } })`
- **THEN** `spawn` returns an agent id and `getRecord(id).metadata` is `{ change: "c1", "lane.root": "/w/c1" }`

#### Scenario: Empty map is no metadata
- **WHEN** an extension spawns with `metadata: {}`
- **THEN** the record snapshot has no `metadata` field

#### Scenario: Tool-call launch
- **WHEN** the main model's `subagent` call launches an agent
- **THEN** its record snapshot and its child and record events carry no `metadata`

#### Scenario: Resume takes no metadata
- **WHEN** the published `ResumeOptions` type is read
- **THEN** it has no `metadata` member

### Requirement: Metadata is public within the process
The README `spawn` contract SHALL state that metadata is delivered on `pi.events` to every extension in the process and MUST NOT be used for secrets.

#### Scenario: Contract states visibility
- **WHEN** the vendored package's README `spawn` contract is read
- **THEN** it states that metadata reaches every extension in the process and is not for secrets

### Requirement: Metadata limits
`spawn()` SHALL refuse metadata that breaks any of these rules:
- it is a plain object (its prototype is `Object.prototype` or `null`);
- every own property is an enumerable string key (no symbol keys, no non-enumerable properties);
- it has at most 32 keys;
- every key matches `^[a-z][a-z0-9_.-]{0,63}$`;
- every value is a string of at most 1024 characters, counted as JavaScript string length.


#### Scenario: Too many keys
- **WHEN** an extension spawns with a `metadata` map of 33 valid keys
- **THEN** `spawn` throws an error naming the 32-key limit, and `listAgents()` is unchanged

#### Scenario: Bad key
- **WHEN** an extension spawns with `metadata` `{ "Change": "c1" }`
- **THEN** `spawn` throws an error naming the key `Change` and the key pattern

#### Scenario: Value too long
- **WHEN** an extension spawns with a value of 1025 characters under key `packet`
- **THEN** `spawn` throws an error naming `packet` and the 1024-character limit

#### Scenario: Value at the limit
- **WHEN** an extension spawns with a value of exactly 1024 characters and 32 keys
- **THEN** the launch is accepted with every key and value unchanged

#### Scenario: Non-string value
- **WHEN** an untyped caller spawns with `metadata` `{ "unit": 3 }`
- **THEN** `spawn` throws an error naming `unit`

#### Scenario: Not a plain object
- **WHEN** an untyped caller spawns with `metadata` set to an array, a `Map`, `null` or an object whose prototype is another object
- **THEN** `spawn` throws an error saying metadata must be a plain object

#### Scenario: Symbol or hidden property
- **WHEN** an untyped caller spawns with a plain object that has a symbol key or a non-enumerable property
- **THEN** `spawn` throws an error saying metadata may hold only enumerable string keys

#### Scenario: Null-prototype object
- **WHEN** an extension spawns with `Object.create(null)` holding valid keys and values
- **THEN** the launch is accepted

### Requirement: Refused metadata
A refusal SHALL throw synchronously from `spawn()` with an error message that names the broken rule and, for a key or value rule, the offending key. A refused launch MUST create no record, emit no event and consult no launch policy. The executor MUST NOT truncate, drop or coerce any key or value.

#### Scenario: Nothing created on refusal
- **WHEN** `spawn` throws for bad metadata while a launch policy is registered
- **THEN** `listAgents()` is unchanged, no `subagents:created` or child event is emitted, and the policy was not called

### Requirement: Metadata is immutable
The executor SHALL keep its own frozen copy of accepted metadata. Changing the object passed to `spawn()` afterwards MUST NOT change what the executor reports, and the metadata the executor hands out on events, snapshots, launch requests and lookups MUST be frozen.

#### Scenario: Caller mutates its object
- **WHEN** an extension spawns with a `metadata` object and then sets a new key on that object
- **THEN** `getRecord(id).metadata` and the next record event do not contain the new key

#### Scenario: Consumer cannot write
- **WHEN** a consumer of `subagents:child:session-created` assigns a key on the event's `metadata`
- **THEN** the assignment throws in strict mode, and `childSession(sessionId).metadata` is unchanged

#### Scenario: Every surface is frozen
- **WHEN** a launch policy is registered, and a launch with metadata starts, is looked up, completes, is resumed and completes again
- **THEN** `Object.isFrozen` is true for the `metadata` of `getRecord(id)`, of `spawning`, `session-created` and `bound`, of `created`, `started`, `completed`, `resuming` and `resumed`, of the `LaunchRequest`, and for the `childSession` entry and its `metadata`

#### Scenario: Empty lookup metadata is frozen
- **WHEN** a child launched without metadata is looked up
- **THEN** the entry's `metadata` is an empty object and `Object.isFrozen` is true for it

### Requirement: Metadata on child events
`subagents:child:spawning`, `subagents:child:session-created` and `subagents:child:bound` SHALL carry `metadata` when the launch has metadata, next to `agentId` and `agentType`. They MUST omit the field otherwise.

#### Scenario: Child events of a launch with metadata
- **WHEN** an extension spawns with `metadata` `{ change: "c1" }` and the child starts
- **THEN** `spawning`, `session-created` and `bound` each carry `metadata` `{ change: "c1" }` with the record's `agentId`

#### Scenario: Child events without metadata
- **WHEN** an extension spawns without metadata
- **THEN** none of the three events has a `metadata` field

### Requirement: Metadata on record events and snapshots
`subagents:created`, `subagents:started`, `subagents:completed`, `subagents:failed`, `subagents:resuming` and `subagents:resumed` SHALL carry `metadata` when the record's launch has metadata, and the `SubagentRecord` snapshot SHALL carry it from the moment `spawn()` returns, including while the record is queued. A resume, from the service or from a `subagent` tool call, SHALL carry the launch's metadata on its events. Events and snapshots MUST omit the field when the launch has none.

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

### Requirement: Metadata is not persisted
The persisted `subagents:record` session entry MUST NOT carry metadata, and a record rebuilt from it SHALL have none.

#### Scenario: Persisted entry
- **WHEN** a launch with metadata reaches a terminal state and its `subagents:record` entry is appended
- **THEN** the entry has no `metadata` field, and the run summary read back from it has none

### Requirement: Child session lookup
`SubagentsService.childSession(sessionId)` SHALL return a frozen `{ agentId, agentType, metadata }` for a live in-process child session of this executor, and `undefined` for any other id, including the main session's. `metadata` SHALL always be present: the launch's metadata, or an empty frozen object when the launch had none (a tool-call launch included).

#### Scenario: Main session and unknown ids
- **WHEN** `childSession` is called with the main session's id or an unknown id
- **THEN** it returns `undefined`

#### Scenario: Tool-call child
- **WHEN** a child launched by a `subagent` tool call is looked up
- **THEN** the entry carries its `agentId`, `agentType` and an empty `metadata`

### Requirement: Child session registry lifetime
The lookup SHALL be backed by one registry shared by every executor instance in the process. A child SHALL be entered before `subagents:child:session-created` is dispatched, and SHALL be removed when the publisher's `disposed` call returns, after the synchronous dispatch of its subscribers. Disposal follows the child's `session_shutdown` (settled or timed out by the existing bound), and a failed bind or grant check MUST go through the same disposal.

#### Scenario: Lookup from the child's session_start
- **WHEN** an extension loaded in a child calls `getSubagentsService().childSession(ctx.sessionManager.getSessionId())` from its `session_start` handler
- **THEN** it gets the record's `agentId`, `agentType` and the launch's `metadata`

#### Scenario: Lookup during shutdown
- **WHEN** an extension in the child calls `childSession` with the child's id from its `session_shutdown` handler, before that handler settles and before the shutdown bound expires
- **THEN** it still gets the child's entry

#### Scenario: Shutdown handler past the bound
- **WHEN** a child's `session_shutdown` handler is still pending when the shutdown bound expires and disposal finishes
- **THEN** `childSession` with the child's id returns `undefined`, even though the handler has not settled

#### Scenario: Present during event dispatch
- **WHEN** a synchronous subscriber of `subagents:child:session-created` or of `subagents:child:disposed` calls `childSession` with the event's `sessionId`
- **THEN** it gets the child's entry

#### Scenario: Removed after disposal
- **WHEN** the child's disposal has finished emitting `subagents:child:disposed`
- **THEN** `childSession` with that id returns `undefined`

#### Scenario: Failed bind
- **WHEN** a child's extension binding throws after `session-created`
- **THEN** `childSession` with its id returns `undefined` once `spawn`'s record has failed

#### Scenario: Failed grant check
- **WHEN** a launch policy grant cannot be restored and the child is torn down after binding
- **THEN** `childSession` with its id returns `undefined` once the launch has failed

#### Scenario: Shared across executor instances
- **WHEN** a child is entered by one executor instance's publisher
- **THEN** a service backed by another executor instance in the same process returns the same entry for that id

#### Scenario: Gone after the parent session shuts down
- **WHEN** a child is live and the parent session shuts down (including for `/reload`)
- **THEN** after shutdown `childSession` with the child's id returns `undefined`

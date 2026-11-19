## ADDED Requirements

### Requirement: Result schema on service launches
`SpawnOptions` SHALL accept an optional `resultSchema`, a JSON Schema in this draft 2020-12 subset:
- `type`: a single string, one of `object`, `array`, `string`, `number`, `integer`, `boolean`; the root MUST declare it;
- `enum`: a non-empty array of strings, numbers or booleans;
- `properties`: a map of property names to subset schemas;
- `items`: one subset schema;
- `required`: an array of unique strings;
- `additionalProperties`: a boolean or a subset schema.

The `subagent` tool and agent frontmatter MUST NOT accept a result schema.

#### Scenario: Schema accepted
- **WHEN** an extension calls `spawn("implementer", brief, { resultSchema: { type: "object", properties: { status: { enum: ["done", "blocked"] } }, required: ["status"], additionalProperties: false } })`
- **THEN** `spawn` returns an agent id and the launch runs with that schema

### Requirement: Result schema annotations
A subset schema MAY carry `title` and `description`, and SHALL accept `$schema` only as `https://json-schema.org/draft/2020-12/schema`; annotations MUST NOT change validation.

#### Scenario: Draft URI accepted
- **WHEN** the root schema has `$schema` `https://json-schema.org/draft/2020-12/schema` and a `description`
- **THEN** `spawn` accepts it

#### Scenario: Other draft refused
- **WHEN** the root schema has `$schema` `http://json-schema.org/draft-07/schema#`
- **THEN** `spawn` throws an error naming `$schema`

### Requirement: Result schema is copied at spawn
The executor SHALL keep a frozen deep copy of the accepted schema; later changes to the caller's object MUST NOT affect the launch.

#### Scenario: Caller mutates the schema after spawn
- **WHEN** the caller adds `"partial"` to the `enum` of its schema object after `spawn` returned
- **THEN** `submit_result` with `{ "status": "partial" }` is still refused

#### Scenario: No schema
- **WHEN** a launch passes no `resultSchema`
- **THEN** the child has no `submit_result` tool, its tool count is what it was before this change, and its record and events carry neither `structuredResult` nor `structuredResultError`

### Requirement: Refused result schemas
`spawn` MUST throw, before any record, session or launch-policy call is made, when:
- `resultSchema` is not a plain object, or any nested schema is not;
- a schema uses a keyword outside the subset; the error SHALL name the keyword and its JSON Pointer;
- the root schema has no `type`, or a `type` is not one of the six names;
- the launch's context resolves to `fork` (from the caller, the agent file, or a locked agent file), before any fallback; the error SHALL name `resultSchema` and `fork`.

#### Scenario: Unsupported keyword
- **WHEN** an extension passes `resultSchema` `{ type: "object", properties: { n: { type: "number", minimum: 0 } } }`
- **THEN** `spawn` throws an error naming `minimum` and `/properties/n/minimum`, and `listAgents()` is unchanged

#### Scenario: Missing root type
- **WHEN** an extension passes `resultSchema` `{ properties: {} }`
- **THEN** `spawn` throws an error naming `type`

#### Scenario: Fork with a schema
- **WHEN** an extension calls `spawn("explore", brief, { context: "fork", resultSchema: { type: "string" } })`
- **THEN** `spawn` throws an error naming `resultSchema` and `fork`, and no child starts

#### Scenario: Agent default fork with a schema
- **WHEN** an agent file declares `context: fork` and a caller passes a `resultSchema` and no context
- **THEN** `spawn` throws an error naming `resultSchema` and `fork`

#### Scenario: Refusal before the policy
- **WHEN** `spawn` throws for a bad schema while a launch policy is registered
- **THEN** the policy is not called

### Requirement: Submit result tool
A launch with a `resultSchema` SHALL install the child protocol tool `submit_result` alongside `ask_parent` and `notify_parent`. Its parameters SHALL be an object with one required property `result` whose schema is the launch's schema, and no other properties. Its description SHALL tell the child to call it once with its final result before finishing. The tool SHALL count as one of the child's own tools in its tool count, like `ask_parent`.

#### Scenario: Tool installed
- **WHEN** a background service launch with a schema starts and mid-run updates are on
- **THEN** the child's active tools include `ask_parent`, `notify_parent` and `submit_result`

#### Scenario: Counted as the child's own tool
- **WHEN** an agent declares `tools: read`, the launch installs `ask_parent` and `submit_result` and no `notify_parent`, and no policy adjusts it
- **THEN** the record's `toolCount` is 3

### Requirement: Submit result tool cannot be removed
`disallowed_tools` and a launch-policy `removeTools` MUST NOT remove `submit_result` while the launch has a schema.

#### Scenario: Disallowed tools cannot remove it
- **WHEN** the agent declares `disallowed_tools: submit_result` and the launch has a schema
- **THEN** the child still has `submit_result`

#### Scenario: Policy cannot remove it
- **WHEN** the launch policy returns `removeTools: ["submit_result"]` for a launch with a schema
- **THEN** the child still has `submit_result`

### Requirement: Submitted result is validated in the child
`submit_result` SHALL validate `result` against the launch's schema with the executor's own validator. The validator SHALL receive the argument as Pi passes it to the tool, after Pi's own argument validation and coercion, and the stored value SHALL be that argument. When the value is invalid, the tool SHALL return an error result listing every violation with its path, store nothing, and leave the run going so the child can call it again. When the value is valid and the run has no stored result yet, the tool SHALL store it as the run's structured result and confirm it.

#### Scenario: Invalid value reported to the child
- **WHEN** the schema requires `status` with `enum` `["done", "blocked"]` and the child calls `submit_result` with `{ "status": "maybe" }`
- **THEN** the tool result is an error naming `result.status` and the allowed values, and the run continues

#### Scenario: Child fixes the value
- **WHEN** after that error the child calls `submit_result` with `{ "status": "done" }`
- **THEN** the run's structured result is `{ "status": "done" }`

#### Scenario: Coerced argument stored
- **WHEN** the schema is `{ type: "integer" }` and the child calls `submit_result` with `"42"`
- **THEN** the run's structured result is the number `42`

#### Scenario: Extra property refused
- **WHEN** the schema sets `additionalProperties: false` and the child submits `{ "status": "done", "note": "x" }`
- **THEN** the tool result is an error naming `note`

#### Scenario: Integer checked
- **WHEN** a property is `{ type: "integer" }` and the child submits `1.5` for it
- **THEN** the tool result is an error naming that property

### Requirement: Integer type
The validator SHALL accept for `integer` exactly the numbers for which `Number.isInteger` is true.

#### Scenario: Whole float accepted
- **WHEN** a property is `{ type: "integer" }` and the child submits `3`
- **THEN** the value is accepted

### Requirement: First valid submission is final
When the run already holds a structured result, `submit_result` SHALL return an error result saying a result was already submitted and MUST NOT replace the stored value.

#### Scenario: Second submission ignored
- **WHEN** a run holds `{ "status": "done" }` and the child calls `submit_result` with `{ "status": "blocked" }`
- **THEN** the tool returns an error saying a result was already submitted, and the structured result stays `{ "status": "done" }`

### Requirement: Valid submission ends the run
After a valid `submit_result`, the run SHALL end once the current turn's tool calls finish: no further model turn MUST start in that run. A run ended this way SHALL settle `completed`, also when that turn reached the turn limit, and its free-text `result` SHALL be the response text collected as today. A stop requested from outside the run (`abort`, a caller signal) SHALL keep its own status.

#### Scenario: Submit alone
- **WHEN** the child's turn calls only `submit_result` with a valid value
- **THEN** the run settles `completed` without another model turn

#### Scenario: Submit beside other tools
- **WHEN** the child's turn calls `read` and a valid `submit_result` together
- **THEN** both tool calls finish, no further model turn starts, and the run settles `completed`

#### Scenario: Submit on the last permitted turn
- **WHEN** a run with `maxTurns` 3 calls a valid `submit_result` (alone, or beside `read`) on turn 3
- **THEN** the run settles `completed` with the structured result, not `aborted`

#### Scenario: External stop after submit
- **WHEN** a run holds a structured result and `abort(id)` is called before it settles
- **THEN** the record reads `stopped` and keeps `structuredResult`

### Requirement: Structured outcome per run
Every run of a record with a schema (the initial run and each resume) SHALL start with neither `structuredResult` nor `structuredResultError`. When the run ends:
- with a stored value: `structuredResult` SHALL be that value;
- with a pending `ask_parent` question and no stored value: neither field SHALL be set;
- otherwise, in any terminal status: `structuredResultError` SHALL be set.

A run stopped while queued SHALL set neither field. The free-text `result` SHALL be kept.

#### Scenario: Turn limit reached
- **WHEN** a child with a schema is stopped at its turn limit without a valid submission
- **THEN** the record's status is `aborted` and `structuredResultError` is set

#### Scenario: Pending question
- **WHEN** the child calls `ask_parent` and ends its turn without submitting
- **THEN** the record has `pendingQuestion` set and neither `structuredResult` nor `structuredResultError`

#### Scenario: Resume submits
- **WHEN** the parent resumes that record with an answer and the child then submits a valid value
- **THEN** the record has that `structuredResult` and no `structuredResultError`

#### Scenario: Resume clears the previous outcome
- **WHEN** a record whose run ended with `structuredResultError` `"missing"` is resumed
- **THEN** while the resumed run is running the record has neither field


### Requirement: Structured result error kinds
When "Structured outcome per run" requires `structuredResultError`, it SHALL be `"invalid"` when the run called `submit_result` at least once, including calls Pi refused before the tool ran, and `"missing"` when it never did.

#### Scenario: Valid submission has no error
- **WHEN** the child called `submit_result` once invalid, then once valid
- **THEN** the record has `structuredResult` and no `structuredResultError`

#### Scenario: Invalid attempt then question
- **WHEN** the child called `submit_result` with an invalid value, then `ask_parent`, and ended its turn
- **THEN** the record has neither `structuredResult` nor `structuredResultError`

#### Scenario: Never called
- **WHEN** a child with a schema finishes with a text answer and never calls `submit_result`
- **THEN** the record has `result` set, no `structuredResult`, and `structuredResultError` `"missing"`

#### Scenario: Only invalid calls
- **WHEN** the child called `submit_result` twice, both invalid, then finished
- **THEN** `structuredResultError` is `"invalid"`

### Requirement: Structured outcome on a waited snapshot
The snapshot `SubagentsService.wait()` resolves with SHALL carry `structuredResult` and `structuredResultError` of the run the wait began on, like its other per-run fields (see `service-launch-wait`), even when a resume has replaced that run before the promise resolves.

#### Scenario: Resumed before the waiter reads it
- **WHEN** a `wait(id)` is pending on a run that ends with a pending question and no submission, and an observer resumes the agent before the promise resolves, and the resumed run submits `{ "status": "done" }`
- **THEN** the promise resolves with the initial run's `pendingQuestion` and neither `structuredResult` nor `structuredResultError`

#### Scenario: Waited run submitted
- **WHEN** a `wait(id)` is pending and the run submits `{ "status": "done" }` and completes
- **THEN** the promise resolves with `structuredResult` `{ "status": "done" }`

### Requirement: Structured outcome on records and events
The `SubagentRecord` snapshot and the payloads of `subagents:completed`, `subagents:failed` and `subagents:resumed` SHALL carry `structuredResult` and `structuredResultError` when set, and MUST omit each when not set. The persisted `subagents:record` session entry MUST NOT store either field.

#### Scenario: Completed event
- **WHEN** a child submits `{ "status": "done" }` and its run completes
- **THEN** `subagents:completed` carries `structuredResult` `{ "status": "done" }` and `getRecord(id).structuredResult` deep-equals it

#### Scenario: Missing on the event
- **WHEN** a child with a schema completes without submitting
- **THEN** `subagents:completed` carries `structuredResultError` `"missing"` and no `structuredResult`

#### Scenario: Not persisted
- **WHEN** a run with a structured result settles
- **THEN** the appended `subagents:record` entry has neither `structuredResult` nor `structuredResultError`

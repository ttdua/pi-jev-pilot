## MODIFIED Requirements

### Requirement: Record events carry the tool call id
The executor's `subagents:created`, `subagents:started`, `subagents:completed`, `subagents:failed`, `subagents:resuming`, `subagents:resumed`, `subagents:update` and `subagents:asked` events SHALL carry `toolCallId` when the record was launched, or resumed, from a `subagent` tool call, in addition to their existing fields. Events of service launches MUST omit it.

#### Scenario: Completion of a tool-call launch
- **WHEN** a foreground launch from `subagent` call `call_2` completes
- **THEN** `subagents:completed` carries the record id and `toolCallId` `call_2`

#### Scenario: Resume from a tool call
- **WHEN** the main model resumes agent `a1` with `subagent` call `call_3`
- **THEN** `subagents:resuming` and `subagents:resumed` carry id `a1` and `toolCallId` `call_3`

#### Scenario: Update from a tool-call launch
- **WHEN** a background launch from `subagent` call `call_6` calls `notify_parent`
- **THEN** `subagents:update` carries the record id, the message and `toolCallId` `call_6`

#### Scenario: Update from a service launch
- **WHEN** a service launch calls `notify_parent`
- **THEN** `subagents:update` has no `toolCallId` field

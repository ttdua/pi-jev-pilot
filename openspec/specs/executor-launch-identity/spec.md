# executor-launch-identity Specification

## Purpose
Executor lifecycle and record events name their launch (agent id, type, tool call id) and report the model and thinking a child actually runs with.

## Requirements

### Requirement: Child lifecycle events name their launch
The executor's `subagents:child:spawning`, `subagents:child:session-created` and `subagents:child:bound` events SHALL carry `agentId` (the record id `spawn()` returns) and `agentType` (the resolved agent type), in addition to their existing fields. When the launch came from a `subagent` tool call, they SHALL also carry `toolCallId`. A launch from `SubagentsService.spawn()` MUST omit `toolCallId`.

#### Scenario: Tool-call launch
- **WHEN** the main model's `subagent` call with id `call_1` launches agent type `Explore`
- **THEN** `subagents:child:session-created` carries the child's `sessionId`, the record's `agentId`, `agentType` `Explore` and `toolCallId` `call_1`

#### Scenario: Service launch
- **WHEN** an extension calls `spawn("Plan", ...)` and receives id `a1`
- **THEN** `subagents:child:session-created` carries `agentId` `a1`, `agentType` `Plan` and no `toolCallId`

### Requirement: Record events carry the tool call id
The executor's `subagents:created`, `subagents:started`, `subagents:completed`, `subagents:failed`, `subagents:resuming` and `subagents:resumed` events SHALL carry `toolCallId` when the record was launched, or resumed, from a `subagent` tool call, in addition to their existing fields. Events of service launches MUST omit it.

#### Scenario: Completion of a tool-call launch
- **WHEN** a foreground launch from `subagent` call `call_2` completes
- **THEN** `subagents:completed` carries the record id and `toolCallId` `call_2`

#### Scenario: Resume from a tool call
- **WHEN** the main model resumes agent `a1` with `subagent` call `call_3`
- **THEN** `subagents:resuming` and `subagents:resumed` carry id `a1` and `toolCallId` `call_3`

### Requirement: Effective model and thinking
When a child session is created, the executor SHALL record the model (`provider/id`) and thinking level the session was created with, after agent-file `locked` fields, the launch policy and model resolution, as `effectiveModel` and `effectiveThinking`. Both SHALL appear on `subagents:child:session-created` and on the record's `SubagentRecord` snapshot from then on. A record whose session was never created MUST omit both.

#### Scenario: Model rewritten by the policy
- **WHEN** the caller asks for `fixture/fixture-main`, the launch policy sets `fixture/fixture-fast` with thinking `medium`, and the child starts
- **THEN** `session-created` and `getRecord(id)` carry `effectiveModel` `fixture/fixture-fast` and `effectiveThinking` `medium`, and the child's first provider request uses that model and reasoning effort

#### Scenario: Locked model wins
- **WHEN** the agent file locks `model` to `fixture/fixture-deep` and the caller asks for `fixture/fixture-fast`
- **THEN** `effectiveModel` is `fixture/fixture-deep`

#### Scenario: Queued record
- **WHEN** a background launch is still queued
- **THEN** its `SubagentRecord` has no `effectiveModel` and no `effectiveThinking`

### Requirement: Identity fields are additive
Every field this capability adds SHALL be optional in the published types, and every existing event and record field MUST keep its name, type and meaning, so that consumers written for upstream keep working.

#### Scenario: Upstream consumer unaffected
- **WHEN** the vendored package's existing unit tests for lifecycle events and `SubagentRecord` run
- **THEN** they pass without changes to their expectations of existing fields

## MODIFIED Requirements

### Requirement: Child lifecycle events name their launch
The executor's `subagents:child:spawning`, `subagents:child:session-created` and `subagents:child:bound` events SHALL carry `agentId` (the record id `spawn()` returns) and `agentType` (the resolved agent type), in addition to their existing fields. When the launch came from a `subagent` tool call, they SHALL also carry `toolCallId`. A launch from `SubagentsService.spawn()` MUST omit `toolCallId`.

#### Scenario: Tool-call launch
- **WHEN** the main model's `subagent` call with id `call_1` launches agent type `explore`
- **THEN** `subagents:child:session-created` carries the child's `sessionId`, the record's `agentId`, `agentType` `explore` and `toolCallId` `call_1`

#### Scenario: Service launch
- **WHEN** an extension calls `spawn("implementer", ...)` and receives id `a1`
- **THEN** `subagents:child:session-created` carries `agentId` `a1`, `agentType` `implementer` and no `toolCallId`

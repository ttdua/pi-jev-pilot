## REMOVED Requirements

### Requirement: Blocked tool count fact

**Reason**: It counts only tools removed by `disallowed_tools` or a launch-policy removal, so the count is 0 and hidden for agents that restrict themselves with a `tools:` allowlist, and it needs per-source bookkeeping.

**Migration**: Replaced by "Blocked tool count is the rest of the total". The tool count, the formatter, the surfaces and the `SubagentRecord` fields are unchanged; only the value of the blocked tool count changes.

## ADDED Requirements

### Requirement: Blocked tool count is the rest of the total
The blocked tool count SHALL be the number of tools in the run's total that are not among the child's active tools (`getActiveToolNames()`). The total SHALL be the tool names the parent has registered plus the child's own active tools, so the tool count plus the blocked tool count equals the total. The count MUST be read after bind and the grant check, and MUST be unknown before bind.

#### Scenario: Allowlist narrows the child
- **WHEN** the parent has 30 tools, the agent declares `tools: read, grep` and the launch installs `ask_parent` and no `notify_parent`
- **THEN** the tool count is 3 and the blocked tool count is 28

#### Scenario: Disallowed tool is blocked
- **WHEN** an agent declares tools `read, bash, edit` and `disallowed_tools: bash`, with no launch policy and a parent that has 10 tools including those three
- **THEN** the child's active tools are `read` and `edit`, and the blocked tool count is 8

#### Scenario: Policy removal is blocked
- **WHEN** the launch policy removes `edit` from an agent whose default tools include `edit` and `read`, with a parent that has 10 tools including both
- **THEN** `edit` is not among the child's active tools and is counted as blocked

#### Scenario: Removal re-granted is not blocked
- **WHEN** the policy removes `bash` and also grants `bash`, and the grant takes effect in the child
- **THEN** `bash` is among the child's active tools and is not counted as blocked

#### Scenario: Unknown before bind
- **WHEN** a background launch is still queued, or its child has not bound
- **THEN** the blocked tool count is unknown

### Requirement: Every tool the child lacks is blocked
The executor SHALL count a tool as blocked whatever the cause of its absence: the `tools:` allowlist, `disallowed_tools`, a launch-policy removal or the recursion guard (`subagent`, `get_subagent_result`, `steer_subagent`). A tool the child has SHALL count as granted, including the child's own tools (`ask_parent`, `notify_parent`) and a tool removed by the policy and granted back.

#### Scenario: Recursion guard tools are blocked
- **WHEN** the parent has `subagent`, `get_subagent_result` and `steer_subagent` and an agent has no `disallowed_tools`
- **THEN** all three are counted as blocked, so the blocked tool count is at least 3

#### Scenario: Child's own tools are granted
- **WHEN** the launch installs `ask_parent` and `notify_parent` and the parent has neither
- **THEN** both are among the child's active tools, are part of the total, and are not counted as blocked

#### Scenario: Granted plus blocked is the total
- **WHEN** a child has bound with any allowlist, `disallowed_tools` and launch policy
- **THEN** the tool count plus the blocked tool count equals the number of distinct names in the parent's registered tools and the child's active tools

#### Scenario: Nothing blocked
- **WHEN** the child's active tools include every tool the parent has registered
- **THEN** the blocked tool count is 0

# subagent-run-facts Specification

## Purpose
The vendored executor determines each subagent's model, thinking level, tool count and blocked tool count from local session state, and shows them through one shared formatter on the inline tool result, the `Agents` widget and the fleet row.

## Requirements

### Requirement: Model and thinking facts
The vendored executor SHALL take a record's model fact (`provider/id`) and thinking fact from its live session, then from the values captured when the session was released. Before the session exists, it SHALL use the values the launch resolved for the run, as the record already reports today. A fact none of these provides MUST be treated as unknown and omitted.

#### Scenario: Thinking changed by the launch policy
- **WHEN** the `subagent` call asks for thinking `high`, the launch policy sets thinking `low`, and the child session exists
- **THEN** the record's thinking fact is `low`

#### Scenario: Released session keeps model and thinking
- **WHEN** an agent ran `fixture/fixture-fast` at thinking `low`, finished, and its session was released
- **THEN** its model fact is `fixture/fixture-fast` and its thinking fact is `low`

#### Scenario: Before the session exists
- **WHEN** a background launch with model `fixture/fixture-main` resolved is still queued
- **THEN** its model fact is `fixture/fixture-main`, and its tool count and blocked tool count are unknown

### Requirement: Tool count fact
The executor SHALL take a record's tool count as the number of active tools in the child (`getActiveToolNames()`), read once the child's extensions are bound and its grants are checked. The count includes protocol tools and grants that took effect. It excludes grants the check dropped. Before bind the tool count MUST be unknown, never zero.

#### Scenario: Count after the grant check
- **WHEN** an agent declares tools `read, grep`, the launch installs `ask_parent` and no `notify_parent` (mid-run updates off), and the policy grants `web_search` (kept) and `parent_only` (dropped by the grant check)
- **THEN** the tool count is 4

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

### Requirement: Tool facts survive the session
The executor SHALL fix a record's tool count and blocked tool count once its child has bound, and keep them after the record's session is released. A resume that reuses the session MUST keep them unchanged. If the tool facts cannot be read, they SHALL stay unknown and the launch MUST proceed unaffected.

#### Scenario: Released session
- **WHEN** an agent bound with 12 tools and 3 blocked has finished and its session has been released
- **THEN** its tool count is still 12 and its blocked tool count is still 3

#### Scenario: Unreadable tool list
- **WHEN** reading the child's active tools throws after bind
- **THEN** the launch runs as before and both tool facts are unknown

### Requirement: Run facts format
The executor SHALL format the run facts with one shared formatter as named parts:
- model: `provider/id`
- thinking: `thinking: <level>`
- tools: `🔧N`
- blocked: `⊘M`

An unknown fact MUST yield no part, and the blocked part MUST be absent when M is 0. Every surface that shows a run fact SHALL take its text from this formatter.

#### Scenario: All facts known
- **WHEN** a record runs `anthropic/claude-haiku-4-5` at thinking `high` with 12 tools and 3 blocked
- **THEN** the parts are `anthropic/claude-haiku-4-5`, `thinking: high`, `🔧12`, `⊘3`

#### Scenario: Nothing blocked
- **WHEN** the blocked tool count is 0
- **THEN** no `⊘` part is produced

#### Scenario: Unknown facts
- **WHEN** a record has no thinking level and unknown tool facts
- **THEN** the only part is its model, or no part when its model is unknown too

### Requirement: Run facts in the inline tool result
The inline result of a `subagent` call SHALL keep the order of the parts it shows today: model, mode label, invocation tags, turn budget, `N tool uses`, tokens. The thinking part SHALL stand where the `thinking: <level>` tag stands today (after the mode label), MUST come from the record's thinking fact, and SHALL be shown whenever that fact is known. The tool parts SHALL follow the thinking part. Every other existing part SHALL stay with the same wording.

#### Scenario: Policy-changed thinking shown live
- **WHEN** a foreground `subagent` call asks for thinking `high`, the launch policy sets `low`, and the run is streaming
- **THEN** the inline result shows `thinking: low` and not `thinking: high`

#### Scenario: Existing order kept
- **WHEN** a streaming `twin` agent with `inherit_context` true runs `fixture/fixture-fast` at thinking `low`, with 12 tools, 2 blocked, 5 tool uses and 3 turns
- **THEN** the stats read, in order: `fixture/fixture-fast`, `twin`, `thinking: low`, `🔧12`, `⊘2`, `inherit context`, `↻3`, `5 tool uses`, then tokens

### Requirement: Run facts in the agents widget
Each agent line of the above-editor `Agents` widget SHALL show, after the agent's name and mode label, one dim bracket tag `[<parts joined by ' · '>]` in the order model, thinking, tools, blocked. This tag replaces the `[provider/id]` tag in the same position. Every other part of the line SHALL stay, in the same order and wording.

#### Scenario: Running agent line
- **WHEN** a background agent runs `openai/gpt-6` at thinking `medium` with 9 tools and 2 blocked
- **THEN** its header line contains `[openai/gpt-6 · thinking: medium · 🔧9 · ⊘2]` right after its name and mode label, and still contains its tool uses, tokens and elapsed time

#### Scenario: No facts known
- **WHEN** an agent has no known run fact
- **THEN** its line has no bracket tag

### Requirement: Tool facts on the record snapshot
`SubagentRecord` SHALL carry optional `toolCount` and `blockedToolCount` once they are known, and MUST omit them before that. No existing field of `SubagentRecord` changes.

#### Scenario: Bound record
- **WHEN** a child has bound with 12 tools and 3 blocked
- **THEN** `getRecord(id)` carries `toolCount` 12 and `blockedToolCount` 3

#### Scenario: Queued record
- **WHEN** a background launch is still queued
- **THEN** its `SubagentRecord` has no `toolCount` and no `blockedToolCount`

### Requirement: Run facts make no outside calls
Determining and formatting run facts MUST read only in-memory executor state. They MUST NOT call Jev, make a network request, or store prompt text, tool arguments, tool output or tool names; only counts are stored.

#### Scenario: Loopback launch
- **WHEN** a subagent runs against the loopback provider fixture with only the executor installed, and its run facts are recorded
- **THEN** the record carries its tool facts and the fixture receives only the run's own provider requests

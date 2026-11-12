## ADDED Requirements

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

### Requirement: Blocked tool count fact
The executor SHALL take a record's blocked tool count as the number of distinct known tools the child lost to `disallowed_tools` or an accepted policy removal. Known tools: core built-ins, fixed-name built-in extension tools, installed protocol tools, parent tools. A disallowed name SHALL count only if it is in the child's pre-filter tool list. The count MUST NOT include the recursion denylist, unknown names, refused removals or tools re-granted in effect, and MUST be unknown before bind.

#### Scenario: Disallowed tools counted
- **WHEN** an agent declares tools `read, bash, edit` and `disallowed_tools: bash, write`, with no launch policy
- **THEN** the blocked tool count is 1

#### Scenario: Disallowed protocol tool counted
- **WHEN** the launch installs `ask_parent` and the agent sets `disallowed_tools: ask_parent`
- **THEN** the blocked tool count is 1

#### Scenario: Protocol tool not installed
- **WHEN** the launch installs no `notify_parent` and the agent sets `disallowed_tools: notify_parent`
- **THEN** the blocked tool count is 0

#### Scenario: Disallowed built-in extension tool counted
- **WHEN** the parent has no `codemode` tool, and the agent declares `tools: read, codemode` with `disallowed_tools: codemode`
- **THEN** the blocked tool count is 1

#### Scenario: Unregistered MCP name not counted
- **WHEN** the agent declares `tools: read, mcp__missing__ghost` with `disallowed_tools: mcp__missing__ghost`, and the parent has no such tool
- **THEN** the blocked tool count is 0

#### Scenario: Removal re-granted is not counted
- **WHEN** the policy removes the default tool `bash` and also grants `bash`, and the grant takes effect in the child
- **THEN** the blocked tool count is 0

#### Scenario: Unknown name not counted
- **WHEN** an agent declares tools `read, ghost` and `disallowed_tools: ghost`, and no tool named `ghost` exists
- **THEN** the blocked tool count is 0

#### Scenario: Policy removal counted
- **WHEN** the launch policy removes `edit` from an agent whose default tools include `edit` and `read`
- **THEN** the blocked tool count is 1

#### Scenario: Rejected removal not counted
- **WHEN** the agent declares `tools: read, edit` and the policy's removal of the declared `edit` is refused
- **THEN** the blocked tool count is 0

#### Scenario: Both sources remove the same tool
- **WHEN** `bash` is in the agent's default tools, the agent's `disallowed_tools` lists `bash`, and the policy also asks to remove `bash`
- **THEN** the blocked tool count is 1

#### Scenario: Tool appears after the policy ran
- **WHEN** a policy that removes nothing runs, and an MCP tool matching the agent's `mcp__srv__*` pattern registers in the parent before the child session is created
- **THEN** that tool is not counted as blocked

#### Scenario: Recursion denylist not counted
- **WHEN** an agent with no `disallowed_tools` runs with no launch policy
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

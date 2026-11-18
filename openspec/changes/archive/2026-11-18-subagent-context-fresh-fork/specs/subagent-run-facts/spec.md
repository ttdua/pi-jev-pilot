## MODIFIED Requirements

### Requirement: Run facts in the inline tool result
The inline result of a `subagent` call SHALL keep the order of the parts it shows today: model, context label, invocation tags, turn budget, `N tool uses`, tokens.

- **Context label.** It SHALL be `fork` when the run's resolved context is `fork`, `fork → fresh` when a fork from the agent file fell back to fresh (`contextFallback` set), and absent for any other fresh run. It MUST come from the run, never from the agent type. The labels `twin` and `inherit context` MUST NOT appear.
- **Thinking part.** It SHALL stand where the `thinking: <level>` tag stands today (after the context label). It MUST come from the record's thinking fact, and SHALL be shown whenever that fact is known.
- **Tool parts.** They SHALL follow the thinking part.

Every other existing part SHALL stay with the same wording.

#### Scenario: Policy-changed thinking shown live
- **WHEN** a foreground `subagent` call asks for thinking `high`, the launch policy sets `low`, and the run is streaming
- **THEN** the inline result shows `thinking: low` and not `thinking: high`

#### Scenario: Existing order kept
- **WHEN** a streaming fork runs `fixture/fixture-fast` at thinking `low`, with 12 tools, 2 blocked, 5 tool uses and 3 turns
- **THEN** the stats read, in order: `fixture/fixture-fast`, `fork`, `thinking: low`, `🔧12`, `⊘2`, `↻3`, `5 tool uses`, then tokens

#### Scenario: Fallback shown
- **WHEN** an agent file's `context: fork` fell back to fresh for lack of a parent session, and the run streams
- **THEN** the stats show `fork → fresh` in the context-label position

#### Scenario: Fresh run has no label
- **WHEN** a caller-requested fresh run (no `contextFallback`) of an agent whose file declares `context: fork` streams
- **THEN** the stats contain neither `fork` nor `twin`

### Requirement: Run facts in the agents widget
Each agent line of the above-editor `Agents` widget SHALL show, in this order:
1. the agent's name;
2. the run's context label, as in the inline result: `(fork)` for a fork, `(fork → fresh)` after a fallback, nothing for any other fresh run;
3. one dim bracket tag `[<parts joined by ' · '>]`, with parts in the order model, thinking, tools, blocked.

This tag replaces the `[provider/id]` tag in the same position. The session navigator heading SHALL show the same context label after the agent's name. Every other part of the line SHALL stay, in the same order and wording. `twin` MUST NOT appear.

#### Scenario: Running agent line
- **WHEN** a background fork runs `openai/gpt-6` at thinking `medium` with 9 tools and 2 blocked
- **THEN** its header line contains `(fork)` after its name, then `[openai/gpt-6 · thinking: medium · 🔧9 · ⊘2]`, and still contains its tool uses, tokens and elapsed time

#### Scenario: No facts known
- **WHEN** an agent has no known run fact
- **THEN** its line has no bracket tag

#### Scenario: Fresh run line
- **WHEN** a fresh run of an agent formerly declared `prompt_mode: append` is shown
- **THEN** its line and the navigator heading show neither `(fork)` nor `(twin)`

### Requirement: Tool count fact
The executor SHALL take a record's tool count as the number of active tools in the child (`getActiveToolNames()`), read once the child's extensions are bound and its grants are checked. For a fork, the tool count SHALL be the number of its callable tools (see `subagent-context-mode`), not its declarations. The count includes protocol tools and grants that took effect. It excludes grants the check dropped. Before bind the tool count MUST be unknown, never zero.

#### Scenario: Count after the grant check
- **WHEN** an agent declares tools `read, grep`, the launch installs `ask_parent` and no `notify_parent` (mid-run updates off), and the policy grants `web_search` (kept) and `parent_only` (dropped by the grant check)
- **THEN** the tool count is 4

#### Scenario: Fork tool count
- **WHEN** a read-only agent with `tools: read, grep` is forked from a parent with 30 tools including `read` and `grep`
- **THEN** the tool count is 2

### Requirement: Blocked tool count is the rest of the total
The blocked tool count SHALL be the number of tools in the run's total that are not among the child's active tools (`getActiveToolNames()`); for a fork, that are not among its callable tools. The total SHALL be the tool names the parent has registered plus the child's own active tools, so the tool count plus the blocked tool count equals the total. The count MUST be read after bind and the grant check, and MUST be unknown before bind.

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

#### Scenario: Fork blocked count
- **WHEN** a read-only agent with `tools: read, grep` is forked from a parent with 30 tools including `read` and `grep`
- **THEN** the blocked tool count is 28

### Requirement: Every tool the child lacks is blocked
The executor SHALL count a tool as blocked whatever the cause of its absence, or, for a fork, of its refusal: the `tools:` allowlist, `disallowed_tools`, a launch-policy removal or the recursion guard (`subagent`, `get_subagent_result`, `steer_subagent`). A tool the child has SHALL count as granted, including the child's own tools (`ask_parent`, `notify_parent`) and a tool removed by the policy and granted back.

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
- **WHEN** the child's active tools (for a fork, its callable tools) include every tool the parent has registered
- **THEN** the blocked tool count is 0

#### Scenario: Refused fork tool is blocked
- **WHEN** a fork declares the parent's `edit` and refuses calls to it
- **THEN** `edit` is counted as blocked

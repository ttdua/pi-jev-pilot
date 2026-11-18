## ADDED Requirements

### Requirement: One context setting per launch
Every subagent launch SHALL resolve exactly one context: `fresh` or `fork`. Three inputs SHALL accept only these two values:
- the `subagent` tool parameter `context`;
- the agent frontmatter field `context`;
- the service `spawn` option `context`.

#### Scenario: Invalid value
- **WHEN** a caller passes `context: "twin"`
- **THEN** the tool call is rejected by its parameter schema and no child starts

#### Scenario: Invalid service value
- **WHEN** an extension calls `spawn("Explore", brief, { context: "twin" })`
- **THEN** `spawn` throws an error naming `context` and no child starts

#### Scenario: Invalid frontmatter value
- **WHEN** an agent file declares `context: twin`
- **THEN** the agent loads with no declared context, and a warning names the file and `context`

### Requirement: Context resolution order
The context MUST resolve in this order:
1. an agent file that locks `context`;
2. the caller's value;
3. the agent file's value;
4. `fresh`.

The resolved context SHALL be carried on the launch request and the subagent record.

#### Scenario: Default is fresh
- **WHEN** a launch names no context and its agent file declares none
- **THEN** the launch runs `fresh`

#### Scenario: Caller wins over agent default
- **WHEN** an agent file declares `context: fork` without locking it and the caller passes `context: "fresh"`
- **THEN** the launch runs `fresh`

#### Scenario: Locked agent wins over caller
- **WHEN** an agent file declares `context: fork` and locks `context`, and the caller passes `context: "fresh"`
- **THEN** the launch runs `fork`

#### Scenario: Service option
- **WHEN** an extension calls `spawn("Explore", brief, { context: "fork" })` from a session with history
- **THEN** the launch runs `fork`

### Requirement: Deprecated context fields
For one minor release, the executor SHALL accept the old fields:
- `inherit_context: true` (tool parameter or frontmatter) and service `inheritContext: true` SHALL mean `fork`; `false` SHALL mean `fresh`;
- `context` MUST win when both `context` and the old field are given;
- frontmatter `prompt_mode` SHALL be ignored.

A deprecated field given by the caller SHALL count as a caller value.

#### Scenario: Old tool parameter
- **WHEN** a caller passes `inherit_context: true` and no `context`
- **THEN** the launch runs `fork` and a deprecation warning naming `context` is emitted

#### Scenario: Both given
- **WHEN** a caller passes `context: "fresh"` and `inherit_context: true`
- **THEN** the launch runs `fresh`

#### Scenario: Old service option
- **WHEN** an extension calls `spawn("Explore", brief, { inheritContext: false })`
- **THEN** the launch runs `fresh` and a deprecation warning naming `context` is emitted

#### Scenario: Old prompt mode ignored
- **WHEN** an agent file declares `prompt_mode: append` and no `context`
- **THEN** the agent loads, runs `fresh`, and a deprecation warning naming `prompt_mode` is emitted

### Requirement: Deprecation warnings
Each use of a deprecated field SHALL produce a warning that names its replacement: once per agent file per load for frontmatter, and once per session for each old tool parameter or service option.

#### Scenario: Warning once per session
- **WHEN** a caller passes `inherit_context: true` on three launches in one session
- **THEN** exactly one deprecation warning for `inherit_context` is emitted

### Requirement: Fresh child prompt
A `fresh` child's system prompt SHALL be, in this order:
1. the prompt Pi builds for the child's own session: its tools, the project context files for the child's working directory, and the skills catalog it loads;
2. the `<active_agent name="<agent>"/>` tag;
3. the environment header;
4. the agent body.

#### Scenario: Project instructions present
- **WHEN** the child's working directory has an `AGENTS.md` with a unique marker
- **THEN** the fresh child's system prompt contains that marker before the agent body

#### Scenario: Append file applied once
- **WHEN** the child's project has an `APPEND_SYSTEM.md` with a unique marker
- **THEN** the fresh child's system prompt contains that marker exactly once

#### Scenario: Agent body last
- **WHEN** a fresh child of an agent with body `BODY-MARKER` starts
- **THEN** the system prompt ends with `BODY-MARKER` and contains `<active_agent name="<agent>"/>` before it

### Requirement: Fresh child carries nothing from the parent
A `fresh` child's system prompt MUST NOT contain any part of the parent's system prompt that the child's own session would not produce. The child's first message MUST be the task, without any parent conversation.

#### Scenario: No parent identity
- **WHEN** the parent's system prompt contains a unique marker that no file in the child's directory contains, and a fresh child starts
- **THEN** the child's first request contains no copy of the marker

#### Scenario: No parent conversation
- **WHEN** the parent conversation contains a unique marker and a fresh child starts
- **THEN** the child's first request contains no copy of that marker and its only user message is the task

### Requirement: Fork child session
A `fork` child SHALL start from a copy of the parent's current branch:
- messages, tool calls, tool results and compaction summaries;
- taken from the live session, not the session file.

The fork's first provider request MUST carry:
- the parent's system prompt, unchanged;
- the parent's tool declarations, unchanged;
- the parent's session id as its provider cache-routing key (the session id Pi sends to the provider in headers or the payload).

#### Scenario: Same prefix as parent
- **WHEN** the parent's last provider request is captured and a fork starts on the same model
- **THEN** the fork's first request has a byte-identical system prompt and tool list, its messages begin with all of the parent's last-request messages in order, and its cache-routing session id equals the parent's

#### Scenario: Tool results inherited
- **WHEN** the parent conversation holds a tool result with a unique marker
- **THEN** the fork's first request contains that tool result as a tool result, not as text in a user message

#### Scenario: Fork before the parent has persisted
- **WHEN** the parent session has history but no assistant message has been written to its file yet
- **THEN** the fork still starts from the in-memory branch

### Requirement: Fork session identity
A fork SHALL have its own session id, distinct from the parent's and from every other fork's. That id MUST be used for its transcript file, its subagent record and the `subagents:child:*` events, so the parent is never recorded as a child.

#### Scenario: Own lifecycle id
- **WHEN** two forks start from the same parent
- **THEN** each has a session id different from the parent's and from each other's, each writes its own transcript file, and the parent session id is not reported as a child

### Requirement: Fork task message
After the copied branch, the fork SHALL add, in this order:
1. for every tool call still pending at the parent's leaf (`subagent` or any other tool), the tool result `Forked: this branch continues as a subagent.`;
2. one user message holding a `<subagent_instructions>` block, followed by the task. The block holds:
   - the `<active_agent>` tag;
   - the child's working directory;
   - the agent body;
   - the names of tools the agent allows but the fork cannot call;
   - the fork boundary.

#### Scenario: Parallel forks share the prefix
- **WHEN** two forks start from the same parent turn with different tasks
- **THEN** their first requests are identical up to and including the synthetic tool result, and differ only from the instructions message on

#### Scenario: Mixed pending calls
- **WHEN** the parent's leaf holds a pending `read` call and a pending `subagent` call
- **THEN** the fork's first request has a tool result for each, both with the fixed text, before the instructions message

#### Scenario: Agent-only tools named
- **WHEN** an agent allows `web_search` and the parent has no `web_search`
- **THEN** the fork's instructions message names `web_search` as unavailable

#### Scenario: Child directory stated
- **WHEN** a fork runs in a working directory different from the parent's
- **THEN** its instructions message names the child's directory

### Requirement: Fork model and thinking
A fork SHALL run on the parent's current model and thinking level unless a value with higher precedence applies. The order MUST be:
1. an agent-locked value;
2. the launch policy's adjustment (see `executor-launch-policy`);
3. the caller's value;
4. the parent's value.

The fork's requested value given to the launch policy SHALL be the agent-locked value, otherwise the caller's value, otherwise the parent's value.

An unlocked model or thinking in the agent file MUST NOT apply to a fork.

#### Scenario: Agent default ignored
- **WHEN** an agent file sets `model` without locking it and the agent is forked with no caller model
- **THEN** the fork runs on the parent's model

#### Scenario: Caller override
- **WHEN** the caller passes `model` for a fork
- **THEN** the fork runs on that model

#### Scenario: Locked agent model
- **WHEN** an agent file sets and locks `model`, and the caller passes another model for a fork
- **THEN** the fork runs on the agent's model

#### Scenario: Parent thinking kept
- **WHEN** the parent runs at thinking `high`, the agent file sets thinking `low` without locking it, and the fork has no caller thinking and no policy adjustment
- **THEN** the fork runs at thinking `high`

#### Scenario: Policy over caller
- **WHEN** the caller passes thinking `low` for a fork and the launch policy returns thinking `medium`
- **THEN** the fork runs at thinking `medium`

### Requirement: Fork tool limits
A fork SHALL declare exactly the parent's tools: it MUST NOT add a tool the agent allows but the parent lacks, nor protocol tools (`ask_parent`, `notify_parent`). Its callable tools SHALL be the parent's tools that survive every rule that would remove a tool from a fresh child (allowlist, `disallowed_tools`, policy removals, enforced assessment; policy grants kept), never including `subagent`, `get_subagent_result` or `steer_subagent`.

#### Scenario: Declarations unchanged
- **WHEN** a read-only agent is forked
- **THEN** its first request's tool list equals the parent's

#### Scenario: No protocol tools
- **WHEN** a fork starts with mid-run updates on
- **THEN** its tool list contains neither `ask_parent` nor `notify_parent`

### Requirement: Fork call-time refusal
Before a call runs, a fork MUST refuse any call to a tool that is not callable (see "Fork tool limits"). The refused call's result MUST be `Tool "<name>" is not available to this subagent.`

#### Scenario: Disallowed tool refused
- **WHEN** a read-only agent is forked from a parent that has `edit`, and the fork calls `edit`
- **THEN** no edit happens and the call's result is `Tool "edit" is not available to this subagent.`

#### Scenario: Nested spawn refused
- **WHEN** a fork calls `subagent`
- **THEN** no child starts and the call is refused with the same message

#### Scenario: Disallowed tool refused, not removed
- **WHEN** an agent declares `disallowed_tools: bash` and is forked from a parent with `bash`
- **THEN** the fork's tool list contains `bash` and a call to `bash` is refused

#### Scenario: Enforced assessment refuses
- **WHEN** tool assessment in `enforce` mode flags `edit` for a fork
- **THEN** the fork's tool list still contains `edit` and a call to `edit` is refused

### Requirement: Fork without a parent session
This requirement applies when a fork is requested and the parent has no session branch to copy.

- A fork from a caller value MUST fail before any child session is created, with `Cannot fork: the parent has no session to fork from.` Caller values include deprecated fields and service options.
- A fork from the agent file, locked or not, SHALL run `fresh` instead, record `contextFallback` `no-parent-session` on the subagent record, and show it as described in `subagent-run-facts`.

#### Scenario: Explicit fork fails
- **WHEN** a caller passes `context: "fork"` and the parent has no session branch
- **THEN** the launch fails with that message and no child session exists

#### Scenario: Agent default falls back
- **WHEN** an agent file declares `context: fork`, the caller names none, and the parent has no session branch
- **THEN** the launch runs `fresh` and the record carries `contextFallback` `no-parent-session`

### Requirement: Fork cache evidence
An evidence document under `docs/evidence/` SHALL record, from real provider runs, a fork's first-turn `usage.cacheRead` against the parent's last-request total input tokens (uncached input plus cache read plus cache write). A fork on the parent's model MUST read at least 90% of that total from cache. A fork with a model override is recorded, not bounded.

#### Scenario: Same-model fork reads the cache
- **WHEN** the evidence runs a fork on the parent's model on Anthropic
- **THEN** its recorded first-turn `cacheRead` is at least 90% of the parent's last-request total input tokens

### Requirement: Fork cache evidence matrix
The evidence SHALL cover Anthropic and one OpenAI-compatible provider, each with one fork, two parallel forks and one fork with a model override.

#### Scenario: Parallel forks
- **WHEN** two forks start from one parent turn on each provider
- **THEN** both recorded first-turn `cacheRead` values meet the 90% bound

### Requirement: Fork cache evidence conditions
Every bounded evidence run SHALL use a parent whose last request holds at least 8000 input tokens, start the fork within 60 seconds of that request, and apply no model, thinking or tool override.

#### Scenario: Short parent excluded
- **WHEN** a parent's last request holds 3000 input tokens
- **THEN** that run is not used for the 90% bound

### Requirement: Migration documentation
The change SHALL ship:
- the decision record `packages/pi-subagents/docs/decisions/0014-subagent-context-is-fresh-or-fork.md`, stating that it supersedes ADR 0008 and amends ADRs 0006, 0009, 0010 and 0011;
- a `CHANGELOG.md` migration section mapping `prompt_mode`, `inherit_context`, the service option `inheritContext` and `subagents.forkedLaunch` to their replacements.

#### Scenario: Decision record present
- **WHEN** the change is applied
- **THEN** ADR 0014 exists and ADR 0008's status names it as superseded by 0014

### Requirement: Old names gone from current docs
No current document in `docs/` or `packages/pi-subagents/` SHALL present `twin`, `prompt_mode` or `inherit_context` as current behaviour. Dated evidence, archived changes, accepted ADRs, changelog entries and sections that describe the deprecated aliases are exempt.

#### Scenario: Old names gone from current docs
- **WHEN** the docs are searched for `twin`, `prompt_mode` and `inherit_context`
- **THEN** every match is in an exempt document or in a section that describes the name as deprecated

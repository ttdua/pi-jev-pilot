## MODIFIED Requirements

### Requirement: Launch request given to the policy
The policy SHALL receive:
- `agentId`, and `agentType` as resolved.
- `agent`, the agent snapshot from `executor-agent-registry`.
- `origin`: `{ kind: "tool", toolCallId }` or `{ kind: "service" }`.
- `parentSessionId`.
- `prompt` and `description`.
- `requested`: the caller's `model` and `thinking` after `locked` fields were applied. For a fork, an unlocked field with no caller value is the parent's model or thinking.
- `locked`, the lockable fields the agent locks.
- `context`, the launch's resolved context (`fresh` or `fork`, after any fallback), and `isBackground`.
- `toolSet`, with:
  - `declared`: the agent's `tools`, or `null`;
  - `disallowed`;
  - `defaults`: the tools the child would get with no policy;
  - `parentTools`: the parent session's tool names, minus tools of extensions excluded by `excludedExtensionPackages`. Being listed does not guarantee the child will have the tool; see "Grants are checked in the child".
- An `AbortSignal`.

`parentTools` MUST exclude the executor's own orchestration tools: `subagent`, `get_subagent_result`, `steer_subagent`, `ask_parent` and `notify_parent`. The request MUST NOT carry `inheritContext`.

#### Scenario: Tool-call origin
- **WHEN** `subagent` call `call_7` launches agent `Explore` with `model` `fixture/fixture-main`
- **THEN** the policy receives `origin` `{ kind: "tool", toolCallId: "call_7" }`, `agentType` `Explore`, `context` `fresh` and `requested.model` `fixture/fixture-main`

#### Scenario: Orchestration tools never offered
- **WHEN** the parent session has `read`, `subagent` and `web_search`
- **THEN** `toolSet.parentTools` is `read` and `web_search`

#### Scenario: Excluded extension's tool not offered
- **WHEN** the parent has tool `deploy` from a package listed in `excludedExtensionPackages`
- **THEN** `toolSet.parentTools` does not contain `deploy`

#### Scenario: Locked caller value not requested
- **WHEN** the agent locks `model` and the caller asks for another model
- **THEN** `requested.model` is the agent's model and `locked` contains `model`

#### Scenario: Fork request
- **WHEN** a caller forks `Explore` with no model from a parent on `fixture/fixture-main`
- **THEN** the policy receives `context` `fork` and `requested.model` `fixture/fixture-main`

#### Scenario: Locked fork request
- **WHEN** an agent locks `model`, and a caller forks it passing another model
- **THEN** `requested.model` is the agent's model

#### Scenario: Fallen-back fork
- **WHEN** an agent default `fork` falls back to `fresh` for lack of a parent session
- **THEN** the policy receives `context` `fresh`

### Requirement: Applying the policy's adjustment
The policy SHALL return either nothing or an adjustment with optional `model`, `thinking`, `addTools` and `removeTools`. The executor SHALL apply these rules:
- A returned `model` or `thinking` replaces the requested value, unless that field is locked.
- `addTools` entries are applied only when they appear in `toolSet.parentTools` and not in `toolSet.disallowed`.
- `removeTools` entries are applied only when they do not appear in `toolSet.declared`.
- For a fork (see `subagent-context-mode`), an applied removal makes the tool refused when called instead of absent, so the fork's declarations stay the parent's. An applied grant makes a parent tool callable.
- For a fork, a returned `model` or `thinking` also takes precedence over the caller's value.
- Any entry that breaks these rules is dropped with a debug note; the rest of the adjustment still applies.
- Returning nothing leaves the launch unchanged.

A granted Pi built-in such as `codemode` SHALL load the built-in extension that supplies it, as when the agent names it in `tools`.

#### Scenario: Model and thinking applied
- **WHEN** the policy returns `model` `fixture/fixture-fast` and `thinking` `low`
- **THEN** the child's first provider request uses `fixture-fast` with reasoning effort `low`

#### Scenario: Locked field kept
- **WHEN** the agent locks `thinking` and the policy returns `thinking` `max`
- **THEN** the child runs with the agent's thinking and the executor writes a debug note

#### Scenario: Extension tool granted
- **WHEN** the agent declares no `tools`, the parent has extension tool `web_search`, and the policy returns `addTools` `web_search`
- **THEN** the child's first provider request offers `web_search`, and a call to it executes

#### Scenario: Declared tool not removable
- **WHEN** the agent declares `tools: read, edit` and the policy returns `removeTools` `edit`
- **THEN** the child offers `edit`

#### Scenario: Default tool removed
- **WHEN** the agent declares no `tools`, the launch is fresh, and the policy returns `removeTools` `bash`
- **THEN** the child does not offer `bash`, and a call to `bash` returns an error result

#### Scenario: Grant outside the parent's tools dropped
- **WHEN** the policy returns `addTools` `not_registered`
- **THEN** no tool is added, the launch runs, and the executor writes a debug note

#### Scenario: Removal in a fork
- **WHEN** the policy returns `removeTools` `bash` for a fork of an agent with no `tools`, from a parent with `bash`
- **THEN** the fork's first request still offers `bash`, and a call to `bash` is refused

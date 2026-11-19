## MODIFIED Requirements

### Requirement: Launch request given to the policy
The policy SHALL receive:
- `agentId`, and `agentType` as resolved.
- `agent`, the agent snapshot from `executor-agent-registry`.
- `origin`: `{ kind: "tool", toolCallId }` or `{ kind: "service" }`.
- `parentSessionId`.
- `prompt` and `description`.
- `metadata`, the caller's launch metadata from `launch-metadata`, frozen, only when the launch carries metadata. A launch without metadata, and every tool-call launch, MUST omit the field.
- `requested`: the caller's `model` and `thinking` after `locked` fields were applied. For a fork, an unlocked field with no caller value is the parent's model or thinking.
- `locked`, the lockable fields the agent locks.
- `context`, the launch's resolved context (`fresh` or `fork`, after any fallback), and `isBackground`.
- `toolSet`, with:
  - `declared`: the agent's `tools`, or `null`;
  - `disallowed`;
  - `defaults`: the tools the child would get with no policy;
  - `parentTools`: the parent session's tool names, minus tools of extensions excluded by `excludedExtensionPackages`. Being listed does not guarantee the child will have the tool; see "Grants are checked in the child".
- An `AbortSignal`.

`parentTools` MUST exclude the executor's own orchestration tools: `subagent`, `get_subagent_result`, `steer_subagent`, `ask_parent`, `notify_parent` and `submit_result`. The request MUST NOT carry `inheritContext`.

#### Scenario: Tool-call origin
- **WHEN** `subagent` call `call_7` launches agent `explore` with `model` `fixture/fixture-main`
- **THEN** the policy receives `origin` `{ kind: "tool", toolCallId: "call_7" }`, `agentType` `explore`, `context` `fresh` and `requested.model` `fixture/fixture-main`

#### Scenario: Orchestration tools never offered
- **WHEN** the parent session has `read`, `subagent` and `web_search`
- **THEN** `toolSet.parentTools` is `read` and `web_search`

#### Scenario: Protocol tools never offered
- **WHEN** the parent session has `read`, `ask_parent` and `submit_result`
- **THEN** `toolSet.parentTools` is `read`

#### Scenario: Excluded extension's tool not offered
- **WHEN** the parent has tool `deploy` from a package listed in `excludedExtensionPackages`
- **THEN** `toolSet.parentTools` does not contain `deploy`

#### Scenario: Locked caller value not requested
- **WHEN** the agent locks `model` and the caller asks for another model
- **THEN** `requested.model` is the agent's model and `locked` contains `model`

#### Scenario: Fork request
- **WHEN** a caller forks `explore` with no model from a parent on `fixture/fixture-main`
- **THEN** the policy receives `context` `fork` and `requested.model` `fixture/fixture-main`

#### Scenario: Locked fork request
- **WHEN** an agent locks `model`, and a caller forks it passing another model
- **THEN** `requested.model` is the agent's model

#### Scenario: Fallen-back fork
- **WHEN** an agent default `fork` falls back to `fresh` for lack of a parent session
- **THEN** the policy receives `context` `fresh`

#### Scenario: Service launch with metadata
- **WHEN** an extension calls `spawn("implementer", ...)` with `metadata` `{ "change": "c1" }`
- **THEN** the policy receives `origin` `{ kind: "service" }` and `metadata` `{ "change": "c1" }`, and writing to `metadata` throws or has no effect

#### Scenario: No metadata in the request
- **WHEN** a launch carries no metadata, or comes from a `subagent` tool call
- **THEN** the request has no `metadata` field

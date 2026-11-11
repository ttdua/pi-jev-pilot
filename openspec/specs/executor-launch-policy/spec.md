# executor-launch-policy Specification

## Purpose
One registered launch policy is consulted before every new child session, may set model, thinking and tools within the agent's locks and declarations, has its tool grants checked in the child, and fails open.

## Requirements

### Requirement: One launch policy slot
`SubagentsService` SHALL offer `registerLaunchPolicy(policy, options)`, where `options.timeoutMs` bounds each call. It SHALL return a function that unregisters the policy. While a policy is registered, a second registration MUST throw, and the first stays in place. After unregistering, a new policy MAY be registered.

#### Scenario: Second registration refused
- **WHEN** a policy is registered and another is registered without unregistering the first
- **THEN** the second call throws and launches still consult the first policy

#### Scenario: Unregister frees the slot
- **WHEN** a registered policy is unregistered and a new one is registered
- **THEN** the new registration succeeds and later launches consult it

### Requirement: When the policy runs
For every new launch, from a `subagent` tool call or from `SubagentsService.spawn()`, foreground or background, the executor SHALL call the registered policy once, after the record leaves the concurrency queue and before the child session is created, and SHALL await it. A resumed launch MUST NOT consult the policy. `spawn()` MUST still return the agent id without waiting for the policy.

#### Scenario: Tool-call launch
- **WHEN** a policy is registered and the main model launches a worker with `subagent`
- **THEN** the policy is called once before the child's session is created

#### Scenario: Service launch
- **WHEN** a policy is registered and an extension calls `spawn()`
- **THEN** `spawn()` returns an id at once, and the policy is called once before that child's session is created

#### Scenario: Queued launch
- **WHEN** the concurrency limit is reached and a background launch is queued
- **THEN** the policy is called only when that launch leaves the queue

#### Scenario: Resume
- **WHEN** the main model resumes an existing agent
- **THEN** the policy is not called

#### Scenario: No policy registered
- **WHEN** no policy is registered and a worker is launched
- **THEN** the launch runs as upstream would run it, except that `disallowed_tools` still applies

### Requirement: Launch request given to the policy
The policy SHALL receive:
- `agentId`, and `agentType` as resolved.
- `agent`, the agent snapshot from `executor-agent-registry`.
- `origin`: `{ kind: "tool", toolCallId }` or `{ kind: "service" }`.
- `parentSessionId`.
- `prompt` and `description`.
- `requested`: the caller's `model` and `thinking` after `locked` fields were applied.
- `locked`, the lockable fields the agent locks.
- `inheritContext` and `isBackground`.
- `toolSet`, with:
  - `declared`: the agent's `tools`, or `null`;
  - `disallowed`;
  - `defaults`: the tools the child would get with no policy;
  - `parentTools`: the parent session's tool names, minus tools of extensions excluded by `excludedExtensionPackages`. Being listed does not guarantee the child will have the tool; see "Grants are checked in the child".
- An `AbortSignal`.

`parentTools` MUST exclude the executor's own orchestration tools: `subagent`, `get_subagent_result`, `steer_subagent`, `ask_parent` and `notify_parent`.

#### Scenario: Tool-call origin
- **WHEN** `subagent` call `call_7` launches agent `Explore` with `model` `fixture/fixture-main`
- **THEN** the policy receives `origin` `{ kind: "tool", toolCallId: "call_7" }`, `agentType` `Explore` and `requested.model` `fixture/fixture-main`

#### Scenario: Orchestration tools never offered
- **WHEN** the parent session has `read`, `subagent` and `web_search`
- **THEN** `toolSet.parentTools` is `read` and `web_search`

#### Scenario: Excluded extension's tool not offered
- **WHEN** the parent has tool `deploy` from a package listed in `excludedExtensionPackages`
- **THEN** `toolSet.parentTools` does not contain `deploy`

#### Scenario: Locked caller value not requested
- **WHEN** the agent locks `model` and the caller asks for another model
- **THEN** `requested.model` is the agent's model and `locked` contains `model`

### Requirement: Applying the policy's adjustment
The policy SHALL return either nothing or an adjustment with optional `model`, `thinking`, `addTools` and `removeTools`. The executor SHALL apply these rules:
- A returned `model` or `thinking` replaces the requested value, unless that field is locked.
- `addTools` entries are applied only when they appear in `toolSet.parentTools` and not in `toolSet.disallowed`.
- `removeTools` entries are applied only when they do not appear in `toolSet.declared`.
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
- **WHEN** the agent declares no `tools` and the policy returns `removeTools` `bash`
- **THEN** the child does not offer `bash`, and a call to `bash` returns an error result

#### Scenario: Grant outside the parent's tools dropped
- **WHEN** the policy returns `addTools` `not_registered`
- **THEN** no tool is added, the launch runs, and the executor writes a debug note

### Requirement: Grants are checked in the child
After the child's extensions are bound and before its first provider request, the executor SHALL check each granted tool in the child. A grant takes effect only when the child registered a tool of that name whose exposure lets the model call it; the executor MUST NOT change a tool's exposure. Any other grant SHALL be dropped with a debug note. The executor SHALL report the tools actually granted as `grantedTools` on `subagents:child:bound`, so a consumer counts only grants that took effect.

#### Scenario: Grant of a tool the child cannot load
- **WHEN** the policy grants `parent_only`, a tool the parent's extension registers only in the main session
- **THEN** the child starts without `parent_only`, and `grantedTools` on `subagents:child:bound` omits it

#### Scenario: Grant of a hidden tool
- **WHEN** the policy grants a tool the child registers with an exposure the model cannot call
- **THEN** the grant is dropped and `grantedTools` omits it

#### Scenario: Grant that took effect
- **WHEN** the policy grants `web_search` and the child's extensions register it
- **THEN** `grantedTools` contains `web_search`

### Requirement: The policy fails open
If the policy throws, rejects, returns a value that is not an adjustment, or does not settle within `timeoutMs`, the executor SHALL launch as if no policy were registered and SHALL abort the signal it passed. When the launch is cancelled while the policy runs, the executor SHALL abort the signal and cancel the launch as upstream does. A failing policy MUST NOT fail, block beyond `timeoutMs`, or change the result of a launch.

#### Scenario: Policy throws
- **WHEN** the policy throws
- **THEN** the child runs with the requested model, thinking and tools

#### Scenario: Policy too slow
- **WHEN** `timeoutMs` is 200 and the policy settles after 1000 ms
- **THEN** the child session is created after about 200 ms with the requested values, and the policy's signal is aborted

#### Scenario: Malformed adjustment
- **WHEN** the policy returns `{ model: 42 }`
- **THEN** the child runs with the requested values

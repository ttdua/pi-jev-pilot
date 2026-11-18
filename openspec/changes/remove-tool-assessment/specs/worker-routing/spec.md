## MODIFIED Requirements

### Requirement: When routing runs
Worker routing SHALL act only inside its launch policy, for launches started from a main session. It MUST do nothing, and call Jev for nothing, when `config.json` is invalid, the API key is unset, the executor is absent or duplicated (see `readiness-checks`), or the `subagents` switch is off. These conditions SHALL be read fresh at each policy call. Doing nothing MUST mean returning no adjustment. The launch policy MUST NOT ask Jev about tools and MUST NOT return `addTools` or `removeTools`, so a worker gets exactly the tool set the executor resolves without a policy.

#### Scenario: Switch off
- **WHEN** the `subagents` switch is off and the main model launches a worker
- **THEN** no worker request is sent and the child runs with the requested model and thinking

#### Scenario: No key
- **WHEN** the API key is unset and the main model launches a worker
- **THEN** no worker request is sent and the child runs with the requested model and thinking

#### Scenario: Invalid config
- **WHEN** `config.json` is invalid and the main model launches a worker
- **THEN** no worker request is sent and the child runs with the requested model and thinking

#### Scenario: Executor absent
- **WHEN** the executor is not installed
- **THEN** no launch policy is registered and no worker request is sent

#### Scenario: Child session
- **WHEN** a child session's assistant message calls `subagent`
- **THEN** no worker request is sent

#### Scenario: Other tools ignored
- **WHEN** an assistant message calls only `read` and `bash`
- **THEN** no worker request is sent

#### Scenario: No tool questions or tool adjustment
- **WHEN** `config.json` holds a legacy `tools` section with `mode` `enforce` and a routed launch is decided
- **THEN** the worker request has no `tool::` or `grant::` question, no other request is sent for the launch, and the adjustment has no `addTools` or `removeTools`

#### Scenario: Routing off sends nothing about tools
- **WHEN** the `subagents` switch is off and a worker is launched
- **THEN** no Jev request is sent for the launch and the worker's tools are those the executor resolves without a policy

#### Scenario: Nested launch with the switch off
- **WHEN** the `subagents` switch is off and a codemode script calls `subagent`
- **THEN** no worker request is sent and the child runs with the requested model and thinking

### Requirement: Launch policy slot taken
When registering the launch policy throws, because another extension holds the slot, routing MUST stay off for that session, and `/jev` SHALL report `launch policy held by another extension`.

#### Scenario: Slot taken
- **WHEN** another extension registered a launch policy first
- **THEN** no worker request is sent for any launch, and `/jev` reports `launch policy held by another extension`

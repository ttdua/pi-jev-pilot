## MODIFIED Requirements

### Requirement: When routing runs
Worker routing SHALL act only inside its launch policy, for launches started from a main session. It MUST do nothing, and call Jev for nothing, when `config.json` is invalid, the API key is unset, the executor is absent or offers no launch policy (see `readiness-checks`), or the `subagents` switch is off. These conditions SHALL be read fresh at each policy call. Doing nothing MUST mean returning no adjustment. The launch policy MUST NOT ask Jev about tools and MUST NOT return `addTools` or `removeTools`, so a worker gets exactly the tool set the executor resolves without a policy.

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

#### Scenario: Executor without a launch policy
- **WHEN** the installed executor's service has no `registerLaunchPolicy`
- **THEN** no launch policy is registered, no worker request is sent, and every other feature keeps working

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

### Requirement: Routing fails open
Any Jev failure (timeout, error, unreadable answers) SHALL return no model and no thinking. A launch cancelled while its policy call runs MUST record nothing. An error inside routing itself MUST be caught, return no model and no thinking, and never block or fail the launch. If the policy call outlives its `timeoutMs`, the executor launches with the requested values (specified by the executor, `ttdua/pi-subagents` `executor-launch-policy`).

#### Scenario: Jev timeout
- **WHEN** Jev does not answer within `classifier.timeoutMs`
- **THEN** the child runs with the requested model and thinking, after at most `classifier.timeoutMs` of added wait plus the policy's own processing

#### Scenario: Timeout changed after session start
- **WHEN** `classifier.timeoutMs` is 1500 at session start, tuning raises it to 1700, and Jev answers a later launch after 1600 ms
- **THEN** that launch is routed with Jev's answer

#### Scenario: Jev error
- **WHEN** Jev answers HTTP 500
- **THEN** the child runs with the requested model and thinking

#### Scenario: Unreadable answers
- **WHEN** Jev answers a body without `answers`
- **THEN** the child runs with the requested model and thinking

#### Scenario: Turn cancelled
- **WHEN** the operator cancels the turn while a worker request is outstanding
- **THEN** no ledger line is recorded for that launch

#### Scenario: Internal error
- **WHEN** building the agent facts throws inside routing
- **THEN** the child runs with the requested model and thinking and is not blocked

### Requirement: Routing is the executor's launch policy
In a main session, the extension SHALL register its launch policy with the executor service captured at `session_start` when it offers `registerLaunchPolicy` (see `readiness-checks`; the contract is `ttdua/pi-subagents` `executor-launch-policy`), with a watchdog `timeoutMs` of 10000 ms. Each policy call SHALL read `classifier.timeoutMs` fresh and bound its Jev requests by that value, so a tuned or edited timeout applies to the next launch; the watchdog only guards against a policy that hangs. It SHALL unregister it at `session_shutdown` and before registering again. A child session MUST NOT register a policy.

#### Scenario: Registered at session start
- **WHEN** a main session starts with the executor present and offering a launch policy
- **THEN** the executor has exactly one launch policy registered, and it is this extension's

#### Scenario: Re-registered after reload
- **WHEN** the main session starts again after a reload
- **THEN** the earlier policy was unregistered and the new one is registered

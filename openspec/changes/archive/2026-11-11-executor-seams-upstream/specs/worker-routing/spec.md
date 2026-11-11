## ADDED Requirements

### Requirement: Routing is the executor's launch policy
In a main session, the extension SHALL register its launch policy with the executor service captured at `session_start` (see `executor-launch-policy`), with a watchdog `timeoutMs` of 10000 ms. Each policy call SHALL read `classifier.timeoutMs` fresh and bound its Jev requests by that value, so a tuned or edited timeout applies to the next launch; the watchdog only guards against a policy that hangs. It SHALL unregister it at `session_shutdown` and before registering again. A child session MUST NOT register a policy.

#### Scenario: Registered at session start
- **WHEN** a main session starts with the executor present
- **THEN** the executor has exactly one launch policy registered, and it is this extension's

#### Scenario: Re-registered after reload
- **WHEN** the main session starts again after a reload
- **THEN** the earlier policy was unregistered and the new one is registered


### Requirement: Launches routing acts on
The policy SHALL return nothing, and ask Jev nothing, for a launch whose `parentSessionId` is a recorded child session (see `child-registry`). For a launch with `origin.kind` `service` and a set `requested.model`, routing SHALL treat `model` as locked in the worker request, the route and the ledger line, exactly as for an agent that locks only `model` (see `worker-decision` "Locks in the route"). Every other launch SHALL be routed.

#### Scenario: Launch from a worker
- **WHEN** a worker's own `subagent` call launches a nested worker
- **THEN** the policy returns nothing and no worker request is sent

#### Scenario: Service launch with an explicit model
- **WHEN** an extension calls `spawn("Plan", brief, { model: "fixture/fixture-deep" })`, and Jev answers `tier` `fast` and `effort` `high`
- **THEN** the child runs on `fixture/fixture-deep` with reasoning effort `high`, and the ledger line has `locked` true

#### Scenario: Service launch without a model
- **WHEN** an extension calls `spawn("Plan", brief)` and Jev's answers cut to `fast` with effort `medium`
- **THEN** the child runs on `tiers.fast` with reasoning effort `medium`

### Requirement: Launch policy slot taken
When registering the launch policy throws, because another extension holds the slot, routing and tool assessment MUST stay off for that session, and `/jev` SHALL report `launch policy held by another extension`.

#### Scenario: Slot taken
- **WHEN** another extension registered a launch policy first
- **THEN** no worker request is sent for any launch, and `/jev` reports `launch policy held by another extension`

## MODIFIED Requirements

### Requirement: When routing runs
Worker routing SHALL act only inside its launch policy, for launches started from a main session. It MUST do nothing, and call Jev for nothing, when `config.json` is invalid, the API key is unset, the executor is absent or duplicated (see `readiness-checks`), or the `subagents` switch is off. These conditions SHALL be read fresh at each policy call. Doing nothing MUST mean returning no adjustment, unless tool assessment returns one (see `tool-assessment`).

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

#### Scenario: Nested launch with the switch off
- **WHEN** the `subagents` switch is off and a codemode script calls `subagent`
- **THEN** no worker request is sent and the child runs with the requested model and thinking

### Requirement: Worker request content
Each worker request SHALL use the agent facts built from the launch request's agent snapshot, the worker state from the launch request's `prompt` and `description`, and its `isBackground`. The display names for the `tier` criteria of tiers and slots (see `worker-request`) MUST come from Pi's model registry. `parent_request` MUST be included only when `state.parentRequest` is on, from the latest user message. A thinking-only launch MUST ask only `effort` and `risky`.

#### Scenario: Display name prefix
- **WHEN** `tiers.fast` names a registry model whose display name is `Fixture Fast`
- **THEN** the `fast` criterion in the request starts with `Fixture Fast. `

#### Scenario: Slot display name
- **WHEN** slot `reviewer` names a registry model whose display name is `Fixture Review`
- **THEN** the `slot::reviewer` criterion in the request starts with `Fixture Review (a custom model). `

#### Scenario: Parent request off
- **WHEN** `state.parentRequest` is off
- **THEN** the request state has no `parent_request`

#### Scenario: Forked launch with thinking asks fewer questions
- **WHEN** a launch inherits context and `subagents.forkedLaunch` is `thinking`
- **THEN** the request asks exactly `effort` and `risky`

#### Scenario: Service launch content
- **WHEN** an extension calls `spawn("Plan", brief, { description: "probe" })`
- **THEN** the worker request's agent is `Plan` and its state is built from `brief` and `probe`

### Requirement: Input mutation
Routing SHALL return the route's model as the adjustment's `model` and its thinking as `thinking`, and MUST return no other launch field. A route that writes nothing MUST return neither, so the launch runs with the requested values.

#### Scenario: Caller model replaced
- **WHEN** the caller set `model` `fixture/fixture-main` and the route writes `fixture/fixture-fast` with thinking `medium`
- **THEN** the child's first request uses `fixture-fast` with reasoning effort `medium`

#### Scenario: Background launch
- **WHEN** the same launch runs with `run_in_background` true
- **THEN** the child's first request uses the routed model and thinking

#### Scenario: Resume untouched
- **WHEN** a launch sets `resume`
- **THEN** the policy is not called and the resumed worker keeps its model and thinking

#### Scenario: Effective values recorded
- **WHEN** the route writes `fixture/fixture-fast` with thinking `medium` and the child starts
- **THEN** the worker's ledger line has `effectiveModel` `fixture/fixture-fast` and `effectiveThinking` `medium`

### Requirement: Routing fails open
Any Jev failure (timeout, error, unreadable answers) SHALL return no model and no thinking. A launch cancelled while its policy call runs MUST record nothing. An error inside routing itself MUST be caught, return no model and no thinking, and never block or fail the launch. If the policy call outlives its `timeoutMs`, the executor launches with the requested values (see `executor-launch-policy`).

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

### Requirement: Mode of a launch
Routing SHALL read the mode once per launch, when its policy call builds the worker request, and MUST use that same mode for the launch's cut points and its ledger line. A mode change after the request is built MUST NOT affect that launch. A launch left untouched SHALL record the mode read when its policy call ran.

#### Scenario: Premium launch end to end
- **WHEN** the mode is `premium`, all four tiers are configured, the window uses the seed (`premium` `expertMin` 2.12), and Jev answers `tier` with probabilities `deep` .9 and `balanced` .1, and `effort` `xhigh`
- **THEN** the request is the same as in `standard`, the child runs on `tiers.expert`, and the ledger line has `mode` `premium`, `reason` `expert` and a `score` of 2.275

#### Scenario: Mode changed between message end and launch
- **WHEN** a worker request is built in `standard`, then `state.json` is changed to `premium` before the child session is created
- **THEN** the ledger line has `mode` `standard`

#### Scenario: Jev down in premium
- **WHEN** the mode is `premium` and Jev does not answer
- **THEN** the launch keeps the requested values, and the ledger line has `mode` `premium`, `reason` `miss` and no `score`

### Requirement: Cut points of a launch
Routing SHALL compute each launch's cut points once, from the window as it is when that launch's policy call starts and the mode read for that launch. The decision and the ledger line MUST use those cut points even if the window changes before the launch completes.

#### Scenario: Siblings share a window state
- **WHEN** an assistant message ends with two `subagent` calls and neither launch has written a line when the other's policy call starts
- **THEN** both use cut points from the same window state

#### Scenario: Launch classified alone
- **WHEN** a codemode script calls `subagent` after an earlier launch of the session added a line to the window
- **THEN** that launch's cut points include the added line

## REMOVED Requirements

### Requirement: Sibling launches classified together
**Reason**: The launch policy is called per launch, after the record leaves the queue, so there is no message-end batch. Concurrent launches still run their worker requests concurrently.
**Migration**: "Routing is the executor's launch policy".

### Requirement: Launches without a cached result
**Reason**: Every launch, nested or not, is classified in its own policy call.
**Migration**: "Launches routing acts on".

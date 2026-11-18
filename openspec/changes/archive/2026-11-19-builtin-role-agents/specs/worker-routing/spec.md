## MODIFIED Requirements

### Requirement: Worker request content
Each worker request SHALL be built from:
- the agent facts built from the launch request's agent snapshot;
- the worker state, from the launch request's `prompt` and `description`;
- its `isBackground`.

The display names for the `tier` criteria of tiers and slots (see `worker-request`) MUST come from Pi's model registry. `parent_request` MUST be included only when `state.parentRequest` is on, from the latest user message. A thinking-only launch MUST ask only `effort` and `risky`.

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
- **WHEN** a launch's context is `fork` and `subagents.forkLaunch` is `thinking`
- **THEN** the request asks exactly `effort` and `risky`

#### Scenario: Service launch content
- **WHEN** an extension calls `spawn("implementer", brief, { description: "probe" })`
- **THEN** the worker request's agent is `implementer` and its state is built from `brief` and `probe`

### Requirement: Launches routing acts on
The policy SHALL return nothing, and ask Jev nothing, for a launch whose `parentSessionId` is a recorded child session (see `child-registry`). For a launch with `origin.kind` `service` and a set `requested.model`, routing SHALL treat `model` as locked in the worker request, the route and the ledger line, exactly as for an agent that locks only `model` (see `worker-decision` "Locks in the route"). Every other launch SHALL be routed.

#### Scenario: Launch from a worker
- **WHEN** a worker's own `subagent` call launches a nested worker
- **THEN** the policy returns nothing and no worker request is sent

#### Scenario: Service launch with an explicit model
- **WHEN** an extension calls `spawn("implementer", brief, { model: "fixture/fixture-deep" })`, and Jev answers `tier` `fast` and `effort` `high`
- **THEN** the child runs on `fixture/fixture-deep` with reasoning effort `high`, and the ledger line has `locked` true

#### Scenario: Service launch without a model
- **WHEN** an extension calls `spawn("implementer", brief)` and Jev's answers cut to `fast` with effort `medium`
- **THEN** the child runs on `tiers.fast` with reasoning effort `medium`

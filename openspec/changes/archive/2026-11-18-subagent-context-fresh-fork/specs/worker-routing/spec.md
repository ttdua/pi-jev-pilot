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
- **WHEN** an extension calls `spawn("Plan", brief, { description: "probe" })`
- **THEN** the worker request's agent is `Plan` and its state is built from `brief` and `probe`

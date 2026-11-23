## MODIFIED Requirements

### Requirement: Worker request content
Each worker request SHALL be built from:
- the agent facts built from the launch request's agent snapshot;
- the worker state, from the launch request's `prompt` and `description`;
- its `isBackground`;
- its `requested.maxTurns` and `locked`, which decide whether `turns` is asked (see `worker-decision` "Turn limit of a launch").

The display names for the `tier` criteria of tiers and slots (see `worker-request`) MUST come from Pi's model registry. `parent_request` MUST be included only when `state.parentRequest` is on, from the latest user message. A thinking-only launch MUST ask only `effort` and `risky`, plus `turns` when it can raise its turn limit. A launch that can raise its turn limit SHALL ask `turns`; one that cannot MUST NOT.

#### Scenario: Display name prefix
- **WHEN** `tiers.basic` names a registry model whose display name is `Fixture Basic`
- **THEN** the `basic` criterion in the request starts with `Fixture Basic. `

#### Scenario: Slot display name
- **WHEN** slot `reviewer` names a registry model whose display name is `Fixture Review`
- **THEN** the `slot::reviewer` criterion in the request starts with `Fixture Review (a custom model). `

#### Scenario: Parent request off
- **WHEN** `state.parentRequest` is off
- **THEN** the request state has no `parent_request`

#### Scenario: Forked launch with thinking asks fewer questions
- **WHEN** a launch's context is `fork`, `subagents.forkLaunch` is `thinking`, and the launch has no turn limit
- **THEN** the request asks exactly `effort` and `risky`

#### Scenario: Service launch content
- **WHEN** an extension calls `spawn("implementer", brief, { description: "probe" })`
- **THEN** the worker request's agent is `implementer` and its state is built from `brief` and `probe`

#### Scenario: Limited launch asks turns
- **WHEN** the main model launches a worker with `max_turns` 20 and `tiers.basic` configured
- **THEN** the request asks `tier`, `effort`, `risky` and `turns`

#### Scenario: Unlimited launch does not ask turns
- **WHEN** the main model launches a worker with no `max_turns`, and neither the agent nor the executor sets a limit
- **THEN** the request has no `turns` question

### Requirement: Input mutation
Routing SHALL return the route's model as the adjustment's `model`, its thinking as `thinking` and its turn write as `maxTurns`, and MUST return no other launch field. A route that writes nothing MUST return none of them, so the launch runs with the requested values.

#### Scenario: Caller model replaced
- **WHEN** the caller set `model` `fixture/fixture-main` and the route writes `fixture/fixture-fast` with thinking `medium`
- **THEN** the child's first request uses `fixture-fast` with reasoning effort `medium`

#### Scenario: Background launch
- **WHEN** the same launch runs with `run_in_background` true
- **THEN** the child's first request uses the routed model and thinking

#### Scenario: Resume untouched
- **WHEN** a launch sets `resume`
- **THEN** the policy is not called and the resumed worker keeps its model, thinking and turn limit

#### Scenario: Effective values recorded
- **WHEN** the route writes `fixture/fixture-fast` with thinking `medium` and the child starts
- **THEN** the worker's ledger line has `effectiveModel` `fixture/fixture-fast` and `effectiveThinking` `medium`

#### Scenario: Turn limit raised
- **WHEN** the main model launches a worker with `max_turns` 20 and Jev rates its brief `long` (floor 100)
- **THEN** the adjustment has `maxTurns` 100, and the executor's record of the run has `turnBudget.maxTurns` 100

#### Scenario: Switch off keeps the turn limit
- **WHEN** the `subagents` switch is off and a worker is launched with `max_turns` 20
- **THEN** no worker request is sent and the child runs with a turn limit of 20

#### Scenario: Turn limit left alone
- **WHEN** a worker is launched with no limit, or with `max_turns` locked by its agent, or with `max_turns` 120 while the floor is 100
- **THEN** the adjustment has no `maxTurns`

### Requirement: Routing fails open
Any Jev failure (timeout, error, unreadable answers) SHALL return no model, no thinking and no `maxTurns`. A launch cancelled while its policy call runs MUST record nothing. An error inside routing itself MUST be caught, return no model, no thinking and no `maxTurns`, and never block or fail the launch. If the policy call outlives its `timeoutMs`, the executor launches with the requested values (specified by the executor, `ttdua/pi-subagents` `executor-launch-policy`).

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

#### Scenario: Jev failure keeps the turn limit
- **WHEN** a worker is launched with `max_turns` 20 and Jev answers HTTP 500
- **THEN** the child runs with the requested model, thinking and a turn limit of 20

#### Scenario: Turns unanswered
- **WHEN** a worker is launched with `max_turns` 20, and Jev answers `tier` and `effort` but not `turns`
- **THEN** the model and thinking are routed as without a turn limit, and the adjustment has no `maxTurns`

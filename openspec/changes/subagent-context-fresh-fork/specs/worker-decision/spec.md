## MODIFIED Requirements

### Requirement: Launches left untouched
The route SHALL return `untouched` in each of these cases:
- (a) the launch's context is `fork` and the fork launch setting (`subagents.forkLaunch`) is `untouched`;
- (b) the agent locks both `model` and `thinking`;
- (c) the agent locks `thinking`, and either the launch is a fork with the setting `thinking`, or neither a tier nor a slot is offered.

Here "locks" includes `model` treated as locked for a service launch with an explicit model (see `worker-routing`).

These checks MUST be decidable before Jev is asked, so an untouched launch sends no worker request. A resumed launch never reaches the route, because the executor does not consult the launch policy for it.

#### Scenario: Resume
- **WHEN** the launch resumes an agent
- **THEN** no route is computed and no worker request is sent

#### Scenario: Forked launch left alone
- **WHEN** the effective launch is a fork and the setting is `untouched`
- **THEN** the route is `untouched`

#### Scenario: Both fields locked
- **WHEN** the agent locks both `model` and `thinking`
- **THEN** the route is `untouched`

#### Scenario: Service launch with a model and locked thinking
- **WHEN** a service launch names a model and the agent locks `thinking`
- **THEN** the route is `untouched`

#### Scenario: Forked thinking with thinking locked
- **WHEN** the launch is a fork, the setting is `thinking`, and the agent locks `thinking`
- **THEN** the route is `untouched`

#### Scenario: Slot alone with thinking locked
- **WHEN** only slot `reviewer` is offered and the agent locks `thinking`
- **THEN** the route is not `untouched`, and the `tier` question is asked

### Requirement: Route writes thinking only
The route SHALL write no model, and record reason `untouched`, in each of these cases:
- the launch is a fork with the setting `thinking`;
- neither a tier nor a slot is offered;
- the `tier` question is asked but no target is decided.

Unless `thinking` is locked, the route MUST write the worker effort, computed without the `fast` cap, as thinking without clamping, since the model that runs is not known here. When no effort is requested, or `thinking` is locked, it MUST write nothing.

#### Scenario: Forked launch with thinking
- **WHEN** the launch is a fork, the setting is `thinking`, `effort.choice` is `medium` and `risky` is .9
- **THEN** the route writes thinking `high` and no model, recording reason `untouched` and effort `high`

#### Scenario: No tier offered
- **WHEN** no tier and no slot is offered and `effort.choice` is `max`
- **THEN** the route writes thinking `xhigh` and no model

#### Scenario: No tier decided
- **WHEN** tiers are offered, `tier` is unanswered, `risky` is .2 and `effort.choice` is `medium`
- **THEN** the route writes thinking `medium` and no model, with reason `untouched` and no tier

#### Scenario: Slot below the bar with no tier
- **WHEN** only slot `reviewer` is offered, `tier.choice` is `slot::reviewer` at .5 and `effort.choice` is `medium`
- **THEN** the route writes thinking `medium` and no model, with reason `untouched` and no tier

#### Scenario: No effort answer
- **WHEN** the route writes thinking only and `effort` is unanswered
- **THEN** the route writes nothing

#### Scenario: No tier decided with thinking locked
- **WHEN** tiers are offered, no tier is decided and the agent locks `thinking`
- **THEN** the route writes nothing, recording reason `untouched` and locked

#### Scenario: Jev fails for a fork with thinking
- **WHEN** the launch is a fork with the setting `thinking` and Jev times out
- **THEN** the route writes neither model nor thinking, and records reason `miss`

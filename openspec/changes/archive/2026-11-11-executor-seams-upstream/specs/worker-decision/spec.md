## MODIFIED Requirements

### Requirement: Launches left untouched
The route SHALL return `untouched` in each of these cases: (a) it inherits context and the forked launch setting is `untouched`; (b) the agent locks both `model` and `thinking`; (c) the agent locks `thinking`, and either the launch inherits context with the setting `thinking`, or neither a tier nor a slot is offered. Here "locks" includes `model` treated as locked for a service launch with an explicit model (see `worker-routing`). These checks MUST be decidable before Jev is asked, so an untouched launch sends no worker request. A resumed launch never reaches the route, because the executor does not consult the launch policy for it.

#### Scenario: Resume
- **WHEN** the launch resumes an agent
- **THEN** no route is computed and no worker request is sent

#### Scenario: Forked launch left alone
- **WHEN** the effective launch inherits context and the setting is `untouched`
- **THEN** the route is `untouched`

#### Scenario: Both fields locked
- **WHEN** the agent locks both `model` and `thinking`
- **THEN** the route is `untouched`

#### Scenario: Service launch with a model and locked thinking
- **WHEN** a service launch names a model and the agent locks `thinking`
- **THEN** the route is `untouched`

#### Scenario: Forked thinking with thinking locked
- **WHEN** the launch inherits context, the setting is `thinking`, and the agent locks `thinking`
- **THEN** the route is `untouched`

#### Scenario: Slot alone with thinking locked
- **WHEN** only slot `reviewer` is offered and the agent locks `thinking`
- **THEN** the route is not `untouched`, and the `tier` question is asked

### Requirement: Route result
A pure launch route SHALL return one of: `untouched` (nothing to write, nothing asked), `skip` (nothing to write or record), or `routed`, which carries an optional `model` and `thinking` to write, and what to record: `reason`, and optionally `tier`, `fallback`, `effort` (the thinking written) and `locked`. For `routed` and `untouched` results alike, `locked` MUST be true when the agent locks `model` or `thinking`, or when the launch is a service launch naming a model (see `worker-routing`), and absent otherwise.

#### Scenario: Locked flag
- **WHEN** the agent locks `thinking` only and the launch is routed
- **THEN** the result marks `locked` true

#### Scenario: Locked untouched launch
- **WHEN** the agent locks both `model` and `thinking`
- **THEN** the result is `untouched` and marks `locked` true

#### Scenario: No lock
- **WHEN** the agent locks nothing, the launch is not a service launch naming a model, and it is routed
- **THEN** the result has no `locked`

#### Scenario: Service launch naming a model
- **WHEN** an extension's `spawn()` names a model for an agent that locks nothing, and the launch is routed
- **THEN** the result marks `locked` true

### Requirement: Locks in the route
When the agent locks `model` but not `thinking`, the route SHALL still decide and record the target and reason, and MUST NOT write a model or apply fallback; it MUST write thinking as the thinking-only route does. When the agent locks `thinking` but not `model`, the route MUST write the model and no thinking, and record no effort; if no tier is decided it writes nothing. A service launch that names a model (see `worker-routing`) SHALL count as locking `model` for this rule, for the questions asked, and for the ledger's `locked` field.

#### Scenario: Model locked
- **WHEN** the agent locks `model`, the score cuts to `fast` and `effort.choice` is `high`
- **THEN** the route writes thinking `high` and no model, recording tier `fast`, reason `cut` and locked

#### Scenario: Model locked without a decided tier
- **WHEN** the agent locks `model` and no tier is decided
- **THEN** the route records reason `untouched`, no tier, and locked

#### Scenario: Thinking locked
- **WHEN** the agent locks `thinking` and the decided tier is `fast`
- **THEN** the route writes the `fast` model and no thinking, recording no effort and locked

#### Scenario: Model locked with a slot decided
- **WHEN** the agent locks `model`, `tier.choice` is `slot::reviewer` at .9 and `effort.choice` is `high`
- **THEN** the route writes thinking `high` and no model, recording tier `slot::reviewer`, reason `slot` and locked, with no fallback

#### Scenario: Service launch with a model
- **WHEN** an extension's `spawn()` names `fixture/fixture-deep` for an agent that locks nothing, the score cuts to `fast` and `effort.choice` is `high`
- **THEN** the route writes thinking `high` and no model, recording tier `fast`, reason `cut` and locked

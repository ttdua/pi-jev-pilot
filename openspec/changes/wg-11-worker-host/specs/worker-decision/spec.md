## ADDED Requirements

### Requirement: Supported thinking levels
A pure function SHALL list a model's supported thinking levels as Pi does. A model without reasoning MUST support only `off`. `xhigh` and `max` MUST count as supported only when the model's thinking level map names them, and a level the map sets to `null` MUST NOT count as supported.

#### Scenario: Non-reasoning levels
- **WHEN** a model has no reasoning
- **THEN** its supported levels are exactly `off`

#### Scenario: Default reasoning levels
- **WHEN** a reasoning model has no thinking level map
- **THEN** its supported levels are `off`, `minimal`, `low`, `medium`, `high`

### Requirement: Thinking clamp
A pure function SHALL clamp a requested level to a model's supported levels with the same result as Pi's clamp: the requested level when supported, else the next higher supported level, else the next lower, else the first supported level.

#### Scenario: Supported level kept
- **WHEN** `high` is requested for a reasoning model with no thinking level map
- **THEN** the result is `high`

#### Scenario: Ceiling without a map entry
- **WHEN** `xhigh` is requested for a reasoning model whose map does not name `xhigh` or `max`
- **THEN** the result is `high`

#### Scenario: Mapped xhigh
- **WHEN** `xhigh` is requested for a reasoning model whose map names `xhigh`
- **THEN** the result is `xhigh`

#### Scenario: Level disabled in the map
- **WHEN** `low` is requested for a reasoning model whose map sets `low` to `null`
- **THEN** the result is `medium`

#### Scenario: Non-reasoning model
- **WHEN** `high` is requested for a model without reasoning
- **THEN** the result is `off`

#### Scenario: Parity with Pi
- **WHEN** every level from `off` to `max` is clamped for several model shapes
- **THEN** each result equals Pi's clamp for the same model and level

### Requirement: Route result
A pure launch route SHALL return one of: `untouched` (nothing to write, nothing asked), `skip` (nothing to write or record), or `routed`, which carries an optional `model` and `thinking` to write, and what to record: `reason`, and optionally `tier`, `fallback`, `effort` (the thinking written) and `locked`. For `routed` and `untouched` results alike, `locked` MUST be true when the agent locks `model` or `thinking`, and absent otherwise.

#### Scenario: Locked flag
- **WHEN** the agent locks `thinking` only and the launch is routed
- **THEN** the result marks `locked` true

#### Scenario: Locked untouched launch
- **WHEN** the agent locks both `model` and `thinking`
- **THEN** the result is `untouched` and marks `locked` true

#### Scenario: No lock
- **WHEN** the agent locks nothing and the launch is routed
- **THEN** the result has no `locked`

### Requirement: Launches left untouched
The route SHALL return `untouched` in each of these cases: (a) the effective launch resumes an agent; (b) it inherits context and the forked launch setting is `untouched`; (c) the agent locks both `model` and `thinking`; (d) the agent locks `thinking`, and either the launch inherits context with the setting `thinking`, or no tier is offered. These checks MUST be decidable before Jev is asked, so an untouched launch sends no worker request.

#### Scenario: Resume
- **WHEN** the effective launch has `resume`
- **THEN** the route is `untouched`

#### Scenario: Forked launch left alone
- **WHEN** the effective launch inherits context and the setting is `untouched`
- **THEN** the route is `untouched`

#### Scenario: Both fields locked
- **WHEN** the agent locks both `model` and `thinking`
- **THEN** the route is `untouched`

#### Scenario: Forked thinking with thinking locked
- **WHEN** the launch inherits context, the setting is `thinking`, and the agent locks `thinking`
- **THEN** the route is `untouched`

### Requirement: Route on Jev failure
When the worker answers are cancelled, the route SHALL be `skip`. When they are a miss, the route MUST write nothing and record reason `miss` with no `tier`.

#### Scenario: Cancelled
- **WHEN** the answers are cancelled
- **THEN** the route is `skip`

#### Scenario: Miss
- **WHEN** the answers are a `timeout` miss
- **THEN** the route writes neither model nor thinking, and records reason `miss` and no tier

### Requirement: Route writes thinking only
The route SHALL write no model and record reason `untouched` when the launch inherits context with the setting `thinking`, when no tier is offered, or when tiers are offered but no tier is decided. Unless `thinking` is locked, it MUST write the worker effort, computed without the `fast` cap, as thinking without clamping, since the model that runs is not known here. When no effort is requested, or `thinking` is locked, it MUST write nothing.

#### Scenario: Forked launch with thinking
- **WHEN** the launch inherits context, the setting is `thinking`, `effort.choice` is `medium` and `risky` is .9
- **THEN** the route writes thinking `high` and no model, recording reason `untouched` and effort `high`

#### Scenario: No tier offered
- **WHEN** no tier is offered and `effort.choice` is `max`
- **THEN** the route writes thinking `xhigh` and no model

#### Scenario: No tier decided
- **WHEN** tiers are offered, `tier` is unanswered, `risky` is .2 and `effort.choice` is `medium`
- **THEN** the route writes thinking `medium` and no model, with reason `untouched` and no tier

#### Scenario: No effort answer
- **WHEN** the route writes thinking only and `effort` is unanswered
- **THEN** the route writes nothing

#### Scenario: No tier decided with thinking locked
- **WHEN** tiers are offered, no tier is decided and the agent locks `thinking`
- **THEN** the route writes nothing, recording reason `untouched` and locked

### Requirement: Routed launch
When a tier is decided and `model` is not locked, the route SHALL choose the fallback over the tiers that can run, compute the worker effort with whether fallback moved the tier, and clamp it to the final tier's model. It MUST write that tier's model and the clamped thinking, and record the final tier, the deciding reason, the clamped effort, and `fallback` when it moved.

#### Scenario: Chosen tier written
- **WHEN** `tier.choice` is `balanced` at .95, `effort.choice` is `high`, and `balanced` can run on a model supporting up to `high`
- **THEN** the route writes the `balanced` model and thinking `high`, recording tier `balanced` and reason `choice`

#### Scenario: Clamped to the model
- **WHEN** the final tier's model supports levels up to `high` and the requested effort is `xhigh`
- **THEN** the route writes thinking `high` and records effort `high`

#### Scenario: Cascade with xhigh
- **WHEN** the decided tier is `deep`, `deep` cannot run, `balanced` can, and `effort.choice` is `low`
- **THEN** the route writes the `balanced` model with `xhigh` clamped to that model, recording tier `balanced` and fallback `deep`

### Requirement: Nothing can run
When no tier from the decided one down can run, the route SHALL write nothing and record the decided tier, its deciding reason, and `fallback` naming the decided tier, with no `effort`. `expert` MUST never be the tier that runs instead.

#### Scenario: All lower tiers unusable
- **WHEN** the decided tier is `balanced` and neither `balanced` nor `fast` can run
- **THEN** the route writes nothing, recording tier `balanced`, reason `choice` and fallback `balanced`

#### Scenario: Expert never a cascade target
- **WHEN** the decided tier is `deep` by the risk floor, `deep` cannot run, and only `expert` can run
- **THEN** the route writes nothing, recording tier `deep`, reason `risky` and fallback `deep`

### Requirement: Locks in the route
When the agent locks `model` but not `thinking`, the route SHALL still decide and record the tier and reason, and MUST NOT write a model or apply fallback; it MUST write thinking as the thinking-only route does. When the agent locks `thinking` but not `model`, the route MUST write the model and no thinking, and record no effort; if no tier is decided it writes nothing.

#### Scenario: Model locked
- **WHEN** the agent locks `model`, the decided tier is `fast` at .9 and `effort.choice` is `high`
- **THEN** the route writes thinking `high` and no model, recording tier `fast`, reason `choice` and locked

#### Scenario: Model locked without a decided tier
- **WHEN** the agent locks `model` and no tier is decided
- **THEN** the route records reason `untouched`, no tier, and locked

#### Scenario: Thinking locked
- **WHEN** the agent locks `thinking` and the decided tier is `fast`
- **THEN** the route writes the `fast` model and no thinking, recording no effort and locked

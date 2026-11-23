## ADDED Requirements

### Requirement: Turn limit of a launch
A launch SHALL be able to raise its turn limit exactly when the executor's launch request carries a number in `requested.maxTurns` and its `locked` list does not include `max_turns`. A launch without `requested.maxTurns` (an unlimited launch, or an executor that does not send it) MUST NOT be able to raise.

#### Scenario: Limited launch
- **WHEN** `requested.maxTurns` is 20 and the agent locks nothing
- **THEN** the launch can raise its turn limit

#### Scenario: Unlimited launch
- **WHEN** the launch request has no `requested.maxTurns`
- **THEN** the launch cannot raise its turn limit

#### Scenario: Locked limit
- **WHEN** `requested.maxTurns` is 20 and the agent locks `max_turns`
- **THEN** the launch cannot raise its turn limit

### Requirement: Turn floor
A pure function SHALL compute a turn floor from the `turns` probabilities, never from confidence or `turns.choice` alone. Band floors: `short` none, `medium` 40, `long` 100, `very_long` 200. From `very_long` down to `medium`, the floor MUST be that of the first band whose probability plus those of all higher bands is at least .5; otherwise, or when unanswered, there SHALL be no floor. Missing bands count as 0; no normalising.

#### Scenario: Long by majority
- **WHEN** the `turns` probabilities are `short` .1, `medium` .2, `long` .6 and `very_long` .1
- **THEN** the floor is 100

#### Scenario: Thin tail does not raise
- **WHEN** the `turns` probabilities are `short` .6, `medium` .1, `long` .1 and `very_long` .2
- **THEN** there is no floor

#### Scenario: Cumulative at the bar
- **WHEN** the `turns` probabilities are `short` .5, `medium` .2, `long` .2 and `very_long` .1
- **THEN** the floor is 40, since `medium` and above sum to exactly .5

#### Scenario: Choice is not enough
- **WHEN** `turns.choice` is `long` with probability .4, and the probabilities are `short` .35, `medium` .25, `long` .4, `very_long` 0
- **THEN** the floor is 40, since `long` and above sum to .4 and `medium` and above to .65

#### Scenario: Very long
- **WHEN** the `turns` probabilities are `long` .3 and `very_long` .7
- **THEN** the floor is 200

#### Scenario: Probabilities not normalised
- **WHEN** the `turns` probabilities are `short` .4, `medium` .2 and `long` .2, summing to .8
- **THEN** there is no floor, since `medium` and above sum to .4 and the probabilities are not scaled up to 1

#### Scenario: Unanswered
- **WHEN** `turns` is unanswered
- **THEN** there is no floor

### Requirement: Turn write
The route SHALL write `maxTurns` equal to the turn floor only when the launch can raise its turn limit and the floor is greater than `requested.maxTurns`, and record that value as `turnFloor`. Otherwise it MUST write no `maxTurns` and record no `turnFloor`. The turn write MUST NOT depend on, or change, the tier, fallback, model or thinking decision, including on the thinking-only and locked paths: it is added to whatever those paths write.

#### Scenario: Raised
- **WHEN** `requested.maxTurns` is 20, the agent locks nothing and the floor is 100
- **THEN** the route writes `maxTurns` 100 and records `turnFloor` 100

#### Scenario: Limit already above the floor
- **WHEN** `requested.maxTurns` is 120 and the floor is 100
- **THEN** the route writes no `maxTurns`

#### Scenario: Limit equal to the floor
- **WHEN** `requested.maxTurns` is 40 and the floor is 40
- **THEN** the route writes no `maxTurns`

#### Scenario: No floor
- **WHEN** `requested.maxTurns` is 20 and there is no floor
- **THEN** the route writes no `maxTurns`

#### Scenario: Next to a routed model
- **WHEN** `requested.maxTurns` is 20, the score cuts to `broad`, `broad` can run on a model supporting up to `high`, `effort.choice` is `high` and the floor is 100
- **THEN** the route writes the `broad` model, thinking `high` and `maxTurns` 100, recording tier `broad` and reason `cut`

#### Scenario: Next to a thinking-only write
- **WHEN** the launch is a fork with the setting `thinking`, `requested.maxTurns` is 20, `effort.choice` is `medium` and the floor is 40
- **THEN** the route writes thinking `medium`, `maxTurns` 40 and no model

#### Scenario: Model locked
- **WHEN** the agent locks `model`, `requested.maxTurns` is 20, the score cuts to `basic`, `effort.choice` is `high` and the floor is 100
- **THEN** the route writes thinking `high` and `maxTurns` 100 and no model, recording locked

### Requirement: Turns-only route
For a launch the route would otherwise leave `untouched` (see Launches left untouched) that can raise its turn limit, the route SHALL write no model and no thinking and record reason `untouched`, with `locked` as for an untouched launch, and SHALL add the turn write. On a miss it MUST record reason `miss` and write nothing; when cancelled it MUST be `skip`.

#### Scenario: Both fields locked with a limit
- **WHEN** the agent locks both `model` and `thinking`, `requested.maxTurns` is 20 and the floor is 100
- **THEN** the route writes `maxTurns` 100 and no model or thinking, recording reason `untouched` and locked

#### Scenario: Fork untouched with a limit
- **WHEN** the launch is a fork, the setting is `untouched`, `requested.maxTurns` is 20 and the floor is 200
- **THEN** the route writes `maxTurns` 200 and no model or thinking, recording reason `untouched`

#### Scenario: Turns-only miss
- **WHEN** the agent locks both `model` and `thinking`, `requested.maxTurns` is 20 and Jev times out
- **THEN** the route writes nothing and records reason `miss`

#### Scenario: Turns-only cancelled
- **WHEN** the agent locks both `model` and `thinking`, `requested.maxTurns` is 20 and the answers are cancelled
- **THEN** the route is `skip`

## MODIFIED Requirements

### Requirement: Route result
A pure launch route SHALL return one of: `untouched` (nothing to write, nothing asked), `skip` (nothing to write or record), or `routed`, which carries an optional `model`, `thinking` and `maxTurns` to write, and what to record: `reason`, and optionally `tier`, `fallback`, `effort` (the thinking written), `turnFloor` (the `maxTurns` written) and `locked`. For `routed` and `untouched` results alike, `locked` MUST be true when the agent locks `model` or `thinking`, or when the launch is a service launch naming a model (see `worker-routing`), and absent otherwise.

#### Scenario: Locked flag
- **WHEN** the agent locks `thinking` only and the launch is routed
- **THEN** the result marks `locked` true

#### Scenario: Locked untouched launch
- **WHEN** the agent locks both `model` and `thinking`, and the launch cannot raise its turn limit
- **THEN** the result is `untouched` and marks `locked` true

#### Scenario: No lock
- **WHEN** the agent locks nothing, the launch is not a service launch naming a model, and it is routed
- **THEN** the result has no `locked`

#### Scenario: Service launch naming a model
- **WHEN** an extension's `spawn()` names a model for an agent that locks nothing, and the launch is routed
- **THEN** the result marks `locked` true

### Requirement: Launches left untouched
The route SHALL leave the model and thinking untouched in each of these cases:
- (a) the launch's context is `fork` and the fork launch setting (`subagents.forkLaunch`) is `untouched`;
- (b) the agent locks both `model` and `thinking`;
- (c) the agent locks `thinking`, and either the launch is a fork with the setting `thinking`, or neither a tier nor a slot is offered.

Here "locks" includes `model` treated as locked for a service launch with an explicit model (see `worker-routing`). In those cases the route SHALL be `untouched` when the launch cannot raise its turn limit, and a turns-only route (see Turns-only route) when it can.

These checks MUST be decidable before Jev is asked, so an untouched launch sends no worker request, and a turns-only launch sends a request asking `turns` only. A resumed launch never reaches the route, because the executor does not consult the launch policy for it.

#### Scenario: Resume
- **WHEN** the launch resumes an agent
- **THEN** no route is computed and no worker request is sent

#### Scenario: Forked launch left alone
- **WHEN** the effective launch is a fork, the setting is `untouched`, and the launch has no turn limit
- **THEN** the route is `untouched`

#### Scenario: Both fields locked
- **WHEN** the agent locks both `model` and `thinking`, and the launch has no turn limit
- **THEN** the route is `untouched`

#### Scenario: Service launch with a model and locked thinking
- **WHEN** a service launch names a model, the agent locks `thinking`, and the launch has no turn limit
- **THEN** the route is `untouched`

#### Scenario: Forked thinking with thinking locked
- **WHEN** the launch is a fork, the setting is `thinking`, the agent locks `thinking`, and the launch has no turn limit
- **THEN** the route is `untouched`

#### Scenario: Slot alone with thinking locked
- **WHEN** only slot `reviewer` is offered and the agent locks `thinking`
- **THEN** the route is not `untouched`, and the `tier` question is asked

#### Scenario: Both fields locked with a turn limit
- **WHEN** the agent locks both `model` and `thinking`, `requested.maxTurns` is 20 and `max_turns` is not locked
- **THEN** the launch sends a request asking `turns` only

#### Scenario: Both fields and the limit locked
- **WHEN** the agent locks `model`, `thinking` and `max_turns`, and `requested.maxTurns` is 20
- **THEN** the route is `untouched` and no worker request is sent

### Requirement: Route on Jev failure
When the worker answers are cancelled, the route SHALL be `skip`. When they are a miss, the route MUST write nothing, including no `maxTurns`, and record reason `miss` with no `tier` and no `turnFloor`.

#### Scenario: Cancelled
- **WHEN** the answers are cancelled
- **THEN** the route is `skip`

#### Scenario: Miss
- **WHEN** the answers are a `timeout` miss
- **THEN** the route writes neither model nor thinking, and records reason `miss` and no tier

#### Scenario: Miss with a turn limit
- **WHEN** `requested.maxTurns` is 20 and the answers are an `error` miss
- **THEN** the route writes no `maxTurns` and records no `turnFloor`

### Requirement: Route writes thinking only
The route SHALL write no model, and record reason `untouched`, in each of these cases:
- the launch is a fork with the setting `thinking`;
- neither a tier nor a slot is offered;
- the `tier` question is asked but no target is decided.

Unless `thinking` is locked, the route MUST write the worker effort, as thinking without clamping, since the model that runs is not known here. When no effort is requested, or `thinking` is locked, it MUST write no thinking. A turn write (see Turn write) MAY still be added.

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
- **WHEN** the route writes thinking only, `effort` is unanswered and the launch cannot raise its turn limit
- **THEN** the route writes nothing

#### Scenario: No tier decided with thinking locked
- **WHEN** tiers are offered, no tier is decided, the agent locks `thinking` and the launch cannot raise its turn limit
- **THEN** the route writes nothing, recording reason `untouched` and locked

#### Scenario: Jev fails for a fork with thinking
- **WHEN** the launch is a fork with the setting `thinking` and Jev times out
- **THEN** the route writes neither model nor thinking, and records reason `miss`

#### Scenario: Thinking locked with a turn floor
- **WHEN** tiers are offered, no tier is decided, the agent locks `thinking`, `requested.maxTurns` is 20 and the floor is 100
- **THEN** the route writes `maxTurns` 100 and no model or thinking, recording reason `untouched` and locked

### Requirement: Nothing can run
When no target the fallback may use can run, the route SHALL write no model and no thinking, and record the decided target, its deciding reason, and `fallback` naming the decided target, with no `effort`. `frontier` MUST never be the tier that runs instead.

#### Scenario: All lower tiers unusable
- **WHEN** the decided tier is `broad` and neither `broad` nor `basic` can run, and the launch cannot raise its turn limit
- **THEN** the route writes nothing, recording tier `broad`, reason `cut` and fallback `broad`

#### Scenario: Expert never a cascade target
<!-- Intentional change: `expert` is renamed `frontier`; risk no longer decides `deep`. -->
- **WHEN** the decided tier is `deep` by the cut, `deep` cannot run, and only `frontier` can run, and the launch cannot raise its turn limit
- **THEN** the route writes nothing, recording tier `deep`, reason `cut` and fallback `deep`

#### Scenario: Unusable slot alone
- **WHEN** only slot `reviewer` is offered, it is decided, and it cannot run, and the launch cannot raise its turn limit
- **THEN** the route writes nothing, recording tier `slot::reviewer`, reason `slot` and fallback `slot::reviewer`

#### Scenario: Nothing can run with a turn floor
- **WHEN** the decided tier is `broad`, neither `broad` nor `basic` can run, `requested.maxTurns` is 20 and the floor is 100
- **THEN** the route writes only `maxTurns` 100, recording tier `broad`, reason `cut`, fallback `broad` and `turnFloor` 100

### Requirement: Locks in the route
When the agent locks `model` but not `thinking`, the route SHALL still decide and record the target and reason, and MUST NOT write a model or apply fallback; it MUST write thinking as the thinking-only route does. When the agent locks `thinking` but not `model`, the route MUST write the model and no thinking, and record no effort; if no tier is decided it writes no model and no thinking. A service launch that names a model (see `worker-routing`) SHALL count as locking `model` for this rule, for the questions asked, and for the ledger's `locked` field.

#### Scenario: Model locked
- **WHEN** the agent locks `model`, the score cuts to `basic` and `effort.choice` is `high`
- **THEN** the route writes thinking `high` and no model, recording tier `basic`, reason `cut` and locked

#### Scenario: Model locked without a decided tier
- **WHEN** the agent locks `model` and no tier is decided
- **THEN** the route records reason `untouched`, no tier, and locked

#### Scenario: Thinking locked
- **WHEN** the agent locks `thinking` and the decided tier is `basic`
- **THEN** the route writes the `basic` model and no thinking, recording no effort and locked

#### Scenario: Model locked with a slot decided
- **WHEN** the agent locks `model`, `tier.choice` is `slot::reviewer` at .9 and `effort.choice` is `high`
- **THEN** the route writes thinking `high` and no model, recording tier `slot::reviewer`, reason `slot` and locked, with no fallback

#### Scenario: Service launch with a model
- **WHEN** an extension's `spawn()` names `fixture/fixture-deep` for an agent that locks nothing, the score cuts to `basic` and `effort.choice` is `high`
- **THEN** the route writes thinking `high` and no model, recording tier `basic`, reason `cut` and locked

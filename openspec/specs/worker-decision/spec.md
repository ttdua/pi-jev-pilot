# worker-decision Specification

## Purpose
Pure rules that turn worker answers into a tier, an effort and a fallback target, never falling back to `expert`.

## Requirements

### Requirement: Decision order
A pure function SHALL decide a worker's tier from the worker answers, the offered tiers and the mode by applying the rules `expert-admitted`, `risky`, `expert-denied`, `fast-unsure` and `choice` in that order, the first match winning, and SHALL return the tier with the name of the rule as its reason. The rules MUST read Jev's raw answers, before any cap or clamp. Only rule `expert-admitted` depends on the mode.

#### Scenario: Ordinary choice
- **WHEN** `tier.choice` is `deep` and `risky` is .1
- **THEN** the tier is `deep` with reason `choice`

#### Scenario: Same answers, different modes
- **WHEN** all four tiers are offered, `tier.choice` is `deep` with `P(expert)` .2, `effort.choice` is `xhigh`, `expert_needed` is .3 and `risky` is .1
- **THEN** the tier is `deep` with reason `choice` in `budget` and `standard`, and `expert` with reason `expert-admitted` in `premium`

#### Scenario: Table per mode
- **WHEN** all four tiers are offered and each row below is decided in `budget`, `standard` and `premium`
- **THEN** each mode gives the tier and reason in its column; answers a row does not list are unanswered

| Answers | `budget`, `standard` | `premium` |
|---|---|---|
| `tier` `expert` (P .8), `expert_needed` .95, `effort` `high` | `expert`, `expert-admitted` | `deep`, `expert-denied` |
| `tier` `expert` (P .8), `expert_needed` .95, `effort` `max` | `expert`, `expert-admitted` | `expert`, `expert-admitted` |
| `tier` `deep` (P(expert) .3), `effort` `xhigh`, `expert_needed` .2 | `deep`, `choice` | `expert`, `expert-admitted` |
| `tier` `deep` (P(expert) .05), `effort` `max` | `deep`, `choice` | `deep`, `choice` |
| `tier` `balanced`, `risky` .9, `effort` `max` | `deep`, `risky` | `deep`, `risky` |
| `tier` `expert` (P .8), `expert_needed` .5, `effort` `medium` | `deep`, `expert-denied` | `deep`, `expert-denied` |
| `tier` `fast` (P .55) | `balanced`, `fast-unsure` | `balanced`, `fast-unsure` |
| `tier` `fast` (P .9) | `fast`, `choice` | `fast`, `choice` |
| `tier` `balanced`, `risky` .1 | `balanced`, `choice` | `balanced`, `choice` |

### Requirement: Risk floor rule
Rule `risky` SHALL match when `risky > .7`, and MUST decide `deep` if offered, else the highest offered tier below `expert`.

#### Scenario: Risk floor
- **WHEN** `tier.choice` is `fast` with `P(fast)` .9 and `risky` is .71
- **THEN** the tier is `deep` with reason `risky`

#### Scenario: Risk boundary
- **WHEN** `tier.choice` is `balanced` and `risky` is exactly .7
- **THEN** the tier is `balanced` with reason `choice`

#### Scenario: Risk floor without deep
- **WHEN** only `fast` and `balanced` are offered and `risky` is .9
- **THEN** the tier is `balanced` with reason `risky`

### Requirement: Expert denied rule
Rule `expert-denied` SHALL match when `tier.choice` is `expert` and rule `expert-admitted` did not, and MUST decide `deep` if offered, else the highest offered tier below `expert`.

#### Scenario: Expert denied without deep
- **WHEN** only `balanced` and `expert` are offered, `tier.choice` is `expert` and `expert_needed` is .5
- **THEN** the tier is `balanced` with reason `expert-denied`

### Requirement: Unsure fast rule
Rule `fast-unsure` SHALL match when `tier.choice` is `fast` and `P(fast) < .6`, and MUST decide `balanced` if offered, else the lowest offered tier above `fast` and below `expert`.

#### Scenario: Fast sure
- **WHEN** `tier.choice` is `fast` with `P(fast)` exactly .6
- **THEN** the tier is `fast` with reason `choice`

#### Scenario: Fast unsure
- **WHEN** `tier.choice` is `fast` with `P(fast)` .59
- **THEN** the tier is `balanced` with reason `fast-unsure`

### Requirement: Partial answers in the decision
An answer the mode's expert gate reads that is unanswered MUST count as not passing rule 1, and an unanswered `risky` as not passing rule 2. Rule 2 MUST apply even when `tier` is unanswered. Without a `tier` answer and without rule 2, or with no tier offered, no tier SHALL be decided.

#### Scenario: Risk floor without a tier answer
- **WHEN** `tier` is unanswered and `risky` is .9 and `deep` is offered
- **THEN** the tier is `deep` with reason `risky`

#### Scenario: Expert needed unanswered
- **WHEN** the mode is `standard`, `tier.choice` is `expert`, `expert_needed` is unanswered and `deep` is offered
- **THEN** the tier is `deep` with reason `expert-denied`

#### Scenario: Effort unanswered in premium
- **WHEN** the mode is `premium`, `tier.choice` is `expert` with `P(expert)` .8, `effort` is unanswered and `deep` is offered
- **THEN** the tier is `deep` with reason `expert-denied`

#### Scenario: No tier answer
- **WHEN** `tier` is unanswered and `risky` is .2
- **THEN** no tier is decided

#### Scenario: No tier offered
- **WHEN** no tier is offered and `risky` is .9
- **THEN** no tier is decided

#### Scenario: Every answer unanswered
- **WHEN** the result is `read` and every question is unanswered
- **THEN** no tier is decided

### Requirement: Rules without a qualifying tier
A rule that needs a tier when no qualifying tier is offered MUST fall through to the next rule. Rule 4 falling through gives `fast` with reason `choice`. Rule 5 MUST NOT return `expert`: an `expert` choice that did not pass rule 1 and has no offered tier below `expert` decides nothing.

#### Scenario: Risk floor with only fast
- **WHEN** only `fast` is offered and `risky` is .9
- **THEN** the tier is `fast` with reason `risky`

#### Scenario: Fast unsure without a higher tier
- **WHEN** only `fast` is offered and `tier.choice` is `fast` with `P(fast)` .4
- **THEN** the tier is `fast` with reason `choice`

#### Scenario: Only expert offered and denied
- **WHEN** only `expert` is offered, `tier.choice` is `expert` and `expert_needed` is .5
- **THEN** no tier is decided

### Requirement: Decision on Jev failure
When the worker answers are a miss, no tier SHALL be decided and the reason MUST be `miss`. When they are cancelled, nothing SHALL be decided and no reason is given.

#### Scenario: Jev failure
- **WHEN** the worker answers are a miss
- **THEN** no tier is decided and the reason is `miss`

#### Scenario: Cancelled
- **WHEN** the worker answers are cancelled
- **THEN** nothing is decided and no reason is given

### Requirement: Worker effort
A pure function SHALL compute the requested worker effort from the `effort` answer, `risky`, the final tier and whether fallback moved the tier. Without a fallback move it MUST start from `effort.choice`, rise to at least `high` when `risky > .7`, be capped at `xhigh`, and be capped at `medium` when the final tier is `fast`. When no tier was decided, the `fast` cap does not apply. Clamping to the model is not part of this function.

#### Scenario: Ceiling
- **WHEN** `effort.choice` is `max` and the tier is `deep`
- **THEN** the requested effort is `xhigh`

#### Scenario: Risk raises effort
- **WHEN** `effort.choice` is `low` and `risky` is .8
- **THEN** the requested effort is `high`

#### Scenario: Risk boundary for effort
- **WHEN** `effort.choice` is `low` and `risky` is exactly .7
- **THEN** the requested effort is `low`

#### Scenario: Fast cap
- **WHEN** `effort.choice` is `high` and the final tier is `fast`
- **THEN** the requested effort is `medium`

#### Scenario: Risk floor then fast cap
- **WHEN** `effort.choice` is `low`, `risky` is .8 and the final tier is `fast` without a fallback move
- **THEN** the requested effort is `medium`

#### Scenario: No tier decided
- **WHEN** `effort.choice` is `high` and no tier was decided
- **THEN** the requested effort is `high`

### Requirement: Effort after fallback
When fallback moved the tier, the requested effort MUST be `xhigh` on every tier, including `fast`, whether or not `effort` was answered. Without an `effort` answer and without a fallback move, no effort SHALL be requested.

#### Scenario: Fallback lifts effort on fast
- **WHEN** `effort.choice` is `low`, the decided tier was `balanced` and fallback moved it to `fast`
- **THEN** the requested effort is `xhigh`

#### Scenario: Fallback without an effort answer
- **WHEN** `effort` is unanswered and fallback moved the tier
- **THEN** the requested effort is `xhigh`

#### Scenario: No effort answer
- **WHEN** `effort` is unanswered and fallback did not move the tier
- **THEN** no effort is requested

### Requirement: Fallback choice
A pure function SHALL take the decided tier, the offered tiers and a test of which tiers can run. It MUST keep the decided tier when it is offered and can run; else move to the first offered tier below it, walking down `deep`, `balanced`, `fast`, that can run, naming the tier that could not; else leave the launch unchanged. `expert` MUST never be a fallback target.

#### Scenario: Target usable
- **WHEN** the decided tier is `deep` and `deep` can run
- **THEN** the result keeps `deep`

#### Scenario: Usable expert kept
- **WHEN** the decided tier is `expert` and `expert` can run
- **THEN** the result keeps `expert`

#### Scenario: Move down
- **WHEN** the decided tier is `deep`, `deep` cannot run and `balanced` can
- **THEN** the result moves to `balanced`, naming `deep` as the tier that could not run

#### Scenario: Skip an unusable lower tier
- **WHEN** the decided tier is `deep`, and neither `deep` nor `balanced` can run, and `fast` can
- **THEN** the result moves to `fast`

#### Scenario: Unoffered tier skipped
- **WHEN** the decided tier is `deep`, `deep` cannot run, `balanced` is not offered and `fast` can run
- **THEN** the result moves to `fast`

#### Scenario: Expert never a target
- **WHEN** the decided tier is `expert` and it cannot run
- **THEN** the result moves to the first tier below it that can run, and never to `expert`

#### Scenario: Fast cannot run
- **WHEN** the decided tier is `fast` and it cannot run
- **THEN** the result leaves the launch unchanged

#### Scenario: Nothing can run
- **WHEN** the decided tier is `balanced` and neither `balanced` nor `fast` can run
- **THEN** the result leaves the launch unchanged

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

### Requirement: Expert admitted rule
Rule `expert-admitted` SHALL match when the mode's expert gate passes and `expert` is offered, and MUST decide `expert`. It wins over the risk floor. When `expert` is not offered, the rule MUST NOT match, and the later rules apply to the actual `tier.choice`.

#### Scenario: Expert admitted in standard
- **WHEN** the mode is `standard`, `tier.choice` is `expert` and `expert_needed` is .95
- **THEN** the tier is `expert` with reason `expert-admitted`

#### Scenario: Standard boundary
- **WHEN** the mode is `standard`, `tier.choice` is `expert` and `expert_needed` is exactly .9
- **THEN** the tier is `deep` with reason `expert-denied`

#### Scenario: Expert stands on high risk
- **WHEN** the mode is `standard`, `tier.choice` is `expert`, `expert_needed` is .95 and `risky` is .9
- **THEN** the tier is `expert` with reason `expert-admitted`

#### Scenario: Premium admits from deep on high risk
- **WHEN** the mode is `premium`, `tier.choice` is `deep`, `P(expert)` is .3, `effort.choice` is `max` and `risky` is .9
- **THEN** the tier is `expert` with reason `expert-admitted`

#### Scenario: Premium gate passes but expert not offered
- **WHEN** the mode is `premium`, only `fast`, `balanced` and `deep` are offered, and the answers (built directly, since a real request without `expert` cannot carry it) have `tier.choice` `deep` with `P(expert)` .3 and `effort.choice` `max`
- **THEN** the tier is `deep` with reason `choice`

#### Scenario: Premium denies expert on low effort
- **WHEN** the mode is `premium`, all four tiers are offered, `tier.choice` is `expert` with `P(expert)` .6, `effort.choice` is `high` and `expert_needed` is .99
- **THEN** the tier is `deep` with reason `expert-denied`

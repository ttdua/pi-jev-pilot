# worker-decision Specification

## Purpose
Pure rules that turn worker answers into a tier, an effort and a fallback target, never falling back to `expert`.

## Requirements

### Requirement: Decision order
A pure function SHALL decide a worker's target from the worker answers, the offered tiers, the offered slot names and the launch's cut points, by applying the rules `expert`, `risky`, `slot` and `cut` in that order, the first match winning. It SHALL return the target, a tier or `slot::<name>`, with the name of the rule as its reason. The rules MUST read Jev's raw answers, before any cap or clamp. The mode affects the decision only through the cut points.

#### Scenario: Ordinary choice
- **WHEN** the cut points are `fastMax` 1.17, `balancedMax` 1.81 and `expertMin` 2.34, the score is 1.3 and `risky` is .1
- **THEN** the tier is `balanced` with reason `cut`

#### Scenario: Same answers, different modes
- **WHEN** all four tiers are offered, the score is 2.2 with `effort.choice` `xhigh` and `risky` .1, and the cut points are `budget` (1.41, 2.13, +∞), `standard` (1.17, 1.81, 2.34) and `premium` (−∞, 1.41, 2.12)
- **THEN** the tier is `deep` with reason `cut` in `budget` and `standard`, and `expert` with reason `expert` in `premium`

#### Scenario: Table per mode
- **WHEN** all four tiers are offered, the cut points are `budget` (1.41, 2.13, +∞), `standard` (1.17, 1.81, 2.34) and `premium` (−∞, 1.41, 2.12), and each row below is decided in each mode
- **THEN** each mode gives the tier and reason in its column; answers a row does not list are unanswered

| Answers | `budget` | `standard` | `premium` |
|---|---|---|---|
| score 2.4, `effort` `max`, `risky` .9 | `deep`, `risky` | `expert`, `expert` | `expert`, `expert` |
| score 2.4, `effort` `high` | `deep`, `cut` | `deep`, `cut` | `deep`, `cut` |
| score 2.2, `effort` `xhigh` | `deep`, `cut` | `deep`, `cut` | `expert`, `expert` |
| score 1.9, `effort` `high` | `balanced`, `cut` | `deep`, `cut` | `deep`, `cut` |
| score 1.3, `effort` `high` | `fast`, `cut` | `balanced`, `cut` | `balanced`, `cut` |
| score 1.0, `risky` .9 | `deep`, `risky` | `deep`, `risky` | `deep`, `risky` |
| score 1.0, `risky` .7 | `fast`, `cut` | `fast`, `cut` | `balanced`, `cut` |

#### Scenario: Slot in every mode
- **WHEN** all four tiers and slot `reviewer` are offered, `tier.choice` is `slot::reviewer` at .92, the score is 2.0, `effort.choice` is `high` and `risky` is .1
- **THEN** the target is `slot::reviewer` with reason `slot` in `budget`, `standard` and `premium`

### Requirement: Risk floor rule
Rule `risky` SHALL match when `risky > .7`, and MUST decide `deep` if offered, else the highest offered tier below `expert`.

#### Scenario: Risk floor
- **WHEN** the score cuts to `fast` and `risky` is .71
- **THEN** the tier is `deep` with reason `risky`

#### Scenario: Risk boundary
- **WHEN** the score cuts to `balanced` and `risky` is exactly .7
- **THEN** the tier is `balanced` with reason `cut`

#### Scenario: Risk floor without deep
- **WHEN** only `fast` and `balanced` are offered and `risky` is .9
- **THEN** the tier is `balanced` with reason `risky`

### Requirement: Partial answers in the decision
An unanswered `effort` MUST count as not passing rule `expert`, and an unanswered `risky` as not passing rule `risky`. Rule `risky` MUST apply even when `tier` is unanswered. Without a score only rules `risky` and `slot` can match; rules `expert` and `cut` need one. When no rule matches, or no tier or slot is offered, no target SHALL be decided.

#### Scenario: Risk floor without a tier answer
- **WHEN** `tier` is unanswered and `risky` is .9 and `deep` is offered
- **THEN** the tier is `deep` with reason `risky`

#### Scenario: Expert needed unanswered
- **WHEN** the mode is `standard`, all four tiers are offered, `expert_needed` is not in the answers, the score is 2.4, `expertMin` is 2.34 and `effort.choice` is `max`
- **THEN** the tier is `expert` with reason `expert`, since no rule reads `expert_needed`

#### Scenario: Effort unanswered in premium
- **WHEN** the mode is `premium`, all four tiers are offered, `effort` is unanswered, the score is 3.0 and `expertMin` is 2.12
- **THEN** the tier is `deep` with reason `cut`

#### Scenario: Slot without a score
- **WHEN** only slot `reviewer` is offered, `tier.choice` is `slot::reviewer` at .95 and `risky` is .1
- **THEN** the target is `slot::reviewer` with reason `slot`

#### Scenario: No tier answer
- **WHEN** `tier` is unanswered and `risky` is .2
- **THEN** no tier is decided

#### Scenario: No tier offered
- **WHEN** no tier is offered and `risky` is .9
- **THEN** no tier is decided

#### Scenario: Every answer unanswered
- **WHEN** the result is `read` and every question is unanswered
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
A pure function SHALL compute the requested worker effort from the `effort` answer, `risky`, the final target (a tier or a slot) and whether fallback moved the target. Without a fallback move it MUST start from `effort.choice`, rise to at least `high` when `risky > .7`, be capped at `xhigh`, and be capped at `medium` when the final target is the tier `fast`. A slot target MUST NOT get the `fast` cap. When no target was decided, the `fast` cap does not apply. Clamping to the model is not part of this function.

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

#### Scenario: Slot without the fast cap
- **WHEN** `effort.choice` is `high` and the final target is `slot::reviewer` without a fallback move
- **THEN** the requested effort is `high`

### Requirement: Effort after fallback
When fallback moved the target, including from a slot, the requested effort MUST be `xhigh` on every tier, including `fast`, whether or not `effort` was answered. Without an `effort` answer and without a fallback move, no effort SHALL be requested.

#### Scenario: Fallback lifts effort on fast
- **WHEN** `effort.choice` is `low`, the decided tier was `balanced` and fallback moved it to `fast`
- **THEN** the requested effort is `xhigh`

#### Scenario: Fallback without an effort answer
- **WHEN** `effort` is unanswered and fallback moved the tier
- **THEN** the requested effort is `xhigh`

#### Scenario: No effort answer
- **WHEN** `effort` is unanswered and fallback did not move the tier
- **THEN** no effort is requested

#### Scenario: Slot fell back to fast
- **WHEN** `effort.choice` is `low`, the decided target was `slot::reviewer` and fallback moved it to `fast`
- **THEN** the requested effort is `xhigh`

### Requirement: Fallback choice
A pure function SHALL take the decided target, the offered tiers and slots, and a test of which targets can run. It MUST keep the decided target when it is offered and can run. For a decided tier that cannot run, it MUST move to the first offered tier below it that can run, walking down `deep`, `balanced`, `fast`. For a decided slot that cannot run, it MUST move to the first offered tier that can run among `balanced` then `fast`, never `deep`. Each move MUST name the target that could not run. When no target can run, the launch is left unchanged. `expert` MUST never be a fallback target, and neither MUST a slot.

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

#### Scenario: Usable slot kept
- **WHEN** the decided target is `slot::reviewer` and it can run
- **THEN** the result keeps `slot::reviewer`

#### Scenario: Slot falls back to balanced
- **WHEN** the decided target is `slot::reviewer`, it cannot run, and `deep` and `balanced` can
- **THEN** the result moves to `balanced`, naming `slot::reviewer` as the target that could not run

#### Scenario: Slot falls back to fast
- **WHEN** the decided target is `slot::reviewer`, it cannot run, `balanced` is not offered and `fast` can run
- **THEN** the result moves to `fast`

#### Scenario: Slot never moves up
- **WHEN** the decided target is `slot::reviewer`, it cannot run, neither `balanced` nor `fast` can run, and `deep` and `expert` can
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
The route SHALL return `untouched` in each of these cases: (a) the effective launch resumes an agent; (b) it inherits context and the forked launch setting is `untouched`; (c) the agent locks both `model` and `thinking`; (d) the agent locks `thinking`, and either the launch inherits context with the setting `thinking`, or neither a tier nor a slot is offered. These checks MUST be decidable before Jev is asked, so an untouched launch sends no worker request.

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

#### Scenario: Slot alone with thinking locked
- **WHEN** only slot `reviewer` is offered and the agent locks `thinking`
- **THEN** the route is not `untouched`, and the `tier` question is asked

### Requirement: Route on Jev failure
When the worker answers are cancelled, the route SHALL be `skip`. When they are a miss, the route MUST write nothing and record reason `miss` with no `tier`.

#### Scenario: Cancelled
- **WHEN** the answers are cancelled
- **THEN** the route is `skip`

#### Scenario: Miss
- **WHEN** the answers are a `timeout` miss
- **THEN** the route writes neither model nor thinking, and records reason `miss` and no tier

### Requirement: Route writes thinking only
The route SHALL write no model and record reason `untouched` when the launch inherits context with the setting `thinking`, when neither a tier nor a slot is offered, or when the `tier` question is asked but no target is decided. Unless `thinking` is locked, it MUST write the worker effort, computed without the `fast` cap, as thinking without clamping, since the model that runs is not known here. When no effort is requested, or `thinking` is locked, it MUST write nothing.

#### Scenario: Forked launch with thinking
- **WHEN** the launch inherits context, the setting is `thinking`, `effort.choice` is `medium` and `risky` is .9
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

### Requirement: Routed launch
When a target is decided and `model` is not locked, the route SHALL choose the fallback over the targets that can run, compute the worker effort with whether fallback moved the target, and clamp it to the final target's model. It MUST write that target's model and the clamped thinking, and record the final target as `tier`, the deciding reason, the clamped effort, and `fallback` when it moved. A slot that runs without a move MUST NOT get the `fast` effort cap.

#### Scenario: Chosen tier written
- **WHEN** the score cuts to `balanced`, `effort.choice` is `high`, and `balanced` can run on a model supporting up to `high`
- **THEN** the route writes the `balanced` model and thinking `high`, recording tier `balanced` and reason `cut`

#### Scenario: Clamped to the model
- **WHEN** the final tier's model supports levels up to `high` and the requested effort is `xhigh`
- **THEN** the route writes thinking `high` and records effort `high`

#### Scenario: Cascade with xhigh
- **WHEN** the decided tier is `deep`, `deep` cannot run, `balanced` can, and `effort.choice` is `low`
- **THEN** the route writes the `balanced` model with `xhigh` clamped to that model, recording tier `balanced` and fallback `deep`

#### Scenario: Slot written
- **WHEN** `tier.choice` is `slot::reviewer` at .92, `effort.choice` is `high`, and the slot's model can run and supports `high`
- **THEN** the route writes the slot's model and thinking `high`, recording tier `slot::reviewer` and reason `slot`

#### Scenario: Slot falls back with xhigh
- **WHEN** `tier.choice` is `slot::reviewer` at .92, the slot cannot run, `balanced` can, and `effort.choice` is `low`
- **THEN** the route writes the `balanced` model with `xhigh` clamped to that model, recording tier `balanced`, reason `slot` and fallback `slot::reviewer`

### Requirement: Nothing can run
When no target the fallback may use can run, the route SHALL write nothing and record the decided target, its deciding reason, and `fallback` naming the decided target, with no `effort`. `expert` MUST never be the tier that runs instead.

#### Scenario: All lower tiers unusable
- **WHEN** the decided tier is `balanced` and neither `balanced` nor `fast` can run
- **THEN** the route writes nothing, recording tier `balanced`, reason `cut` and fallback `balanced`

#### Scenario: Expert never a cascade target
- **WHEN** the decided tier is `deep` by the risk floor, `deep` cannot run, and only `expert` can run
- **THEN** the route writes nothing, recording tier `deep`, reason `risky` and fallback `deep`

#### Scenario: Unusable slot alone
- **WHEN** only slot `reviewer` is offered, it is decided, and it cannot run
- **THEN** the route writes nothing, recording tier `slot::reviewer`, reason `slot` and fallback `slot::reviewer`

### Requirement: Locks in the route
When the agent locks `model` but not `thinking`, the route SHALL still decide and record the target and reason, and MUST NOT write a model or apply fallback; it MUST write thinking as the thinking-only route does. When the agent locks `thinking` but not `model`, the route MUST write the model and no thinking, and record no effort; if no tier is decided it writes nothing.

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

### Requirement: Slot rule
Rule `slot` SHALL match when `tier.choice` is an offered `slot::<name>` whose probability is at least .6, and MUST decide that slot. Rules `expert` and `risky` MUST win over rule `slot`.

#### Scenario: Slot at the bar
- **WHEN** `tier.choice` is `slot::reviewer` at exactly .6
- **THEN** the target is `slot::reviewer` with reason `slot`

#### Scenario: Risk wins over a slot
- **WHEN** `tier.choice` is `slot::reviewer` at .95 and `risky` is .8
- **THEN** the tier is `deep` with reason `risky`

#### Scenario: Two slots
- **WHEN** slots `reviewer` and `bulk` are offered and `tier.choice` is `slot::bulk` at .7
- **THEN** the target is `slot::bulk` with reason `slot`

### Requirement: Expert rule
Rule `expert` SHALL match when `expert` is offered, the difficulty score is at least the launch's `expertMin`, and `effort.choice` is `xhigh` or `max`, and MUST decide `expert`. It wins over the risk floor and slots. With `effort` unanswered, or no score, it MUST NOT match.

#### Scenario: Expert by score and effort
- **WHEN** all four tiers are offered, `expertMin` is 2.3, the score is 2.35 and `effort.choice` is `xhigh`
- **THEN** the tier is `expert` with reason `expert`

#### Scenario: Expert at the cut
- **WHEN** all four tiers are offered, `expertMin` is 2.3, the score is exactly 2.3 and `effort.choice` is `max`
- **THEN** the tier is `expert` with reason `expert`

#### Scenario: High effort is not enough
- **WHEN** all four tiers are offered, `expertMin` is 2.3, the score is 2.4 and `effort.choice` is `high`
- **THEN** the tier is `deep` with reason `cut`

#### Scenario: Expert not offered
- **WHEN** only `fast`, `balanced` and `deep` are offered, `expertMin` is 2.3, the score is 2.4 and `effort.choice` is `max`
- **THEN** the tier is `deep` with reason `cut`

#### Scenario: Budget never reaches expert
- **WHEN** the mode is `budget`, all four tiers are offered, the score is 3.4 and `effort.choice` is `max`
- **THEN** the tier is `deep` with reason `cut`, since a 0 expert cap gives `expertMin` +∞

#### Scenario: Expert stands on high risk
- **WHEN** rule `expert` matches and `risky` is .9
- **THEN** the tier is `expert` with reason `expert`

### Requirement: Cut rule
Rule `cut` SHALL match whenever there is a score. It MUST decide `fast` when the score is at most `fastMax`, `balanced` when it is at most `balancedMax`, and `deep` otherwise. A decided tier that is not offered MUST move to the nearest offered tier below it, else the nearest offered tier above it, never to `expert`.

#### Scenario: Fast at the cut
- **WHEN** `fastMax` is 1.17 and the score is exactly 1.17
- **THEN** the tier is `fast` with reason `cut`

#### Scenario: Balanced
- **WHEN** `fastMax` is 1.17, `balancedMax` is 1.81 and the score is 1.5
- **THEN** the tier is `balanced` with reason `cut`

#### Scenario: Deep
- **WHEN** `balancedMax` is 1.81 and the score is 1.82
- **THEN** the tier is `deep` with reason `cut`

#### Scenario: Premium never cuts to fast
- **WHEN** the cut points are `premium`'s (−∞, 1.41, 2.12) and the score is 0
- **THEN** the tier is `balanced` with reason `cut`

#### Scenario: Unoffered tier moves down
- **WHEN** only `fast` and `deep` are offered and the score cuts to `balanced`
- **THEN** the tier is `fast` with reason `cut`

#### Scenario: Unoffered tier moves up
- **WHEN** only `balanced` and `deep` are offered and the score cuts to `fast`
- **THEN** the tier is `balanced` with reason `cut`

### Requirement: Fallthrough without a qualifying tier
A rule that needs a tier when no qualifying tier is offered MUST fall through to the next rule. Rule `cut` MUST NOT return `expert`. Rule `risky` with no tier offered falls through to rule `slot`.

#### Scenario: Risk floor with only fast
- **WHEN** only `fast` is offered and `risky` is .9
- **THEN** the tier is `fast` with reason `risky`

#### Scenario: Risk floor with only a slot
- **WHEN** only slot `reviewer` is offered, `risky` is .9 and `tier.choice` is `slot::reviewer` at .95
- **THEN** the target is `slot::reviewer` with reason `slot`

#### Scenario: Only fast offered
- **WHEN** only `fast` is offered and the score cuts to `deep`
- **THEN** the tier is `fast` with reason `cut`

#### Scenario: Only expert offered
- **WHEN** only `expert` is offered and rule `expert` does not match
- **THEN** no tier is decided

### Requirement: Slot below the bar uses the score
When `tier.choice` is a slot that rule `slot` does not decide, rule `cut` SHALL decide from the score, which ignores slot probabilities. With no tier offered, no target SHALL be decided.

#### Scenario: Slot below the bar
- **WHEN** `tier.choice` is `slot::reviewer` at .5, the tier probabilities are `balanced` .3, `deep` .15 and `fast` .05, `effort.choice` is `high`, and `fastMax` is 1.17 and `balancedMax` 1.81
- **THEN** the score is 1.45 and the tier is `balanced` with reason `cut`

#### Scenario: Slot not offered
- **WHEN** the answers (built directly) have `tier.choice` `slot::old` at .9 and no slot `old` is offered
- **THEN** rule `slot` does not match and rule `cut` decides from the score

#### Scenario: Slot below the bar reaches expert
- **WHEN** all four tiers and slot `reviewer` are offered, `tier.choice` is `slot::reviewer` at .5, the score is 2.4, `expertMin` is 2.34 and `effort.choice` is `xhigh`
- **THEN** the tier is `expert` with reason `expert`, since the score ignores slot probabilities

#### Scenario: Only a slot offered below the bar
- **WHEN** only slot `reviewer` is offered and `tier.choice` is `slot::reviewer` at .5
- **THEN** no target is decided

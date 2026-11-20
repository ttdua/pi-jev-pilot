# worker-decision Specification

## Purpose
Pure rules that turn worker answers into a tier, an effort and a fallback target, never falling back to `expert`.

## Requirements

### Requirement: Decision order
A pure function SHALL decide a worker's target from the worker answers, the offered tiers, the offered slot names and the launch's cut points, by applying the rules `frontier`, `slot` and `cut` in that order, the first match winning. It SHALL return the target, a tier or `slot::<name>`, with the name of the rule as its reason. The rules MUST read Jev's raw answers, before any cap or clamp. The decision MUST NOT read `effort` or `risky`: tier is decided from the knowledge axis only. The mode affects the decision only through the cut points.

#### Scenario: Ordinary choice
- **WHEN** the cut points are `basicMax` 0.9, `broadMax` 1.5 and `frontierMin` 2.3, the score is 1.2 and `risky` is .1
- **THEN** the tier is `broad` with reason `cut`

#### Scenario: Same answers, different modes
- **WHEN** all four tiers are offered, the score is 2.4, and the cut points are `budget` (1.0, 1.9, +∞), `standard` (0.9, 1.5, 2.5) and `premium` (−∞, 1.2, 2.3)
- **THEN** the tier is `deep` with reason `cut` in `budget` and `standard`, and `frontier` with reason `frontier` in `premium`

#### Scenario: Table per mode
- **WHEN** all four tiers are offered, the cut points are `budget` (1.0, 1.9, +∞), `standard` (0.9, 1.5, 2.5) and `premium` (−∞, 1.2, 2.3), and each row below is decided in each mode
- **THEN** each mode gives the tier and reason in its column; answers a row does not list are unanswered

| Answers | `budget` | `standard` | `premium` |
|---|---|---|---|
| score 2.6, `effort` `low` | `deep`, `cut` | `frontier`, `frontier` | `frontier`, `frontier` |
| score 2.4, `effort` `max` | `deep`, `cut` | `deep`, `cut` | `frontier`, `frontier` |
| score 1.7, `effort` `low` | `broad`, `cut` | `deep`, `cut` | `deep`, `cut` |
| score 1.0, `effort` `max` | `basic`, `cut` | `broad`, `cut` | `broad`, `cut` |
| score 0.5, `risky` .9 | `basic`, `cut` | `basic`, `cut` | `broad`, `cut` |

#### Scenario: Effort does not move the tier
- **WHEN** two launches have the same `tier` probabilities, one with `effort.choice` `low` and one with `max`
- **THEN** both get the same tier and reason

#### Scenario: Slot in every mode
- **WHEN** all four tiers and slot `reviewer` are offered, `tier.choice` is `slot::reviewer` at .92, the score is 2.0, `effort.choice` is `high` and `risky` is .1
- **THEN** the target is `slot::reviewer` with reason `slot` in `budget`, `standard` and `premium`

### Requirement: Partial answers in the decision
Without a score only rule `slot` can match; rules `frontier` and `cut` need one. Unanswered `effort` and `risky` MUST NOT change the decision. When no rule matches, or no tier or slot is offered, no target SHALL be decided.

#### Scenario: Risk floor without a tier answer
<!-- Intentional change: risk no longer decides a tier. -->
- **WHEN** `tier` is unanswered, `risky` is .9 and `deep` is offered
- **THEN** no tier is decided

#### Scenario: Effort unanswered in premium
<!-- Intentional change: effort no longer gates `frontier`. -->
- **WHEN** the mode is `premium`, all four tiers are offered, `effort` is unanswered, the score is 3.0 and `frontierMin` is 2.3
- **THEN** the tier is `frontier` with reason `frontier`

#### Scenario: Expert needed unanswered
<!-- Intentional change: `expert` is renamed `frontier`; effort no longer gates it. -->
- **WHEN** the mode is `standard`, all four tiers are offered, `expert_needed` is not in the answers, the score is 2.6 and `frontierMin` is 2.5
- **THEN** the tier is `frontier` with reason `frontier`, since no rule reads `expert_needed`

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
A pure function SHALL compute the requested worker effort from the `effort` answer, `risky` and whether fallback moved the target. Without a fallback move it MUST start from `effort.choice`, rise to at least `high` when `risky > .7`, and be capped at `xhigh`. The final tier or slot MUST NOT cap or raise the effort: a `basic` launch MAY run at `high` or `xhigh`. Clamping to the model is not part of this function.

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
<!-- Intentional change: the effort cap on the lowest tier is removed. -->
- **WHEN** `effort.choice` is `xhigh` and the final tier is `basic`
- **THEN** the requested effort is `xhigh`

#### Scenario: Risk floor then fast cap
<!-- Intentional change: the effort cap on the lowest tier is removed. -->
- **WHEN** `effort.choice` is `low`, `risky` is .8 and the final tier is `basic` without a fallback move
- **THEN** the requested effort is `high`

#### Scenario: No tier decided
- **WHEN** `effort.choice` is `high` and no tier was decided
- **THEN** the requested effort is `high`

#### Scenario: Slot without the fast cap
<!-- Intentional change: the effort cap on the lowest tier is removed. -->
- **WHEN** `effort.choice` is `high` and the final target is `slot::reviewer` without a fallback move
- **THEN** the requested effort is `high`

### Requirement: Effort after fallback
When fallback moved the target, including from a slot, the requested effort MUST be `xhigh` on every tier, including `basic`, whether or not `effort` was answered. Without an `effort` answer and without a fallback move, no effort SHALL be requested.

#### Scenario: Fallback lifts effort on fast
<!-- Intentional change: `fast` is renamed `basic`. -->
- **WHEN** `effort.choice` is `low`, the decided tier was `broad` and fallback moved it to `basic`
- **THEN** the requested effort is `xhigh`

#### Scenario: Fallback without an effort answer
- **WHEN** `effort` is unanswered and fallback moved the tier
- **THEN** the requested effort is `xhigh`

#### Scenario: No effort answer
- **WHEN** `effort` is unanswered and fallback did not move the tier
- **THEN** no effort is requested

#### Scenario: Slot fell back to fast
<!-- Intentional change: `fast` is renamed `basic`. -->
- **WHEN** `effort.choice` is `low`, the decided target was `slot::reviewer` and fallback moved it to `basic`
- **THEN** the requested effort is `xhigh`

### Requirement: Fallback choice
A pure function SHALL take the decided target, the offered tiers and slots, and a test of which targets can run. It MUST keep the decided target when it is offered and can run. For a decided tier that cannot run, it MUST move to the first offered tier below it that can run, walking down `deep`, `broad`, `basic`. For a decided slot that cannot run, it MUST move to the first offered tier that can run among `broad` then `basic`, never `deep`. Each move MUST name the target that could not run. When no target can run, the launch is left unchanged. `frontier` MUST never be a fallback target, and neither MUST a slot.

#### Scenario: Target usable
- **WHEN** the decided tier is `deep` and `deep` can run
- **THEN** the result keeps `deep`

#### Scenario: Usable expert kept
<!-- Intentional change: `expert` is renamed `frontier`. -->
- **WHEN** the decided tier is `frontier` and `frontier` can run
- **THEN** the result keeps `frontier`

#### Scenario: Move down
- **WHEN** the decided tier is `deep`, `deep` cannot run and `broad` can
- **THEN** the result moves to `broad`, naming `deep` as the tier that could not run

#### Scenario: Skip an unusable lower tier
- **WHEN** the decided tier is `deep`, and neither `deep` nor `broad` can run, and `basic` can
- **THEN** the result moves to `basic`

#### Scenario: Unoffered tier skipped
- **WHEN** the decided tier is `deep`, `deep` cannot run, `broad` is not offered and `basic` can run
- **THEN** the result moves to `basic`

#### Scenario: Expert never a target
<!-- Intentional change: `expert` is renamed `frontier`. -->
- **WHEN** the decided tier is `frontier` and it cannot run
- **THEN** the result moves to the first tier below it that can run, and never to `frontier`

#### Scenario: Fast cannot run
<!-- Intentional change: `fast` is renamed `basic`. -->
- **WHEN** the decided tier is `basic` and it cannot run
- **THEN** the result leaves the launch unchanged

#### Scenario: Nothing can run
- **WHEN** the decided tier is `broad` and neither `broad` nor `basic` can run
- **THEN** the result leaves the launch unchanged

#### Scenario: Usable slot kept
- **WHEN** the decided target is `slot::reviewer` and it can run
- **THEN** the result keeps `slot::reviewer`

#### Scenario: Slot falls back to balanced
<!-- Intentional change: `balanced` is renamed `broad`; the fallback order is unchanged. -->
- **WHEN** the decided target is `slot::reviewer`, it cannot run, and `deep` and `broad` can
- **THEN** the result moves to `broad`, naming `slot::reviewer` as the target that could not run

#### Scenario: Slot falls back to fast
<!-- Intentional change: `fast` is renamed `basic`. -->
- **WHEN** the decided target is `slot::reviewer`, it cannot run, `broad` is not offered and `basic` can run
- **THEN** the result moves to `basic`

#### Scenario: Slot never moves up
- **WHEN** the decided target is `slot::reviewer`, it cannot run, neither `broad` nor `basic` can run, and `deep` and `frontier` can
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

### Requirement: Route on Jev failure
When the worker answers are cancelled, the route SHALL be `skip`. When they are a miss, the route MUST write nothing and record reason `miss` with no `tier`.

#### Scenario: Cancelled
- **WHEN** the answers are cancelled
- **THEN** the route is `skip`

#### Scenario: Miss
- **WHEN** the answers are a `timeout` miss
- **THEN** the route writes neither model nor thinking, and records reason `miss` and no tier

### Requirement: Route writes thinking only
The route SHALL write no model, and record reason `untouched`, in each of these cases:
- the launch is a fork with the setting `thinking`;
- neither a tier nor a slot is offered;
- the `tier` question is asked but no target is decided.

Unless `thinking` is locked, the route MUST write the worker effort, as thinking without clamping, since the model that runs is not known here. When no effort is requested, or `thinking` is locked, it MUST write nothing.

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

### Requirement: Routed launch
When a target is decided and `model` is not locked, the route SHALL choose the fallback over the targets that can run, compute the worker effort with whether fallback moved the target, and clamp it to the final target's model. It MUST write that target's model and the clamped thinking, and record the final target as `tier`, the deciding reason, the clamped effort, and `fallback` when it moved.

#### Scenario: Chosen tier written
- **WHEN** the score cuts to `broad`, `effort.choice` is `high`, and `broad` can run on a model supporting up to `high`
- **THEN** the route writes the `broad` model and thinking `high`, recording tier `broad` and reason `cut`

#### Scenario: Clamped to the model
- **WHEN** the final tier's model supports levels up to `high` and the requested effort is `xhigh`
- **THEN** the route writes thinking `high` and records effort `high`

#### Scenario: Cascade with xhigh
- **WHEN** the decided tier is `deep`, `deep` cannot run, `broad` can, and `effort.choice` is `low`
- **THEN** the route writes the `broad` model with `xhigh` clamped to that model, recording tier `broad` and fallback `deep`

#### Scenario: Slot written
- **WHEN** `tier.choice` is `slot::reviewer` at .92, `effort.choice` is `high`, and the slot's model can run and supports `high`
- **THEN** the route writes the slot's model and thinking `high`, recording tier `slot::reviewer` and reason `slot`

#### Scenario: Slot falls back with xhigh
- **WHEN** `tier.choice` is `slot::reviewer` at .92, the slot cannot run, `broad` can, and `effort.choice` is `low`
- **THEN** the route writes the `broad` model with `xhigh` clamped to that model, recording tier `broad`, reason `slot` and fallback `slot::reviewer`

### Requirement: Nothing can run
When no target the fallback may use can run, the route SHALL write nothing and record the decided target, its deciding reason, and `fallback` naming the decided target, with no `effort`. `frontier` MUST never be the tier that runs instead.

#### Scenario: All lower tiers unusable
- **WHEN** the decided tier is `broad` and neither `broad` nor `basic` can run
- **THEN** the route writes nothing, recording tier `broad`, reason `cut` and fallback `broad`

#### Scenario: Expert never a cascade target
<!-- Intentional change: `expert` is renamed `frontier`; risk no longer decides `deep`. -->
- **WHEN** the decided tier is `deep` by the cut, `deep` cannot run, and only `frontier` can run
- **THEN** the route writes nothing, recording tier `deep`, reason `cut` and fallback `deep`

#### Scenario: Unusable slot alone
- **WHEN** only slot `reviewer` is offered, it is decided, and it cannot run
- **THEN** the route writes nothing, recording tier `slot::reviewer`, reason `slot` and fallback `slot::reviewer`

### Requirement: Locks in the route
When the agent locks `model` but not `thinking`, the route SHALL still decide and record the target and reason, and MUST NOT write a model or apply fallback; it MUST write thinking as the thinking-only route does. When the agent locks `thinking` but not `model`, the route MUST write the model and no thinking, and record no effort; if no tier is decided it writes nothing. A service launch that names a model (see `worker-routing`) SHALL count as locking `model` for this rule, for the questions asked, and for the ledger's `locked` field.

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

### Requirement: Slot rule
Rule `slot` SHALL match when `tier.choice` is an offered `slot::<name>` whose probability is at least .6, and MUST decide that slot. Rule `frontier` MUST win over rule `slot`; `risky` MUST NOT affect it.

#### Scenario: Slot at the bar
- **WHEN** `tier.choice` is `slot::reviewer` at exactly .6
- **THEN** the target is `slot::reviewer` with reason `slot`

#### Scenario: Risk wins over a slot
<!-- Intentional change: risk no longer decides a tier, so the slot stands. -->
- **WHEN** `tier.choice` is `slot::reviewer` at .95 and `risky` is .8
- **THEN** the target is `slot::reviewer` with reason `slot`

#### Scenario: Two slots
- **WHEN** slots `reviewer` and `bulk` are offered and `tier.choice` is `slot::bulk` at .7
- **THEN** the target is `slot::bulk` with reason `slot`

### Requirement: Frontier rule
Rule `frontier` SHALL match when `frontier` is offered and the difficulty score is at least the launch's `frontierMin`, and MUST decide `frontier`. It MUST NOT read `effort`. It wins over slots. With no score it MUST NOT match.

#### Scenario: Expert by score and effort
<!-- Intentional change: the frontier rule no longer reads effort. -->
- **WHEN** all four tiers are offered, `frontierMin` is 2.3 and the score is 2.35
- **THEN** the tier is `frontier` with reason `frontier`

#### Scenario: Expert at the cut
<!-- Intentional change: `expert` is renamed `frontier`. -->
- **WHEN** all four tiers are offered, `frontierMin` is 2.3 and the score is exactly 2.3
- **THEN** the tier is `frontier` with reason `frontier`

#### Scenario: High effort is not enough
<!-- Intentional change: effort no longer gates `frontier`. -->
- **WHEN** all four tiers are offered, `frontierMin` is 2.3, the score is 2.4 and `effort.choice` is `low`
- **THEN** the tier is `frontier` with reason `frontier`

#### Scenario: Below the frontier cut
- **WHEN** all four tiers are offered, `frontierMin` is 2.3, `broadMax` is 1.5 and the score is 2.29
- **THEN** the tier is `deep` with reason `cut`

#### Scenario: Expert not offered
<!-- Intentional change: `expert` is renamed `frontier`. -->
- **WHEN** only `basic`, `broad` and `deep` are offered, `frontierMin` is 2.3 and the score is 2.4
- **THEN** the tier is `deep` with reason `cut`

#### Scenario: Budget never reaches expert
<!-- Intentional change: `expert` is renamed `frontier`. -->
- **WHEN** the mode is `budget`, all four tiers are offered and the score is 3.0
- **THEN** the tier is `deep` with reason `cut`, since a 0 frontier cap gives `frontierMin` +∞

#### Scenario: Expert stands on high risk
<!-- Intentional change: risk no longer decides a tier; the scenario now checks that `frontier` wins over a slot that also matches. -->
- **WHEN** all four tiers and slot `reviewer` are offered, the `tier` probabilities are `slot::reviewer` .6 and `frontier` .4, `risky` is .9 and `frontierMin` is 2.3
- **THEN** the score is 3 and the tier is `frontier` with reason `frontier`, although rule `slot` would match

### Requirement: Cut rule
Rule `cut` SHALL match whenever there is a score. It MUST decide `basic` when the score is at most `basicMax`, `broad` when it is at most `broadMax`, and `deep` otherwise. A decided tier that is not offered MUST move to the nearest offered tier below it, else the nearest offered tier above it, never to `frontier`.

#### Scenario: Fast at the cut
<!-- Intentional change: `fast` is renamed `basic`; cut values follow the tier-only score. -->
- **WHEN** `basicMax` is 0.9 and the score is exactly 0.9
- **THEN** the tier is `basic` with reason `cut`

#### Scenario: Balanced
<!-- Intentional change: `balanced` is renamed `broad`; cut values follow the tier-only score. -->
- **WHEN** `basicMax` is 0.9, `broadMax` is 1.5 and the score is 1.2
- **THEN** the tier is `broad` with reason `cut`

#### Scenario: Deep
- **WHEN** `broadMax` is 1.5 and the score is 1.51
- **THEN** the tier is `deep` with reason `cut`

#### Scenario: Premium never cuts to fast
<!-- Intentional change: `fast` is renamed `basic`. -->
- **WHEN** the cut points are `premium`'s (−∞, 1.2, 2.3) and the score is 0
- **THEN** the tier is `broad` with reason `cut`

#### Scenario: Unoffered tier moves down
- **WHEN** only `basic` and `deep` are offered and the score cuts to `broad`
- **THEN** the tier is `basic` with reason `cut`

#### Scenario: Unoffered tier moves up
- **WHEN** only `broad` and `deep` are offered and the score cuts to `basic`
- **THEN** the tier is `broad` with reason `cut`

### Requirement: Fallthrough without a qualifying tier
A rule that needs a tier when no qualifying tier is offered MUST fall through to the next rule. Rule `cut` MUST NOT return `frontier`.

#### Scenario: Risk floor with only a slot
<!-- Intentional change: risk no longer decides a tier. -->
- **WHEN** only slot `reviewer` is offered, `risky` is .9 and `tier.choice` is `slot::reviewer` at .95
- **THEN** the target is `slot::reviewer` with reason `slot`

#### Scenario: Risk floor with only fast
<!-- Intentional change: risk no longer decides a tier; `fast` is renamed `basic`. -->
- **WHEN** only `basic` is offered, the score is 2.0 and `risky` is .9
- **THEN** the tier is `basic` with reason `cut`

#### Scenario: Only fast offered
<!-- Intentional change: `fast` is renamed `basic`. -->
- **WHEN** only `basic` is offered and the score cuts to `deep`
- **THEN** the tier is `basic` with reason `cut`

#### Scenario: Only expert offered
<!-- Intentional change: `expert` is renamed `frontier`. -->
- **WHEN** only `frontier` is offered and rule `frontier` does not match
- **THEN** no tier is decided

### Requirement: Slot below the bar uses the score
When `tier.choice` is a slot that rule `slot` does not decide, rule `cut` SHALL decide from the score, which ignores slot probabilities. With no tier offered, no target SHALL be decided.

#### Scenario: Slot below the bar
- **WHEN** `tier.choice` is `slot::reviewer` at .5, the tier probabilities are `broad` .3, `deep` .15 and `basic` .05, and `basicMax` is 0.9 and `broadMax` 1.5
- **THEN** the score is 1.2 and the tier is `broad` with reason `cut`

#### Scenario: Slot not offered
- **WHEN** the answers (built directly) have `tier.choice` `slot::old` at .9 and no slot `old` is offered
- **THEN** rule `slot` does not match and rule `cut` decides from the score

#### Scenario: Slot below the bar reaches expert
<!-- Intentional change: `expert` is renamed `frontier`; effort is no longer read. -->
- **WHEN** all four tiers and slot `reviewer` are offered, `tier.choice` is `slot::reviewer` at .5, the score is 2.4 and `frontierMin` is 2.3
- **THEN** the tier is `frontier` with reason `frontier`, since the score ignores slot probabilities

#### Scenario: Only a slot offered below the bar
- **WHEN** only slot `reviewer` is offered and `tier.choice` is `slot::reviewer` at .5
- **THEN** no target is decided

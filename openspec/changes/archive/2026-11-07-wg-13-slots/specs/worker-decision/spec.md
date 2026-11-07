## MODIFIED Requirements

### Requirement: Decision order
A pure function SHALL decide a worker's target from the worker answers, the offered tiers, the offered slot names and the mode by applying the rules `expert-admitted`, `risky`, `slot`, `expert-denied`, `fast-unsure` and `choice` in that order, the first match winning, and SHALL return the target, a tier or `slot::<name>`, with the name of the rule as its reason. The rules MUST read Jev's raw answers, before any cap or clamp. Only rule `expert-admitted` depends on the mode.

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

#### Scenario: Slot in every mode
- **WHEN** all four tiers and slot `reviewer` are offered, `tier.choice` is `slot::reviewer` at .92, `effort.choice` is `max` and `risky` is .1
- **THEN** the target is `slot::reviewer` with reason `slot` in `budget`, `standard` and `premium`

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

### Requirement: Routed launch
When a target is decided and `model` is not locked, the route SHALL choose the fallback over the targets that can run, compute the worker effort with whether fallback moved the target, and clamp it to the final target's model. It MUST write that target's model and the clamped thinking, and record the final target as `tier`, the deciding reason, the clamped effort, and `fallback` when it moved. A slot that runs without a move MUST NOT get the `fast` effort cap.

#### Scenario: Chosen tier written
- **WHEN** `tier.choice` is `balanced` at .95, `effort.choice` is `high`, and `balanced` can run on a model supporting up to `high`
- **THEN** the route writes the `balanced` model and thinking `high`, recording tier `balanced` and reason `choice`

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
- **THEN** the route writes nothing, recording tier `balanced`, reason `choice` and fallback `balanced`

#### Scenario: Expert never a cascade target
- **WHEN** the decided tier is `deep` by the risk floor, `deep` cannot run, and only `expert` can run
- **THEN** the route writes nothing, recording tier `deep`, reason `risky` and fallback `deep`

#### Scenario: Unusable slot alone
- **WHEN** only slot `reviewer` is offered, it is decided, and it cannot run
- **THEN** the route writes nothing, recording tier `slot::reviewer`, reason `slot` and fallback `slot::reviewer`

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

### Requirement: Rules without a qualifying tier
A rule that needs a tier when no qualifying tier is offered MUST fall through to the next rule. Rule `fast-unsure` falling through gives `fast` with reason `choice`. Rule `choice` MUST NOT return `expert`: an `expert` choice that did not pass rule `expert-admitted` and has no offered tier below `expert` decides nothing. Rule `risky` with no tier offered falls through to rule `slot`.

#### Scenario: Risk floor with only fast
- **WHEN** only `fast` is offered and `risky` is .9
- **THEN** the tier is `fast` with reason `risky`

#### Scenario: Fast unsure without a higher tier
- **WHEN** only `fast` is offered and `tier.choice` is `fast` with `P(fast)` .4
- **THEN** the tier is `fast` with reason `choice`

#### Scenario: Only expert offered and denied
- **WHEN** only `expert` is offered, `tier.choice` is `expert` and `expert_needed` is .5
- **THEN** no tier is decided

#### Scenario: Risk floor with only a slot
- **WHEN** only slot `reviewer` is offered, `risky` is .9 and `tier.choice` is `slot::reviewer` at .95
- **THEN** the target is `slot::reviewer` with reason `slot`

### Requirement: Locks in the route
When the agent locks `model` but not `thinking`, the route SHALL still decide and record the target and reason, and MUST NOT write a model or apply fallback; it MUST write thinking as the thinking-only route does. When the agent locks `thinking` but not `model`, the route MUST write the model and no thinking, and record no effort; if no tier is decided it writes nothing.

#### Scenario: Model locked
- **WHEN** the agent locks `model`, the decided tier is `fast` at .9 and `effort.choice` is `high`
- **THEN** the route writes thinking `high` and no model, recording tier `fast`, reason `choice` and locked

#### Scenario: Model locked without a decided tier
- **WHEN** the agent locks `model` and no tier is decided
- **THEN** the route records reason `untouched`, no tier, and locked

#### Scenario: Thinking locked
- **WHEN** the agent locks `thinking` and the decided tier is `fast`
- **THEN** the route writes the `fast` model and no thinking, recording no effort and locked

#### Scenario: Model locked with a slot decided
- **WHEN** the agent locks `model`, `tier.choice` is `slot::reviewer` at .9 and `effort.choice` is `high`
- **THEN** the route writes thinking `high` and no model, recording tier `slot::reviewer`, reason `slot` and locked, with no fallback

## ADDED Requirements

### Requirement: Slot rule
Rule `slot` SHALL match when `tier.choice` is an offered `slot::<name>` whose probability is at least .6, and MUST decide that slot. Rules `expert-admitted` and `risky` MUST win over rule `slot`.

#### Scenario: Slot at the bar
- **WHEN** `tier.choice` is `slot::reviewer` at exactly .6
- **THEN** the target is `slot::reviewer` with reason `slot`

#### Scenario: Risk wins over a slot
- **WHEN** `tier.choice` is `slot::reviewer` at .95 and `risky` is .8
- **THEN** the tier is `deep` with reason `risky`

#### Scenario: Two slots
- **WHEN** slots `reviewer` and `bulk` are offered and `tier.choice` is `slot::bulk` at .7
- **THEN** the target is `slot::bulk` with reason `slot`

### Requirement: Slot below the bar
When `tier.choice` is a slot that rule `slot` does not decide, the later rules SHALL read as `tier.choice` the offered tier with the highest probability. A missing probability MUST count as 0, and a tie MUST go to the lower tier in the order `fast`, `balanced`, `deep`, `expert`. With no tier offered, no target SHALL be decided.

#### Scenario: Slot below the bar
- **WHEN** `tier.choice` is `slot::reviewer` at .5, and the probabilities are `balanced` .3, `deep` .15, `fast` .05
- **THEN** the tier is `balanced` with reason `choice`

#### Scenario: Below the bar into unsure fast
- **WHEN** `tier.choice` is `slot::reviewer` at .55, and the probabilities are `fast` .4, `balanced` .05
- **THEN** the tier is `balanced` with reason `fast-unsure`

#### Scenario: Below the bar into expert denied
- **WHEN** the mode is `standard`, `tier.choice` is `slot::reviewer` at .5, the highest tier probability is `expert` .3, and `deep` is offered
- **THEN** the tier is `deep` with reason `expert-denied`

#### Scenario: Slot not offered
- **WHEN** the answers (built directly) have `tier.choice` `slot::old` at .9 and no slot `old` is offered
- **THEN** rule `slot` does not match and the highest-probability offered tier is read as the choice

#### Scenario: Slot choice never passes the standard expert gate
- **WHEN** the mode is `standard`, `tier.choice` is `slot::reviewer` at .5, the highest tier probability is `expert` .3, `expert_needed` is .95, and `deep` is offered
- **THEN** the tier is `deep` with reason `expert-denied`

#### Scenario: Slot choice never passes the premium expert gate
- **WHEN** the mode is `premium`, all four tiers are offered, `tier.choice` is `slot::reviewer` at .5 with `P(expert)` .3 and `P(deep)` .1, and `effort.choice` is `max`
- **THEN** rule `expert-admitted` does not match and the tier is `deep` with reason `expert-denied`

## ADDED Requirements

### Requirement: Decision order
A pure function SHALL decide a worker's tier from the worker answers and the offered tiers by applying the rules `fable`, `risky`, `expert-denied`, `fast-unsure` and `choice` in that order, the first match winning, and SHALL return the tier with the name of the rule as its reason. The rules MUST read Jev's raw answers, before any cap or clamp.

#### Scenario: Ordinary choice
- **WHEN** `tier.choice` is `deep` and `risky` is .1
- **THEN** the tier is `deep` with reason `choice`

### Requirement: Fable rule
Rule `fable` SHALL match when `tier.choice` is `expert` and `expert_needed > .9`, and MUST decide `expert`. It wins over the risk floor.

#### Scenario: Fable passes
- **WHEN** `tier.choice` is `expert` and `expert_needed` is .95
- **THEN** the tier is `expert` with reason `fable`

#### Scenario: Fable boundary
- **WHEN** `tier.choice` is `expert` and `expert_needed` is exactly .9
- **THEN** the tier is `deep` with reason `expert-denied`

#### Scenario: Expert stands on high risk
- **WHEN** `tier.choice` is `expert`, `expert_needed` is .95 and `risky` is .9
- **THEN** the tier is `expert` with reason `fable`

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
Rule `expert-denied` SHALL match when `tier.choice` is `expert` and rule `fable` did not, and MUST decide `deep` if offered, else the highest offered tier below `expert`.

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
An unanswered `expert_needed` MUST count as not passing rule 1, and an unanswered `risky` as not passing rule 2. Rule 2 MUST apply even when `tier` is unanswered. Without a `tier` answer and without rule 2, or with no tier offered, no tier SHALL be decided.

#### Scenario: Risk floor without a tier answer
- **WHEN** `tier` is unanswered and `risky` is .9 and `deep` is offered
- **THEN** the tier is `deep` with reason `risky`

#### Scenario: Expert needed unanswered
- **WHEN** `tier.choice` is `expert`, `expert_needed` is unanswered and `deep` is offered
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

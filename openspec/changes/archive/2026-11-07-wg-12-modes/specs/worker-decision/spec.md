## MODIFIED Requirements

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

### Requirement: Expert denied rule
Rule `expert-denied` SHALL match when `tier.choice` is `expert` and rule `expert-admitted` did not, and MUST decide `deep` if offered, else the highest offered tier below `expert`.

#### Scenario: Expert denied without deep
- **WHEN** only `balanced` and `expert` are offered, `tier.choice` is `expert` and `expert_needed` is .5
- **THEN** the tier is `balanced` with reason `expert-denied`

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

## ADDED Requirements

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

## REMOVED Requirements

### Requirement: Fable rule

**Reason**: Replaced by "Expert admitted rule", which is named after the tier's role rather than one vendor's model and takes the mode's expert gate.

**Migration**: The ledger and route reason `fable` becomes `expert-admitted`; callers of the decision pass the mode.

## ADDED Requirements

### Requirement: Mode names
The modes SHALL be exactly `budget`, `standard` and `premium`, with `standard` the default. The pure policy layer MUST hold the same list as the state store, so that a mode the store accepts is always one the policy knows.

#### Scenario: Policy and store agree
- **WHEN** the policy's mode names are compared with the state store's mode names
- **THEN** they are equal, in the same order

### Requirement: What a mode selects
A mode SHALL select exactly one tier rubric, one `expert_needed` wording and one expert gate, for worker requests only. Every other question, threshold and rule MUST be the same in every mode: the `effort` and `risky` questions, the risk floor, the `fast` probability bar, slot handling, effort rules, fallback, tool assessment and the whole main request.

#### Scenario: Only the tier criteria and expert wording differ
- **WHEN** worker questions offering all four tiers are built for `budget` and for `premium`
- **THEN** the `tier` instruction, `effort` and `risky` are identical, and only the `tier` criteria and the `expert_needed` wording differ

#### Scenario: Main request ignores the mode
- **WHEN** the main questions are built
- **THEN** the builder takes no mode input, and its output is unchanged by this change

### Requirement: Expert gate per mode
The expert gate SHALL be a pure function of the mode and Jev's raw worker answers, read before any cap or clamp. In `budget` and `standard` it MUST pass only when `tier.choice` is `expert` and `expert_needed > .9`. In `premium` it MUST pass only when `tier.choice` is `deep` or `expert`, `P(expert) ≥ .1`, and `effort.choice` is `xhigh` or `max`; `expert_needed` MUST NOT affect it. An answer the gate reads that is unanswered MUST count as not passing.

#### Scenario: Standard gate passes
- **WHEN** the mode is `standard`, `tier.choice` is `expert` and `expert_needed` is .95
- **THEN** the gate passes

#### Scenario: Standard gate boundary
- **WHEN** the mode is `standard`, `tier.choice` is `expert` and `expert_needed` is exactly .9
- **THEN** the gate does not pass

#### Scenario: Budget uses the standard gate
- **WHEN** the mode is `budget`, `tier.choice` is `expert` and `expert_needed` is .95
- **THEN** the gate passes

#### Scenario: Standard gate ignores effort
- **WHEN** the mode is `standard`, `tier.choice` is `deep`, `P(expert)` is .4, `effort.choice` is `max` and `expert_needed` is .5
- **THEN** the gate does not pass

#### Scenario: Premium gate from a deep choice
- **WHEN** the mode is `premium`, `tier.choice` is `deep`, `P(expert)` is exactly .1, `effort.choice` is `xhigh` and `expert_needed` is unanswered
- **THEN** the gate passes

#### Scenario: Premium gate from an expert choice
- **WHEN** the mode is `premium`, `tier.choice` is `expert`, `P(expert)` is .6, `effort.choice` is `max` and `expert_needed` is .1
- **THEN** the gate passes

#### Scenario: Premium probability boundary
- **WHEN** the mode is `premium`, `tier.choice` is `deep`, `P(expert)` is .099 and `effort.choice` is `max`
- **THEN** the gate does not pass

#### Scenario: Premium needs high effort
- **WHEN** the mode is `premium`, `tier.choice` is `expert`, `P(expert)` is .7 and `effort.choice` is `high`
- **THEN** the gate does not pass

#### Scenario: Premium needs a deep or expert choice
- **WHEN** the mode is `premium`, `tier.choice` is `balanced`, `P(expert)` is .3 and `effort.choice` is `max`
- **THEN** the gate does not pass

#### Scenario: Premium effort unanswered
- **WHEN** the mode is `premium`, `tier.choice` is `deep`, `P(expert)` is .3 and `effort` is unanswered
- **THEN** the gate does not pass

#### Scenario: Expert probability missing
- **WHEN** the mode is `premium`, `tier.choice` is `deep`, `effort.choice` is `xhigh`, and the `tier` probabilities have no `expert` entry
- **THEN** the gate does not pass

## MODIFIED Requirements

### Requirement: Offered tiers
The request builder SHALL offer, in the order `fast`, `balanced`, `deep`, `expert`, each tier that is configured, then each configured slot as `slot::<name>`, in config order. `expert` MUST be offered only when it is configured and the `expert` switch is on. Slots MUST be offered in every mode.

#### Scenario: Partial configuration
- **WHEN** only `fast` and `deep` are configured
- **THEN** the `tier` options are `fast`, `deep`

#### Scenario: Expert switched off
- **WHEN** all four tiers are configured and the `expert` switch is off
- **THEN** the `tier` options are `fast`, `balanced`, `deep`

#### Scenario: Slots after tiers
- **WHEN** `fast` and `balanced` are configured, and slots `reviewer` then `bulk`
- **THEN** the `tier` options are `fast`, `balanced`, `slot::reviewer`, `slot::bulk`

#### Scenario: No slot, request unchanged
- **WHEN** a request is built with all four tiers and no slot
- **THEN** its questions equal those built before slots existed, byte for byte

### Requirement: Worker questions
The request builder SHALL take the mode, and SHALL ask `effort` and `risky` in every worker request, `tier` when at least one tier or slot is offered, and `expert_needed` only when `expert` is offered. The builder MUST also return, from the same option lists, the question specs used to read the answers. The set of questions and their specs MUST NOT depend on the mode.

#### Scenario: No tier configured
- **WHEN** no tier and no slot is configured
- **THEN** the questions are exactly `effort` and `risky`

#### Scenario: Slot alone
- **WHEN** no tier is configured and slot `reviewer` is
- **THEN** the questions are `tier`, `effort` and `risky`, and the `tier` options are exactly `slot::reviewer`

#### Scenario: Expert offered
- **WHEN** `expert` is offered
- **THEN** the questions are `tier`, `effort`, `risky` and `expert_needed`, and the `tier` options, before any slot, end with `expert`

#### Scenario: Expert still asked in premium
- **WHEN** the mode is `premium` and `expert` is offered
- **THEN** `expert_needed` is asked, so its answer can be recorded for calibration

#### Scenario: Asked and accepted agree
- **WHEN** a request offers `fast`, `deep` and slot `reviewer`
- **THEN** the `tier` criteria keys and the `tier` spec options are both `fast`, `deep`, `slot::reviewer`

## ADDED Requirements

### Requirement: Slot criterion
Each offered slot's `tier` criterion SHALL be `<display name> (a custom model). <when>`, with the wording of `docs/jev-questions.md`, the same in every mode. The display name MUST be the slot model's display name when one is given, and otherwise the slot's configured `provider/id`. The `when` MUST be the slot's configured text, trimmed.

#### Scenario: Reviewer criterion
- **WHEN** slot `reviewer` has display name `GPT-6.1 Sol` and `when` `Choose for reviews. Not for fixing.`
- **THEN** its criterion is `GPT-6.1 Sol (a custom model). Choose for reviews. Not for fixing.`

#### Scenario: No display name
- **WHEN** slot `reviewer` has model `9router/gpt-6.1-sol` and no display name is given
- **THEN** its criterion starts with `9router/gpt-6.1-sol (a custom model). `

#### Scenario: Same in every mode
- **WHEN** the same slot is offered in `budget`, `standard` and `premium`
- **THEN** its criterion is identical in the three requests

#### Scenario: Slot answer read
- **WHEN** a request offers slot `reviewer` and Jev answers `tier` `slot::reviewer` with probabilities over every option
- **THEN** `tier` is answered with choice `slot::reviewer`, and its probabilities are kept for every option

### Requirement: No slot in the main request
When a main request asks a `tier` question, it MUST NOT offer any slot, whatever slots are configured.

#### Scenario: Main request with a slot configured
- **WHEN** slot `reviewer` is configured and a main request is built
- **THEN** no `slot::` key appears in its questions or specs

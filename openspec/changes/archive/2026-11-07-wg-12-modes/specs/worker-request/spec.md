## MODIFIED Requirements

### Requirement: Worker questions
The request builder SHALL take the mode, and SHALL ask `effort` and `risky` in every worker request, `tier` when at least one tier is offered, and `expert_needed` only when `expert` is offered. The builder MUST also return, from the same option lists, the question specs used to read the answers. The set of questions and their specs MUST NOT depend on the mode.

#### Scenario: No tier configured
- **WHEN** no tier is configured
- **THEN** the questions are exactly `effort` and `risky`

#### Scenario: Expert offered
- **WHEN** `expert` is offered
- **THEN** the questions are `tier`, `effort`, `risky` and `expert_needed`, and the `tier` options end with `expert`

#### Scenario: Expert still asked in premium
- **WHEN** the mode is `premium` and `expert` is offered
- **THEN** `expert_needed` is asked, so its answer can be recorded for calibration

#### Scenario: Asked and accepted agree
- **WHEN** a request offers `fast` and `deep`
- **THEN** the `tier` criteria keys and the `tier` spec options are both `fast`, `deep`

### Requirement: Question wording
Each worker question MUST carry `type`, `instructions` and `criteria`, with the wording of `docs/jev-questions.md`. `tier` SHALL use the same instruction in every mode and the active mode's rubric criteria for the offered tiers, each prefixed with the configured model's display name and `. ` when one is given. `effort` SHALL use the worker instruction and the five level criteria. `risky` SHALL use its instruction and `true` and `false` criteria. `expert_needed` SHALL use the `standard` wording in `budget` and `standard`, and the softer `premium` wording in `premium`.

#### Scenario: Wording matches the docs
- **WHEN** a request offering all four tiers is built in each of `budget`, `standard` and `premium`
- **THEN** every instruction and criterion equals the text in `docs/jev-questions.md` for its question and mode

#### Scenario: Standard request unchanged
- **WHEN** a request offering all four tiers is built in `standard`
- **THEN** its `tier` criteria and `expert_needed` question equal the `standard` text in `docs/jev-questions.md`, and the `fast` criterion starts with `Fast and low cost, for bounded work with nothing to decide`

#### Scenario: Budget expert criterion
- **WHEN** a request offering `expert` is built in `budget`
- **THEN** the `expert` criterion equals the `standard` one

#### Scenario: Premium wording
- **WHEN** a request offering all four tiers is built in `premium`
- **THEN** the `deep` criterion starts with `The default for real engineering` and the `expert_needed` instruction starts with `This task needs the strongest available reasoning`

#### Scenario: Display name prefix
- **WHEN** `fast` is configured with display name `Claude Haiku 5.5`
- **THEN** the `fast` criterion starts with `Claude Haiku 5.5. Fast and low cost`

#### Scenario: Missing display name
- **WHEN** no display name is given for `balanced`
- **THEN** the `balanced` criterion is the rubric text without a prefix

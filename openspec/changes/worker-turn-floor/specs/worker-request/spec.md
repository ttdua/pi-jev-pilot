## ADDED Requirements

### Requirement: Turns question
The `turns` question SHALL be a choice over exactly `short`, `medium`, `long` and `very_long`, in that order, worded as in `docs/jev-questions.md`. The wording MUST describe only the steps and tool calls the brief needs, and MUST state that knowledge and care are not turn signals. Its answer SHALL be read like every other worker answer (see Reading worker answers).

#### Scenario: Wording matches the docs
- **WHEN** a worker request asking `turns` is built
- **THEN** its `turns` instruction and criteria equal the text in `docs/jev-questions.md`

#### Scenario: Band order
- **WHEN** a worker request asking `turns` is built
- **THEN** the `turns` criteria keys and spec options are both `short`, `medium`, `long`, `very_long`

#### Scenario: Unknown band
- **WHEN** Jev answers `turns` with choice `huge`
- **THEN** `turns` is unanswered with reason `choice`, and the other answers are read as usual

#### Scenario: Jev failure
- **WHEN** the outcome of a request asking `turns` is a `timeout` miss
- **THEN** the result is a miss of kind `timeout` with no answers

## MODIFIED Requirements

### Requirement: Worker question set
The request builder SHALL take whether to ask the route questions and whether to ask `turns`. With the route questions, it SHALL ask `effort` and `risky`, and `tier` when at least one tier or slot is offered. With `turns`, it SHALL add the `turns` question after them. A request with `turns` only MUST ask exactly `turns`. It MUST NOT take a mode, and MUST NOT ask `expert_needed`. The builder MUST also return, from the same option lists, the question specs used to read the answers.

#### Scenario: No tier configured
- **WHEN** no tier and no slot is configured, and `turns` is not asked
- **THEN** the questions are exactly `effort` and `risky`

#### Scenario: Slot alone
- **WHEN** no tier is configured and slot `reviewer` is, and `turns` is not asked
- **THEN** the questions are `tier`, `effort` and `risky`, and the `tier` options are exactly `slot::reviewer`

#### Scenario: Expert offered
<!-- Intentional change: `expert` is renamed `frontier`. -->
- **WHEN** `frontier` is offered and `turns` is not asked
- **THEN** the questions are exactly `tier`, `effort` and `risky`, and the `tier` options, before any slot, end with `frontier`

#### Scenario: Asked and accepted agree
- **WHEN** a request offers `basic`, `deep` and slot `reviewer`
- **THEN** the `tier` criteria keys and the `tier` spec options are both `basic`, `deep`, `slot::reviewer`

#### Scenario: Turns with the route questions
- **WHEN** `basic` is offered and both the route questions and `turns` are asked
- **THEN** the questions are exactly `tier`, `effort`, `risky` and `turns`, in that order

#### Scenario: Turns only
- **WHEN** the route questions are not asked and `turns` is
- **THEN** the questions and specs are exactly `turns`

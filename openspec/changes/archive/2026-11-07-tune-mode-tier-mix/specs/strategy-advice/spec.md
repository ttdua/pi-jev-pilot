## MODIFIED Requirements

### Requirement: Strategy questions
When the `strategy` feature is on, a main request SHALL ask `tier` (a choice over `fast`, `balanced`, `deep`) and `strategy` (a choice over `direct`, `delegate`, `parallel`, `graph`), in that order, with the wording in `docs/jev-questions.md`. The `tier` criteria MUST be the main tier criteria, held apart from the worker rubric, without a model name prefix. When `strategy` is off, neither MUST be asked. The main `tier` answer MUST NOT change any model.

#### Scenario: Strategy on
- **WHEN** `strategy` is on and the operator submits an eligible prompt
- **THEN** the request's `questions` holds `tier` with criteria keys exactly `fast`, `balanced`, `deep` and `strategy` with criteria keys exactly `direct`, `delegate`, `parallel`, `graph`

#### Scenario: Tier criteria without a prefix
- **WHEN** `tiers.fast` is configured with a model that has a display name
- **THEN** the main `tier` criterion for `fast` equals the main tier criteria text exactly, with no display name before it

#### Scenario: Strategy off
- **WHEN** `strategy` is off and `effort` is on
- **THEN** the request's `questions` holds neither `tier` nor `strategy`

#### Scenario: Docs state no prefix for the main tier
- **WHEN** a reader opens the tier rubric section of `docs/jev-questions.md`
- **THEN** it states that the main `tier` question uses its own `fast`, `balanced` and `deep` criteria without a model display-name prefix

#### Scenario: Wording matches the docs
- **WHEN** the `tier` and `strategy` questions are built
- **THEN** every instruction and criterion appears verbatim in `docs/jev-questions.md`

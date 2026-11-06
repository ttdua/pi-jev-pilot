## ADDED Requirements

### Requirement: Worker state shape
The worker state builder SHALL produce exactly `task` and `agent`, plus `parent_request` only when that option is on. `agent` MUST hold `name`, `source`, `description`, `instructions_excerpt`, `declared_tools`, `max_turns` (the agent's own value) and `run_in_background` (the effective value). The state MUST NOT contain the agent's or the caller's `model` or `thinking`.

#### Scenario: Parent request off by default
- **WHEN** the parent request option is off
- **THEN** the state has no `parent_request` key

#### Scenario: No model in state
- **WHEN** the launch input sets `model` and `thinking`, and the agent file sets both
- **THEN** no value of either appears anywhere in the serialized state

### Requirement: Worker state text limits
Lengths SHALL count Unicode code points. `task.brief` MUST be the first 4000 characters of the launch prompt, `task.description` the launch description or the empty string, and `parent_request` the latest user prompt cut to its first 500 characters.

#### Scenario: Brief cut at 4000 characters
- **WHEN** the launch prompt is 6000 characters long
- **THEN** `task.brief` is its first 4000 characters

#### Scenario: Brief at the limit
- **WHEN** the launch prompt is exactly 4000 characters long, or 4001 characters ending in an emoji
- **THEN** `task.brief` is the whole prompt in the first case, and the first 4000 code points in the second, with no broken character

#### Scenario: Parent request on
- **WHEN** the option is on and the latest user prompt is 800 characters long
- **THEN** `parent_request` is its first 500 characters

### Requirement: Offered tiers
The request builder SHALL offer, in the order `fast`, `balanced`, `deep`, `expert`, each tier that is configured. `expert` MUST be offered only when it is configured and the `expert` switch is on. No slot options are offered in this change.

#### Scenario: Partial configuration
- **WHEN** only `fast` and `deep` are configured
- **THEN** the `tier` options are `fast`, `deep`

#### Scenario: Expert switched off
- **WHEN** all four tiers are configured and the `expert` switch is off
- **THEN** the `tier` options are `fast`, `balanced`, `deep`

### Requirement: Worker questions
The request builder SHALL ask `effort` and `risky` in every worker request, `tier` when at least one tier is offered, and `expert_needed` only when `expert` is offered. The builder MUST also return, from the same option lists, the question specs used to read the answers.

#### Scenario: No tier configured
- **WHEN** no tier is configured
- **THEN** the questions are exactly `effort` and `risky`

#### Scenario: Expert offered
- **WHEN** `expert` is offered
- **THEN** the questions are `tier`, `effort`, `risky` and `expert_needed`, and the `tier` options end with `expert`

#### Scenario: Asked and accepted agree
- **WHEN** a request offers `fast` and `deep`
- **THEN** the `tier` criteria keys and the `tier` spec options are both `fast`, `deep`

### Requirement: Question wording
Each worker question MUST carry `type`, `instructions` and `criteria`, with the wording of `docs/jev-questions.md`. `tier` SHALL use the `standard` rubric criteria for the offered tiers, each prefixed with the configured model's display name and `. ` when one is given. `effort` SHALL use the worker instruction and the five level criteria. `risky` and `expert_needed` (`standard` wording) SHALL use their instructions and `true` and `false` criteria.

#### Scenario: Wording matches the docs
- **WHEN** a request offers all four tiers
- **THEN** every instruction and criterion equals the text in `docs/jev-questions.md` for its question

#### Scenario: Display name prefix
- **WHEN** `fast` is configured with display name `Claude Haiku 5.5`
- **THEN** the `fast` criterion starts with `Claude Haiku 5.5. Fast and low cost`

#### Scenario: Missing display name
- **WHEN** no display name is given for `balanced`
- **THEN** the `balanced` criterion is the rubric text without a prefix

### Requirement: Reading worker answers
A worker request's outcome SHALL be read into worker answers: on an `ok` outcome, answers are read with the request's question specs, and each valid answer counts even when others are unanswered; on a `miss` outcome, or a body that reads as a `schema` miss, there are no answers and the miss kind is kept; on `cancelled`, the result is cancelled. Reading MUST NOT throw.

#### Scenario: Jev timeout or error
- **WHEN** the outcome is a `timeout` or `error` miss
- **THEN** the result is a miss of that kind with no answers

#### Scenario: Body without answers
- **WHEN** the outcome is `ok` with body `{"model":"jev-1.14.0"}`
- **THEN** the result is a miss of kind `schema`

#### Scenario: One bad answer
- **WHEN** `tier` is valid and `effort` has an unknown choice
- **THEN** `tier` is answered and `effort` is unanswered with reason `choice`

#### Scenario: Cancelled
- **WHEN** the outcome is `cancelled`
- **THEN** the result is cancelled, with no answers and no miss

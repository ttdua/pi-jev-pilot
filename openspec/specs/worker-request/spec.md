# worker-request Specification

## Purpose
The state and questions of one worker request to Jev, and how its answers, including every Jev failure, are read.

## Requirements

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

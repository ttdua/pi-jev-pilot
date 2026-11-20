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
The request builder SHALL offer, in the order `basic`, `broad`, `deep`, `frontier`, each tier that is configured, then each configured slot as `slot::<name>`, in config order. `frontier` MUST be offered only when it is configured and the `frontier` switch is on. Slots MUST always be offered.

#### Scenario: Partial configuration
- **WHEN** only `basic` and `deep` are configured
- **THEN** the `tier` options are `basic`, `deep`

#### Scenario: Expert switched off
<!-- Intentional change: the `expert` switch is renamed `frontier`. -->
- **WHEN** all four tiers are configured and the `frontier` switch is off
- **THEN** the `tier` options are `basic`, `broad`, `deep`

#### Scenario: Slots after tiers
- **WHEN** `basic` and `broad` are configured, and slots `reviewer` then `bulk`
- **THEN** the `tier` options are `basic`, `broad`, `slot::reviewer`, `slot::bulk`

#### Scenario: No slot, request unchanged
- **WHEN** a request is built with all four tiers and no slot
- **THEN** its `tier` options are exactly `basic`, `broad`, `deep`, `frontier`, with no `slot::` key

### Requirement: Question wording
Each worker question MUST carry `type`, `instructions` and `criteria`, with the wording of `docs/jev-questions.md`. `tier` SHALL use one instruction and one set of criteria for the offered tiers, the worker knowledge rubric, each prefixed with the configured model's display name and `. ` when one is given. The tier wording MUST describe only the knowledge a task needs and MUST state that length, number of steps, care and risk are not tier signals. `effort` SHALL use the worker instruction and the five level criteria; the effort wording MUST describe only the amount of work and care (steps, tracing, tool use, verification) and MUST state that how rare the knowledge is, is not an effort signal. `risky` SHALL use its instruction and `true` and `false` criteria.

#### Scenario: Wording matches the docs
- **WHEN** a request offering all four tiers is built
- **THEN** every instruction and criterion equals the text in `docs/jev-questions.md` for its question

#### Scenario: Premium wording
<!-- Intentional change: rubric version 3 asks about knowledge. -->
- **WHEN** a request offering all four tiers is built
- **THEN** the `tier` instruction starts with `Which is the least knowledgeable model tier that has the knowledge this task needs?`

#### Scenario: Standard request unchanged
<!-- Intentional change: rubric version 3 replaces the difficulty wording with knowledge wording. -->
- **WHEN** a request offering `basic` is built
- **THEN** the `basic` criterion starts with `Common, well-documented knowledge.`

#### Scenario: Budget expert criterion
<!-- Intentional change: `expert` is renamed `frontier` with knowledge wording. -->
- **WHEN** a request offering `frontier` is built
- **THEN** the `frontier` criterion starts with `Rare, frontier-level expertise.`, and no `expert_needed` question is asked

#### Scenario: Effort instruction asks about work
- **WHEN** a worker request is built
- **THEN** the `effort` instruction starts with `How much work and care does a subagent need to put into carrying out this brief`

#### Scenario: Main criteria held apart
<!-- Intentional change: the main request no longer asks `tier`; the scenario now checks that the worker rubrics do not overlap. -->
- **WHEN** the `tier` criteria and the `effort` criteria are read
- **THEN** no `tier` criterion names an unknown bug cause, the number of files or steps, or a security or production label as a reason to choose it

#### Scenario: Display name prefix
- **WHEN** `basic` is configured with display name `Claude Haiku 5.5`
- **THEN** the `basic` criterion starts with `Claude Haiku 5.5. Common, well-documented knowledge.`

#### Scenario: Missing display name
- **WHEN** no display name is given for `broad`
- **THEN** the `broad` criterion is the rubric text without a prefix

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
Each offered slot's `tier` criterion SHALL be `<display name> (a custom model). <when>`, with the wording of `docs/jev-questions.md`. The display name MUST be the slot model's display name when one is given, and otherwise the slot's configured `provider/id`. The `when` MUST be the slot's configured text, trimmed.

#### Scenario: Reviewer criterion
- **WHEN** slot `reviewer` has display name `GPT-6.1 Sol` and `when` `Choose for reviews. Not for fixing.`
- **THEN** its criterion is `GPT-6.1 Sol (a custom model). Choose for reviews. Not for fixing.`

#### Scenario: No display name
- **WHEN** slot `reviewer` has model `9router/gpt-6.1-sol` and no display name is given
- **THEN** its criterion starts with `9router/gpt-6.1-sol (a custom model). `

#### Scenario: Same in every mode
- **WHEN** the same slot is offered while the mode is `budget`, then `premium`
- **THEN** its criterion is identical in the two requests, since the builder takes no mode

#### Scenario: Slot answer read
- **WHEN** a request offers slot `reviewer` and Jev answers `tier` `slot::reviewer` with probabilities over every option
- **THEN** `tier` is answered with choice `slot::reviewer`, and its probabilities are kept for every option

### Requirement: No slot in the main request
A main request MUST NOT ask a `tier` question and MUST NOT offer any slot, whatever tiers and slots are configured.

#### Scenario: Main request with a slot configured
- **WHEN** slot `reviewer` is configured and a main request is built
- **THEN** no `slot::` key appears in its questions or specs

#### Scenario: Main request has no tier
- **WHEN** a main request is built with `strategy` on and all four tiers configured
- **THEN** its questions have no `tier` key

### Requirement: Rubric version
The package SHALL hold one integer rubric version next to the worker `tier` wording, `3` for the knowledge rubric (the per-mode rubrics count as `1`, the single difficulty rubric as `2`). Any change to the worker `tier` instruction or criteria MUST raise it. The worker ledger line SHALL record it.

#### Scenario: Version of this rubric
- **WHEN** the rubric version is read
- **THEN** it is `3`

#### Scenario: Wording pinned to the version
- **WHEN** the worker `tier` instruction and criteria are compared with the snapshot kept for rubric version `3`
- **THEN** they are equal, so changing the wording without raising the version fails a test

### Requirement: Worker question set
The request builder SHALL ask `effort` and `risky` in every worker request, and `tier` when at least one tier or slot is offered. It MUST NOT take a mode, and MUST NOT ask `expert_needed`. The builder MUST also return, from the same option lists, the question specs used to read the answers.

#### Scenario: No tier configured
- **WHEN** no tier and no slot is configured
- **THEN** the questions are exactly `effort` and `risky`

#### Scenario: Slot alone
- **WHEN** no tier is configured and slot `reviewer` is
- **THEN** the questions are `tier`, `effort` and `risky`, and the `tier` options are exactly `slot::reviewer`

#### Scenario: Expert offered
<!-- Intentional change: `expert` is renamed `frontier`. -->
- **WHEN** `frontier` is offered
- **THEN** the questions are exactly `tier`, `effort` and `risky`, and the `tier` options, before any slot, end with `frontier`

#### Scenario: Asked and accepted agree
- **WHEN** a request offers `basic`, `deep` and slot `reviewer`
- **THEN** the `tier` criteria keys and the `tier` spec options are both `basic`, `deep`, `slot::reviewer`

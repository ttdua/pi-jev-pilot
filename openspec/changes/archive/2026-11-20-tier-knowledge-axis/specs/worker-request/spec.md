## MODIFIED Requirements

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

### Requirement: No slot in the main request
A main request MUST NOT ask a `tier` question and MUST NOT offer any slot, whatever tiers and slots are configured.

#### Scenario: Main request with a slot configured
- **WHEN** slot `reviewer` is configured and a main request is built
- **THEN** no `slot::` key appears in its questions or specs

#### Scenario: Main request has no tier
- **WHEN** a main request is built with `strategy` on and all four tiers configured
- **THEN** its questions have no `tier` key

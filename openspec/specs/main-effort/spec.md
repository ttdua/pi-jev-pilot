# main-effort Specification

## Purpose
Before each eligible main prompt the package asks Jev for `effort`, `risky` and `corrects` (plus the skill questions when skills apply), turns the answers into a thinking level with fixed rules, and applies it before the turn's first provider request; a Jev failure, a manual change during the wait, or Esc leaves the session as it was.

## Requirements

### Requirement: Eligible main prompts
A main decision SHALL be attempted only when every condition holds: the run was started by a user prompt (`messageType` `user`), the trimmed prompt is not empty, the session is not a child session, `config.json` is valid, the API key variable is set, a model is selected, and the `effort` feature is on or skills apply (as `skill-delivery` defines: `skills` on, no explicit skill, and a non-empty catalog). When any condition fails, the package MUST send no Jev request, MUST leave the thinking level unchanged, MUST attach no skill, and MUST write no ledger line.

#### Scenario: User prompt with effort on
- **WHEN** the operator submits a non-empty prompt in a main session with the key set and `effort` on
- **THEN** exactly one Jev request is sent before the turn's first provider request, when the catalog holds at most 254 skills

#### Scenario: Effort off, skills apply
- **WHEN** `effort` is off, `skills` is on, the catalog holds skills, and the operator submits a prompt
- **THEN** exactly one Jev request is sent, and the level is unchanged

#### Scenario: Effort off
- **WHEN** the operator has run `/jev effort off` and `/jev skills off` and submits a prompt
- **THEN** no Jev request is sent, the level is unchanged and no ledger line is written

#### Scenario: Effort off and empty catalog
- **WHEN** `effort` is off, `skills` is on, and no skill is listed
- **THEN** no Jev request is sent and no ledger line is written

#### Scenario: Effort off and explicit skill
- **WHEN** `effort` is off, `skills` is on, and the operator submits `/skill:debug fix it`
- **THEN** no Jev request is sent and no ledger line is written

#### Scenario: Run started by a custom message
- **WHEN** an extension starts a run with `pi.sendMessage(..., { triggerTurn: true })`
- **THEN** no Jev request is sent

#### Scenario: Child session
- **WHEN** a worker's child session starts a run
- **THEN** no Jev request is sent from that session

#### Scenario: No key
- **WHEN** the key variable is unset and the operator submits a prompt
- **THEN** no Jev request is sent and the run is identical to one without the package

#### Scenario: Empty prompt
- **WHEN** the prompt is whitespace only
- **THEN** no Jev request is sent

#### Scenario: Invalid config
- **WHEN** `config.json` is invalid and the key is set
- **THEN** no Jev request is sent and no ledger line is written

### Requirement: Main questions
A main request SHALL ask `corrects` (a noul). When the `effort` feature is on, the selected model supports at least two levels from `low` upward, and the prompt is not held (see `effort-hold`), it MUST also ask `effort` (a choice over `low`, `medium`, `high`, `xhigh`, `max`, in that order) and `risky` (a noul), before `corrects`. When skills apply, the first batch's skill questions follow `corrects`, as `skill-pick` defines. A hold applies only while `effort` is on. Wording follows `docs/jev-questions.md`. No other question MUST be asked.

#### Scenario: Reasoning model
- **WHEN** `effort` is on, skills do not apply, and the selected model is a reasoning model supporting `low` to `high`
- **THEN** the request's `questions` has exactly the keys `effort`, `risky` and `corrects`, and `effort.criteria` has exactly the keys `low`, `medium`, `high`, `xhigh`, `max`

#### Scenario: Non-reasoning model
- **WHEN** `effort` is on, skills do not apply, and the selected model is not a reasoning model
- **THEN** the request's `questions` has exactly the key `corrects`, and the level is never changed

#### Scenario: Effort and skills
- **WHEN** `effort` is on, skills apply, and the model is a reasoning model supporting `low` to `high`
- **THEN** the request's `questions` keys are, in order, `effort`, `risky`, `corrects`, `which`, `gate::acts_on_user_system`, `gate::would_follow_documented_procedure`, `gate::prose_suffices`

#### Scenario: Skills only
- **WHEN** `effort` is off and skills apply
- **THEN** the request's `questions` keys are, in order, `corrects`, `which` and the three gates

#### Scenario: Held prompt
- **WHEN** the prompt is held and skills do not apply
- **THEN** the request's `questions` has exactly the key `corrects`

#### Scenario: Held prompt with skills
- **WHEN** the prompt is held and skills apply
- **THEN** the request's `questions` keys are `corrects`, `which` and the three gates

### Requirement: Question wire format
Each question SHALL use the TypeSafe wire format: a choice carries `type` `choice`, `instructions` and `criteria` mapping each option to its description; a noul carries `type` `noul`, `instructions` and `criteria` with `true` and `false`. The three skill gates `gate::acts_on_user_system`, `gate::would_follow_documented_procedure` and `gate::prose_suffices` are the only exception: each MUST carry exactly `type` `noul` and `instructions`, with no `criteria`.

#### Scenario: Choice shape
- **WHEN** the `effort` question is built
- **THEN** it has exactly the keys `type`, `instructions` and `criteria`, and each `criteria` value is the level's criterion text

#### Scenario: Noul shape
- **WHEN** the `risky` question is built
- **THEN** its `criteria` has exactly the keys `true` and `false`

#### Scenario: Skill gate shape
- **WHEN** the skill gates are built
- **THEN** each has exactly the keys `type` and `instructions`, and `type` is `noul`

### Requirement: Supported levels
The supported levels of a model SHALL follow Pi's rule: a model that is not a reasoning model supports only `off`; otherwise every level from `off` to `max` is supported except a level whose `thinkingLevelMap` value is `null`, and `xhigh` and `max` are supported only when their map value is defined. The rule MUST be a pure function with no Pi import.

#### Scenario: Reasoning model without a map
- **WHEN** the model is a reasoning model with no `thinkingLevelMap`
- **THEN** its supported levels are `off`, `minimal`, `low`, `medium`, `high`

#### Scenario: Map enables xhigh and disables minimal
- **WHEN** the map gives `xhigh` a value and `minimal` the value `null`
- **THEN** its supported levels are `off`, `low`, `medium`, `high`, `xhigh`

#### Scenario: Not a reasoning model
- **WHEN** the model is not a reasoning model
- **THEN** its supported levels are `off` only

### Requirement: Effort rule
The requested level SHALL be Jev's `effort.choice`, raised to `high` when it is lower and `risky` is answered and greater than 0.7, then lowered to `xhigh` when it is `max`. The target level SHALL be the requested level clamped to the model's supported levels: the requested level when supported, else the nearest supported level above it, else the nearest below. `confidence` MUST NOT affect the result. The rule MUST be a pure function with no Pi import.

#### Scenario: Choice applies as is
- **WHEN** `effort` is `medium` and `risky` is 0.2 on a model supporting `off` to `high`
- **THEN** requested and target are `medium`

#### Scenario: Risk floor
- **WHEN** `effort` is `low` and `risky` is 0.71
- **THEN** requested is `high`

#### Scenario: Risk floor boundary
- **WHEN** `effort` is `low` and `risky` is exactly 0.7
- **THEN** requested is `low`

#### Scenario: Risk floor does not lower
- **WHEN** `effort` is `xhigh` and `risky` is 0.9 on a model supporting `xhigh`
- **THEN** requested is `xhigh`

#### Scenario: Ceiling
- **WHEN** `effort` is `max`
- **THEN** requested is `xhigh`

#### Scenario: Clamp down
- **WHEN** requested is `xhigh` on a model supporting `off` to `high`
- **THEN** target is `high`

#### Scenario: Clamp up
- **WHEN** requested is `low` on a model whose map marks `low` as unsupported and supports `medium`
- **THEN** target is `medium`

#### Scenario: Risky unanswered
- **WHEN** `effort` is `low` and `risky` is unanswered
- **THEN** requested is `low`

#### Scenario: Low confidence still applies
- **WHEN** `effort` is `high` with confidence 0.1
- **THEN** requested is `high`

### Requirement: Level applied before the first request
When `effort` is answered and no rule below prevents it, the package SHALL set the session's thinking level to the target before the turn's first provider request, through `pi.setThinkingLevel`, and MUST NOT change the model.

#### Scenario: Level on the first request
- **WHEN** the session level is `low` and Jev answers `effort` `xhigh` with `risky` 0.1 on a model supporting `xhigh`
- **THEN** the turn's first provider request carries reasoning effort `xhigh`

#### Scenario: Same level
- **WHEN** the target equals the current level
- **THEN** no thinking-level change entry is added to the session

#### Scenario: Model unchanged
- **WHEN** any main decision is applied
- **THEN** the provider request uses the model selected before the prompt

### Requirement: Max is kept
When the session's level is `max` before the request, the package MUST NOT change it, and Jev MUST still be asked so the answers are recorded.

#### Scenario: Operator set max
- **WHEN** the session level is `max` and Jev answers `effort` `low`
- **THEN** the first provider request carries `max`, and the ledger line has `requested` `low` and `effective` `max`

### Requirement: Discarded on a manual change
When the thinking level differs, after Jev answers, from the level read before the request, the result SHALL be discarded: the package MUST NOT change the level for that turn. The next eligible prompt decides again.

#### Scenario: Operator changes the level while Jev answers
- **WHEN** the session level is `low`, Jev delays its answer, the operator sets `medium` during the delay, and Jev then answers `xhigh`
- **THEN** the first provider request carries `medium`, and the ledger line has `requested` `xhigh` and no `effective`

#### Scenario: Next prompt decides again
- **WHEN** a result was discarded and the operator submits another prompt
- **THEN** a new Jev request is sent and its result applies

### Requirement: Jev failure changes nothing
When the request is a miss (`timeout`, `error` or `schema`), or `effort` is unanswered, the package SHALL leave the thinking level unchanged and let the turn proceed. On a miss, provider requests MUST be identical to a run without the package; when only `effort` is unanswered, they MUST differ from such a run only by a skill message attached under `skill-delivery`. The added wait MUST NOT exceed the configured timeout plus the time to build the state and read the catalog.

#### Scenario: Jev returns 500
- **WHEN** the Jev fixture answers HTTP 500
- **THEN** the turn's provider requests equal those of the same run without the package

#### Scenario: Jev times out
- **WHEN** the Jev fixture never answers and `timeoutMs` is 300
- **THEN** the first provider request starts within 800 ms after the prompt, at the unchanged level

#### Scenario: Effort unanswered
- **WHEN** Jev answers `risky` and `corrects` but `effort` has an unknown choice
- **THEN** the level is unchanged

### Requirement: Cancelled turn starts nothing
When the operator cancels while the package is waiting for Jev, the turn SHALL make no provider request, and if the package applied a level for that turn and the run settles aborted with no provider request, the package MUST restore the level read before the request, unless the current level differs from the level the package applied. No ledger line, turn entry or status change MUST result from such a turn. When the Jev client reports `cancelled`, the package MUST change nothing for that turn.

#### Scenario: Esc during classification
- **WHEN** the session level is `low`, Jev delays its answer, the operator aborts during the delay, and Jev then answers `xhigh`
- **THEN** no provider request is made, the level after the run settles is `low`, and no ledger line is written

#### Scenario: Operator change after the apply is kept
- **WHEN** the package applied `high` from `low`, the operator set `medium`, and the run settles aborted with no provider request
- **THEN** the level stays `medium`

#### Scenario: Client reports cancelled
- **WHEN** the Jev client returns `cancelled` for a main request
- **THEN** the level is unchanged, no ledger line is written and the status line is unchanged

#### Scenario: Abort after the provider request
- **WHEN** the operator aborts after the first provider request has started
- **THEN** the applied level is kept and the turn is recorded with outcome `aborted`

### Requirement: Handler failures stay inside the package
An unexpected error in any main-decision handler MUST be caught inside the package. It MUST NOT propagate to Pi, block the turn, or write to stdout or stderr. An error before the level is applied MUST leave the level unchanged.

#### Scenario: Throwing state build
- **WHEN** reading the branch throws during `before_agent_start` (unit level, with an injected branch reader)
- **THEN** the turn proceeds at the unchanged level and Pi reports no extension error

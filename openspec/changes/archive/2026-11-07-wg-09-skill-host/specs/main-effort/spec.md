## MODIFIED Requirements

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

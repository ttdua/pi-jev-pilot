## MODIFIED Requirements

### Requirement: Eligible main prompts
A main decision SHALL be attempted only when every condition holds: the run was started by a user prompt (`messageType` `user`), the trimmed prompt is not empty, the session is not a child session, `config.json` is valid, the API key variable is set, the `effort` feature or the `strategy` feature is on, and a model is selected. When any condition fails, the package MUST send no Jev request, MUST leave the thinking level unchanged, MUST attach no advice, and MUST write no ledger line.

#### Scenario: User prompt with effort on
- **WHEN** the operator submits a non-empty prompt in a main session with the key set and `effort` on
- **THEN** exactly one Jev request is sent before the turn's first provider request

#### Scenario: Effort off, strategy on
- **WHEN** the operator has run `/jev effort off`, `strategy` is on, and the operator submits a prompt
- **THEN** exactly one Jev request is sent, and the level is unchanged

#### Scenario: Effort off
- **WHEN** the operator has run `/jev effort off` and `/jev strategy off` and submits a prompt
- **THEN** no Jev request is sent, the level is unchanged and no ledger line is written

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
A main request SHALL ask `corrects` (a noul). When the `effort` feature is on and the selected model supports at least two levels from `low` upward, it MUST also ask `effort` (a choice over `low`, `medium`, `high`, `xhigh`, `max`, in that order) and `risky` (a noul). When the `strategy` feature is on, it MUST also ask `tier` and `strategy` as the `strategy-advice` capability defines. Wording follows `docs/jev-questions.md`. No other question MUST be asked.

#### Scenario: Reasoning model
- **WHEN** `effort` is on, `strategy` is off, and the selected model is a reasoning model supporting `low` to `high`
- **THEN** the request's `questions` has exactly the keys `effort`, `risky` and `corrects`, and `effort.criteria` has exactly the keys `low`, `medium`, `high`, `xhigh`, `max`

#### Scenario: Non-reasoning model
- **WHEN** `effort` is on, `strategy` is off, and the selected model is not a reasoning model
- **THEN** the request's `questions` has exactly the key `corrects`, and the level is never changed

#### Scenario: Both features on
- **WHEN** `effort` and `strategy` are on and the model is a reasoning model supporting `low` to `high`
- **THEN** the request's `questions` has exactly the keys `effort`, `risky`, `tier`, `strategy` and `corrects`

#### Scenario: Strategy only
- **WHEN** `effort` is off and `strategy` is on
- **THEN** the request's `questions` has exactly the keys `tier`, `strategy` and `corrects`

#### Scenario: Non-reasoning model with strategy on
- **WHEN** `effort` and `strategy` are on and the selected model is not a reasoning model
- **THEN** the request's `questions` has exactly the keys `tier`, `strategy` and `corrects`

### Requirement: Discarded on a manual change
When the thinking level differs, after Jev answers, from the level read before the request, the effort result SHALL be discarded: the package MUST NOT change the level for that turn. The next eligible prompt decides again. Advice from the same answers is not affected, as the `strategy-advice` capability defines.

#### Scenario: Operator changes the level while Jev answers
- **WHEN** the session level is `low`, Jev delays its answer, the operator sets `medium` during the delay, and Jev then answers `xhigh`
- **THEN** the first provider request carries `medium`, and the ledger line has `requested` `xhigh` and no `effective`

#### Scenario: Next prompt decides again
- **WHEN** a result was discarded and the operator submits another prompt
- **THEN** a new Jev request is sent and its result applies

### Requirement: Jev failure changes nothing
When the request is a miss (`timeout`, `error` or `schema`), or `effort` is unanswered, the package SHALL leave the thinking level unchanged and let the turn proceed. On a miss, provider requests MUST be identical to a run without the package; when only `effort` is unanswered, they MUST differ from such a run only by advice attached under the `strategy-advice` capability. The added wait MUST NOT exceed the configured timeout plus the time to build the state.

#### Scenario: Jev returns 500
- **WHEN** the Jev fixture answers HTTP 500
- **THEN** the turn's provider requests equal those of the same run without the package

#### Scenario: Jev times out
- **WHEN** the Jev fixture never answers and `timeoutMs` is 300
- **THEN** the first provider request starts within 800 ms after the prompt, at the unchanged level

#### Scenario: Effort unanswered
- **WHEN** Jev answers `risky` and `corrects` but `effort` has an unknown choice
- **THEN** the level is unchanged

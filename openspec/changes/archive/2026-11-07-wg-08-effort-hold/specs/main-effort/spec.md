## MODIFIED Requirements

### Requirement: Main questions
A main request SHALL ask `effort` (a choice over `low`, `medium`, `high`, `xhigh`, `max`, in that order), `risky` (a noul) and `corrects` (a noul), with the wording in `docs/jev-questions.md`. When the selected model supports fewer than two levels from `low` upward, or the prompt is held (see `effort-hold`), `effort` and `risky` MUST NOT be asked, and only `corrects` is. No other question MUST be asked.

#### Scenario: Reasoning model
- **WHEN** the selected model is a reasoning model supporting `low` to `high`
- **THEN** the request's `questions` has exactly the keys `effort`, `risky` and `corrects`, and `effort.criteria` has exactly the keys `low`, `medium`, `high`, `xhigh`, `max`

#### Scenario: Non-reasoning model
- **WHEN** the selected model is not a reasoning model
- **THEN** the request's `questions` has exactly the key `corrects`, and the level is never changed

#### Scenario: Held prompt
- **WHEN** the prompt is held
- **THEN** the request's `questions` has exactly the key `corrects`

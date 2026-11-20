## MODIFIED Requirements

### Requirement: Main questions
A main request SHALL ask `corrects` (a noul). The effort result is applied (see "Effort rule") only when the `effort` feature is on, the selected model supports at least two levels from `low` upward, and the prompt is not held (see `effort-hold`); such a request MUST ask `effort` (a choice over the levels `low` to `max`, sent in the option order `high`, `medium`, `xhigh`, `low`, `max`, which the 2026-11-07 replay decided; policy still ranks `low` to `max`) and `risky` (a noul). When the `strategy` feature is on, it MUST ask `effort` and `strategy` as the `strategy-advice` capability defines, held or not, and whatever the model supports; it MUST NOT then ask `risky` unless the effort result is applied. `effort` MUST be asked at most once. When skills apply, the first batch's skill questions follow `corrects`, as `skill-pick` defines. A hold applies only while `effort` is on. Wording follows `docs/jev-questions.md`. No `tier` question and no other question MUST be asked.

#### Scenario: Reasoning model
- **WHEN** `effort` is on, `strategy` is off, skills do not apply, and the selected model is a reasoning model supporting `low` to `high`
- **THEN** the request's `questions` has exactly the keys `effort`, `risky` and `corrects`, and `effort.criteria` has exactly the keys `low`, `medium`, `high`, `xhigh`, `max`

#### Scenario: Non-reasoning model
- **WHEN** `effort` is on, `strategy` is off, skills do not apply, and the selected model is not a reasoning model
- **THEN** the request's `questions` has exactly the key `corrects`, and the level is never changed

#### Scenario: Both features on
- **WHEN** `effort` and `strategy` are on, skills do not apply, and the model is a reasoning model supporting `low` to `high`
- **THEN** the request's `questions` has exactly the keys `effort`, `risky`, `strategy` and `corrects`

#### Scenario: Strategy only
- **WHEN** `effort` is off, `strategy` is on, and skills do not apply
- **THEN** the request's `questions` has exactly the keys `effort`, `strategy` and `corrects`, and the level is unchanged

#### Scenario: Non-reasoning model with strategy on
- **WHEN** `effort` and `strategy` are on, skills do not apply, and the selected model is not a reasoning model
- **THEN** the request's `questions` has exactly the keys `effort`, `strategy` and `corrects`, and the level is never changed

#### Scenario: Effort and skills
- **WHEN** `effort` is on, `strategy` is off, skills apply, and the model is a reasoning model supporting `low` to `high`
- **THEN** the request's `questions` keys are, in order, `effort`, `risky`, `corrects`, `which`, `gate::acts_on_user_system`, `gate::would_follow_documented_procedure`, `gate::prose_suffices`

#### Scenario: Skills only
- **WHEN** `effort` and `strategy` are off and skills apply
- **THEN** the request's `questions` keys are, in order, `corrects`, `which` and the three gates

#### Scenario: Held prompt
- **WHEN** the prompt is held, `strategy` is off, and skills do not apply
- **THEN** the request's `questions` has exactly the key `corrects`

#### Scenario: Held prompt with strategy on
- **WHEN** the prompt is held, `strategy` is on, and skills do not apply
- **THEN** the request's `questions` has exactly the keys `effort`, `strategy` and `corrects`

#### Scenario: Held prompt with skills
- **WHEN** the prompt is held, `strategy` is off, and skills apply
- **THEN** the request's `questions` keys are `corrects`, `which` and the three gates

#### Scenario: Gate-only effort applies nothing
- **WHEN** `effort` is off, `strategy` is on, and Jev answers `effort` `xhigh`
- **THEN** the level is unchanged, the status line shows no effort suffix, and the ledger line has no `effortP` or `requested`

### Requirement: Level applied before the first request
When the effort result is applied (the request is effort-eligible: the `effort` feature is on, the model supports at least two levels from `low` upward, and the prompt is not held, see "Main questions") and `effort` is answered and no rule below prevents it, the package SHALL set the session's thinking level to the target before the turn's first provider request, through `pi.setThinkingLevel`, and MUST NOT change the model. An `effort` answer on a request that is not effort-eligible (asked only for the strategy gate) MUST NOT change the level or plan an effort target, and the answer itself MUST NOT set the effort status suffix; a held turn still shows the level in force, as `status-line` defines.

#### Scenario: Level on the first request
- **WHEN** the session level is `low` and Jev answers `effort` `xhigh` with `risky` 0.1 on a model supporting `xhigh`
- **THEN** the turn's first provider request carries reasoning effort `xhigh`

#### Scenario: Same level
- **WHEN** the target equals the current level
- **THEN** no thinking-level change entry is added to the session

#### Scenario: Model unchanged
- **WHEN** any main decision is applied
- **THEN** the provider request uses the model selected before the prompt

#### Scenario: Held gate-only effort shows the level in force
- **WHEN** a prompt is held with `strategy` on, the operator set `low` after an anchor at `high`, and Jev answers `effort` `xhigh`
- **THEN** the level stays `low` and the status line reads `Jev · standard · low`

#### Scenario: Gate-only effort on a non-reasoning model
- **WHEN** `effort` and `strategy` are on, the model is not a reasoning model, the previous turn showed suffix `high`, and Jev answers `effort` with an unknown choice
- **THEN** the level is unchanged and the status line still reads `Jev · standard · high`, not `no answer`

### Requirement: Reply rated by the work it approves
The main `effort` instruction SHALL tell Jev to rate a reply to the assistant's own question, proposal, review or approval request by the size of the work it approves or starts, read from the recent conversation, whatever the reply's length and format. It MUST NOT use reply length as a criterion: no `short`, and no examples chosen for their brevity. Like the worker instruction, it MUST rate the amount of work and care, and MUST say that how rare the knowledge is, is not an effort signal.

#### Scenario: Role rule in the main instruction
<!-- Intentional change: the main instruction is rewritten around work and care; the reply rule stays. -->
- **WHEN** a main request asking `effort` is built
- **THEN** its `effort.instructions` equals the main instruction in `docs/jev-questions.md`, still contains the reply rule, and has no word `short`

### Requirement: Reply rule leaves the rest unchanged
The main and worker `effort` requests SHALL share the five level criteria of `docs/jev-questions.md`, which describe the amount of work and care, in the option order `high`, `medium`, `xhigh`, `low`, `max`. The reply rule MUST NOT change the criteria or their order. When Jev's answer misses, *Jev failure changes nothing* SHALL apply unchanged.

#### Scenario: Criteria unchanged
<!-- Intentional change: the criteria are reworded around work and care; main and worker still share them. -->
- **WHEN** a main request and a worker request asking `effort` are built
- **THEN** their `effort.criteria` keys, order and values are equal, in the order `high`, `medium`, `xhigh`, `low`, `max`, and each value equals the level criterion in `docs/jev-questions.md`

#### Scenario: Worker instruction unchanged
<!-- Intentional change: the worker instruction is reworded around work and care. -->
- **WHEN** a worker request asking `effort` is built
- **THEN** its `effort.instructions` equals the worker instruction in `docs/jev-questions.md`

#### Scenario: Jev fails on a reply
- **WHEN** the prompt replies to the assistant's question and the Jev fixture answers HTTP 500
- **THEN** the thinking level is unchanged

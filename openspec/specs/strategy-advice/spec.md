# strategy-advice Specification

## Purpose
On eligible main prompts the package asks Jev `tier` and `strategy` and, when a fixed probability gate passes, attaches one hidden `<execution_strategy>` advice the model may ignore; `direct` and any Jev failure attach nothing.

## Requirements

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

### Requirement: Strategy gates
Advice SHALL be attached only when the gate for the chosen strategy passes, judged on the chosen option's probability and never on `confidence`:

| Strategy | Probability | Also |
|---|---|---|
| `direct` | never | |
| `delegate` | ≥ 0.6 | |
| `parallel` | ≥ 0.6 | `tier` is answered and is not `fast` |
| `graph` | ≥ 0.8 | `tier` is answered and is `deep` |

When `strategy` is unanswered, nothing MUST be attached. The gates MUST be a pure function with no Pi import.

#### Scenario: Direct attaches nothing
- **WHEN** `strategy` is `direct` with probability 1.0
- **THEN** no advice is attached

#### Scenario: Delegate at the boundary
- **WHEN** `strategy` is `delegate` with probability 0.6
- **THEN** advice for `delegate` is attached

#### Scenario: Delegate below the boundary
- **WHEN** `strategy` is `delegate` with probability 0.59
- **THEN** no advice is attached

#### Scenario: Parallel at the boundary
- **WHEN** `strategy` is `parallel` with probability 0.6 and `tier` is `balanced`
- **THEN** advice for `parallel` is attached

#### Scenario: Parallel below the boundary
- **WHEN** `strategy` is `parallel` with probability 0.59 and `tier` is `deep`
- **THEN** no advice is attached

#### Scenario: Parallel on the fast tier
- **WHEN** `strategy` is `parallel` with probability 0.9 and `tier` is `fast`
- **THEN** no advice is attached

#### Scenario: Graph at the boundary
- **WHEN** `strategy` is `graph` with probability 0.8 and `tier` is `deep`
- **THEN** advice for `graph` is attached

#### Scenario: Graph below the boundary
- **WHEN** `strategy` is `graph` with probability 0.79 and `tier` is `deep`
- **THEN** no advice is attached

#### Scenario: Graph off the deep tier
- **WHEN** `strategy` is `graph` with probability 0.95 and `tier` is `balanced`
- **THEN** no advice is attached

#### Scenario: Tier unanswered
- **WHEN** `strategy` is `parallel` or `graph` with probability 0.95 and `tier` is unanswered
- **THEN** no advice is attached

#### Scenario: Tier unanswered does not block delegate
- **WHEN** `strategy` is `delegate` with probability 0.7 and `tier` is unanswered
- **THEN** advice for `delegate` is attached

#### Scenario: Strategy unanswered
- **WHEN** `strategy` has an unknown choice
- **THEN** no advice is attached

#### Scenario: Confidence ignored
- **WHEN** `strategy` is `delegate` with probability 0.7 and confidence 0.1
- **THEN** advice for `delegate` is attached

### Requirement: Advice text
An attached advice SHALL be exactly the `<execution_strategy>` block in `docs/jev-questions.md`: the opening tag, the line naming the strategy, that strategy's `<how>` text, the line saying the model saw only the request and should otherwise work directly, and the closing tag. The text MUST NOT mention `junior`, a skill name or a confidence value.

#### Scenario: Delegate block
- **WHEN** advice for `delegate` is attached
- **THEN** its text starts with `<execution_strategy>`, contains `best carried out as: delegate.` and the `delegate` `<how>` text from the docs, and ends with `</execution_strategy>`

#### Scenario: No junior
- **WHEN** the block is built for each of `delegate`, `parallel` and `graph`
- **THEN** none contains `junior`

### Requirement: Advice delivery
An attached advice SHALL reach the model as one hidden custom message returned from that turn's `before_agent_start`, with `display: false`, and MUST be present in the turn's first provider request. When a skill message also attaches, the advice block follows the skill text in that one `jev-skill` message, as `skill-delivery` defines; otherwise the message has `customType` `jev-advice`. No advice MUST be attached in a child session, for an ineligible prompt, or when the Jev client reports `cancelled`.

#### Scenario: Advice reaches the provider
- **WHEN** Jev answers `strategy` `delegate` with probability 0.9 on an eligible prompt
- **THEN** the turn's first provider request contains the `delegate` block, and the session shows no visible message for it

#### Scenario: Direct leaves the request unchanged
- **WHEN** Jev answers `strategy` `direct`
- **THEN** the turn's provider requests contain no `<execution_strategy>` text

#### Scenario: Child session
- **WHEN** a worker's child session starts a run with `strategy` on
- **THEN** no Jev request is sent from that session and no advice is attached

#### Scenario: Cancelled before the answer
- **WHEN** the operator aborts while Jev answers, and the Jev client returns `cancelled`
- **THEN** no advice is attached and no provider request is made

### Requirement: Advice independent of effort
Whether advice is attached SHALL depend only on the `strategy` and `tier` answers. It MUST NOT depend on the effort result, so advice is still attached when the effort result is discarded on a manual level change, when a `max` level is kept, when `effort` is unanswered, or when `effort` is off.

#### Scenario: Kept on a manual change
- **WHEN** the operator changes the level while Jev answers, and Jev answers `effort` `xhigh` and `strategy` `delegate` with probability 0.9
- **THEN** the level is not changed by the package, and the `delegate` block is attached

#### Scenario: Effort off
- **WHEN** `effort` is off, `strategy` is on, and Jev answers `strategy` `delegate` with probability 0.9
- **THEN** the `delegate` block is attached and the level is unchanged

#### Scenario: Effort unanswered
- **WHEN** Jev answers `effort` with an unknown choice and `strategy` `delegate` with probability 0.9
- **THEN** the level is unchanged and the `delegate` block is attached

### Requirement: Advice fails open
When the main request is a miss (`timeout`, `error` or `schema`), or `strategy` is unanswered, no advice SHALL be attached and the turn proceeds. On a miss, provider requests MUST be identical to a run without the package.

#### Scenario: Jev returns 500
- **WHEN** `strategy` is on and the Jev fixture answers HTTP 500
- **THEN** the turn's provider requests contain no `<execution_strategy>` text and equal those of the same run without the package

#### Scenario: Jev times out
- **WHEN** `strategy` is on and the Jev fixture never answers within `timeoutMs`
- **THEN** no advice is attached and the turn proceeds

### Requirement: Advice precedence
Advice MUST NOT be enforced. The package MUST NOT block, rewrite or delay tools, subagent launches or skills because of advice. `docs/jev-contract.md` MUST state that user and project instructions and a loaded skill take precedence over advice.

#### Scenario: Docs state precedence
- **WHEN** a reader opens the strategy gates section of `docs/jev-contract.md`
- **THEN** it states that user and project instructions and a loaded skill take precedence over advice

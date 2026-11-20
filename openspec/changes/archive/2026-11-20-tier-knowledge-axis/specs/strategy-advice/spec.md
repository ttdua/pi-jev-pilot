## MODIFIED Requirements

### Requirement: Strategy questions
When the `strategy` feature is on, a main request SHALL ask `effort` (a choice over `low` to `max`, as `main-effort` defines) and `strategy` (a choice over `direct`, `delegate`, `parallel`, `graph`), with the wording in `docs/jev-questions.md`; `effort` MUST be asked even when the `effort` feature is off or the prompt is held, so the strategy gate can read it. A main request MUST NOT ask `tier`. When `strategy` is off, `strategy` MUST NOT be asked. The `effort` answer read for the gate MUST NOT change any model.

#### Scenario: Strategy on
- **WHEN** `strategy` is on and the operator submits an eligible prompt
- **THEN** the request's `questions` holds `effort` with criteria keys exactly `low`, `medium`, `high`, `xhigh`, `max` and `strategy` with criteria keys exactly `direct`, `delegate`, `parallel`, `graph`, and no `tier`

#### Scenario: Tier criteria without a prefix
<!-- Intentional change: the main request no longer asks `tier`; the scenario now checks `effort` is asked when only `strategy` is on. -->
- **WHEN** `strategy` is on, `effort` is off, and the operator submits an eligible prompt
- **THEN** the request's `questions` holds `effort` and `strategy`, and the thinking level is unchanged

#### Scenario: Strategy off
- **WHEN** `strategy` is off and `effort` is on
- **THEN** the request's `questions` holds no `strategy` and no `tier`

#### Scenario: Docs state no prefix for the main tier
<!-- Intentional change: the main request no longer asks `tier`. -->
- **WHEN** a reader opens the tier rubric section of `docs/jev-questions.md`
- **THEN** it states that the main request asks no `tier` and that the strategy gate reads `effort`

#### Scenario: Wording matches the docs
- **WHEN** the `effort` and `strategy` questions are built
- **THEN** every instruction and criterion appears verbatim in `docs/jev-questions.md`

### Requirement: Strategy gates
Advice SHALL be attached only when the gate for the chosen strategy passes, judged on the chosen option's probability and never on `confidence`, and on Jev's raw `effort.choice` (before any risk lift, ceiling or clamp):

| Strategy | Probability | Also |
|---|---|---|
| `direct` | never | |
| `delegate` | ≥ 0.6 | `effort` is unanswered, or at least `medium` |
| `parallel` | ≥ 0.6 | `effort` is answered and at least `medium` |
| `graph` | ≥ 0.8 | `effort` is answered and at least `xhigh` |

Effort ranks are `low` < `medium` < `high` < `xhigh` < `max`. When `strategy` is unanswered, nothing MUST be attached. The gates MUST be a pure function with no Pi import.

#### Scenario: Direct attaches nothing
- **WHEN** `strategy` is `direct` with probability 1.0
- **THEN** no advice is attached

#### Scenario: Delegate at the boundary
- **WHEN** `strategy` is `delegate` with probability 0.6 and `effort` is `medium`
- **THEN** advice for `delegate` is attached

#### Scenario: Delegate below the boundary
- **WHEN** `strategy` is `delegate` with probability 0.59 and `effort` is `high`
- **THEN** no advice is attached

#### Scenario: Delegate on low effort
- **WHEN** `strategy` is `delegate` with probability 0.9 and `effort` is `low`
- **THEN** no advice is attached

#### Scenario: Parallel at the boundary
- **WHEN** `strategy` is `parallel` with probability 0.6 and `effort` is `medium`
- **THEN** advice for `parallel` is attached

#### Scenario: Parallel below the boundary
- **WHEN** `strategy` is `parallel` with probability 0.59 and `effort` is `xhigh`
- **THEN** no advice is attached

#### Scenario: Parallel on the fast tier
<!-- Intentional change: the gate reads `effort` instead of `tier`. -->
- **WHEN** `strategy` is `parallel` with probability 0.9 and `effort` is `low`
- **THEN** no advice is attached

#### Scenario: Graph at the boundary
- **WHEN** `strategy` is `graph` with probability 0.8 and `effort` is `xhigh`
- **THEN** advice for `graph` is attached

#### Scenario: Graph below the boundary
- **WHEN** `strategy` is `graph` with probability 0.79 and `effort` is `max`
- **THEN** no advice is attached

#### Scenario: Graph off the deep tier
<!-- Intentional change: the gate reads `effort` instead of `tier`. -->
- **WHEN** `strategy` is `graph` with probability 0.95 and `effort` is `high`
- **THEN** no advice is attached

#### Scenario: Gate reads the raw choice
- **WHEN** `strategy` is `graph` with probability 0.9, `effort` is `max`, and the model supports levels only up to `high`
- **THEN** advice for `graph` is attached

#### Scenario: Tier unanswered
<!-- Intentional change: the gate reads `effort` instead of `tier`. -->
- **WHEN** `strategy` is `parallel` or `graph` with probability 0.95 and `effort` is unanswered
- **THEN** no advice is attached

#### Scenario: Tier unanswered does not block delegate
<!-- Intentional change: the gate reads `effort` instead of `tier`. -->
- **WHEN** `strategy` is `delegate` with probability 0.7 and `effort` is unanswered
- **THEN** advice for `delegate` is attached

#### Scenario: Strategy unanswered
- **WHEN** `strategy` has an unknown choice
- **THEN** no advice is attached

#### Scenario: Confidence ignored
- **WHEN** `strategy` is `delegate` with probability 0.7, `effort` is `high` and confidence 0.1
- **THEN** advice for `delegate` is attached

### Requirement: Advice independent of effort
Whether advice is attached SHALL depend only on the `strategy` answer and Jev's raw `effort` answer. It MUST NOT depend on the effort result applied to the session, so advice is still attached when the effort result is discarded on a manual level change, when a `max` level is kept, when the prompt is held, or when the `effort` feature is off.

#### Scenario: Kept on a manual change
- **WHEN** the operator changes the level while Jev answers, and Jev answers `effort` `xhigh` and `strategy` `delegate` with probability 0.9
- **THEN** the level is not changed by the package, and the `delegate` block is attached

#### Scenario: Effort off
- **WHEN** `effort` is off, `strategy` is on, and Jev answers `effort` `high` and `strategy` `delegate` with probability 0.9
- **THEN** the `delegate` block is attached and the level is unchanged

#### Scenario: Effort unanswered
- **WHEN** Jev answers `effort` with an unknown choice and `strategy` `delegate` with probability 0.9
- **THEN** the level is unchanged and the `delegate` block is attached

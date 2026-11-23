## ADDED Requirements

### Requirement: Turn signals per band
A pure function SHALL compute, per band, over its latest 200 counted runs (ignoring cooldown, pending and block): `runs`; nearest-rank `p90` and `p95` of `turnsUsed`; `exhausted` and `warned` counts by `turnPhase`; `usedOverFloor`, the mean `turnsUsed / turnFloor` over runs with `turnFloor`; and, only at 200 runs, `suggested` from the new-value rule with no block. A band with no run SHALL have `runs` 0 only. It MUST do no I/O and MUST NOT call Jev.

#### Scenario: Signal with a full window
- **WHEN** the lines hold 250 counted `long` runs, the latest 200 with p95 60 and 4 `exhausted`, and the floors are 40, 100 and 200
- **THEN** the `long` signal has `runs` 200, `p95` 60, `exhausted` 4 and `suggested` 80

#### Scenario: Too few runs suggest nothing
- **WHEN** the lines hold 120 counted `long` runs
- **THEN** the `long` signal has `runs` 120, its percentiles and counts, and no `suggested`

#### Scenario: No runs
- **WHEN** the lines hold no counted `very_long` run
- **THEN** the `very_long` signal has `runs` 0 and no other value

#### Scenario: Used over floor
- **WHEN** a band's window has two runs with `turnFloor` 100 and `turnsUsed` 50 and 100, and one run without `turnFloor`
- **THEN** its `usedOverFloor` is 0.75

#### Scenario: Turn signal input unchanged
- **WHEN** the function runs
- **THEN** the lines passed in are deep-equal to a copy taken before the call

### Requirement: Turn signal order
Bands SHALL come in the order `medium`, `long`, `very_long`, and runs SHALL be ordered as in `turn-floor-rules`, so the result MUST NOT depend on input order.

#### Scenario: Turn signal order irrelevant
- **WHEN** the same lines are passed in two different orders
- **THEN** both results are equal, with bands in the order `medium`, `long`, `very_long`

## MODIFIED Requirements

### Requirement: Signals are pure and observed only
The signal functions MUST do no I/O, MUST NOT call Jev and MUST NOT change their input. Nothing in the package SHALL change a setting because of a per-mode signal. Turn floors are changed only by the floor rules of the tuning step, never by the turn signal function.

#### Scenario: Input unchanged
- **WHEN** the function runs
- **THEN** the lines passed in are deep-equal to a copy taken before the call

#### Scenario: Signals never tune
- **WHEN** the ledger holds 60 answered `standard` main lines with no timeout, every one has a correction line and a `toolCalls` of 30 at `effective` `low`, and a main run settles
- **THEN** no `tuning.json` is created

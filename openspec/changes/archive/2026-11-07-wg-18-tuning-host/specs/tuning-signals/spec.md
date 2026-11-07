## ADDED Requirements

### Requirement: Signals per mode
The package SHALL compute, from ledger lines, the four signals of each mode with at least one decision. A decision is a `main` or `worker` line. A mode's window MUST be its latest 200 decisions, ordered by `at`, then by each line's JSON text with its keys sorted, so the result never depends on input order.

#### Scenario: Window per mode
- **WHEN** the lines hold 250 `standard` main decisions and 10 `budget` main decisions
- **THEN** the `standard` signals count over the latest 200 `standard` decisions, and the `budget` signals over its 10

#### Scenario: Modes never mixed
- **WHEN** a `budget` worker line with `tier` `fast` has `status` `error`, and `standard` has one main decision and no worker line
- **THEN** `budget` reports 1 low worker error and `standard` reports 0

#### Scenario: Empty mode left out
- **WHEN** the lines hold only `standard` decisions
- **THEN** the result has signals for `standard` only

#### Scenario: Input order irrelevant
- **WHEN** the same lines are passed in two different orders
- **THEN** both results are equal

### Requirement: Signals are pure and observed only
The signal function MUST do no I/O, MUST NOT call Jev and MUST NOT change its input. Nothing in the package SHALL change a setting because of a signal.

#### Scenario: Input unchanged
- **WHEN** the function runs
- **THEN** the lines passed in are deep-equal to a copy taken before the call

#### Scenario: Signals never tune
- **WHEN** the ledger holds 60 answered `standard` main lines with no timeout, every one has a correction line and a `toolCalls` of 30 at `effective` `low`, and a main run settles
- **THEN** no `tuning.json` is created

### Requirement: Low worker errors
`lowWorkerErrors` SHALL count, among the window's worker lines routed low (`tier` `fast`, or `effort` `off`, `minimal` or `low`), those with `status` `error`, out of all worker lines routed low. `aborted` and `stopped` MUST NOT count as errors.

#### Scenario: Counted and denominator
- **WHEN** a window has three low worker lines with `status` `error`, `completed` and `aborted`, and one `deep` worker with `status` `error`
- **THEN** `lowWorkerErrors` is 1 of 3

### Requirement: Corrected turns
`corrected` SHALL count the window's main lines whose `turnId` appears on any `correction` line in the input, out of all main lines in the window. The mode MUST come from the main line.

#### Scenario: Correction points at a main line
- **WHEN** a window has four main lines and one `correction` line carries the `turnId` of one of them
- **THEN** `corrected` is 1 of 4

#### Scenario: Correction for a turn outside the window
- **WHEN** a `correction` line carries a `turnId` that matches no main line in the window
- **THEN** it adds nothing to `corrected`

### Requirement: Large turns at low effort
`largeAtLow` SHALL count, among the window's main lines with `effective` `off`, `minimal` or `low` and a `toolCalls` value, those with `toolCalls` of at least 15.

#### Scenario: Threshold
- **WHEN** a window has low-effort main lines with `toolCalls` 14, 15 and 30, and one with no `toolCalls`
- **THEN** `largeAtLow` is 2 of 3

### Requirement: High starts finishing small
`highSmall` SHALL count, among the window's main lines with `effective` `high` and a `toolCalls` value, those with `toolCalls` of at most 2, `failures` equal to 0 and `outcome` `ok`. A line without `failures` stays in the denominator but MUST NOT be counted. Worker lines MUST NOT count.

#### Scenario: Small high turns
- **WHEN** a window has `high` main lines with (`toolCalls` 2, `failures` 0, `ok`), (1, 1, `ok`), (0, 0, `error`) and (5, 0, `ok`), and a `high` worker line
- **THEN** `highSmall` is 1 of 4

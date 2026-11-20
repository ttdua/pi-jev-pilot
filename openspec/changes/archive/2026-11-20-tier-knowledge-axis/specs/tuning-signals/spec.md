## MODIFIED Requirements

### Requirement: Signals per mode
The package SHALL compute, from ledger lines, the four signals of each mode with at least one decision. A decision is a `main` or `worker` line. A mode's window MUST be its latest 200 decisions, ordered by `at`, then by each line's JSON text with its keys sorted, so the result never depends on input order.

#### Scenario: Window per mode
- **WHEN** the lines hold 250 `standard` main decisions and 10 `budget` main decisions
- **THEN** the `standard` signals count over the latest 200 `standard` decisions, and the `budget` signals over its 10

#### Scenario: Modes never mixed
- **WHEN** a `budget` worker line with `tier` `basic` has `status` `error`, and `standard` has one main decision and no worker line
- **THEN** `budget` reports 1 low worker error and `standard` reports 0

#### Scenario: Empty mode left out
- **WHEN** the lines hold only `standard` decisions
- **THEN** the result has signals for `standard` only

#### Scenario: Input order irrelevant
- **WHEN** the same lines are passed in two different orders
- **THEN** both results are equal

### Requirement: Low worker errors
`lowWorkerErrors` SHALL count, among the window's worker lines routed low (`tier` `basic` or the legacy `fast`, or `effort` `off`, `minimal` or `low`), those with `status` `error`, out of all worker lines routed low. `aborted` and `stopped` MUST NOT count as errors.

#### Scenario: Legacy fast counts as low
- **WHEN** a window has one worker line with `tier` `fast` and `status` `error` and one with `tier` `basic` and `status` `completed`
- **THEN** `lowWorkerErrors` is 1 of 2

#### Scenario: Counted and denominator
- **WHEN** a window has three low worker lines with `status` `error`, `completed` and `aborted`, and one `deep` worker with `status` `error`
- **THEN** `lowWorkerErrors` is 1 of 3

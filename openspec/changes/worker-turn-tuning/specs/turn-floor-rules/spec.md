## ADDED Requirements

### Requirement: Built-in floors and ranges
The built-in band floors SHALL be `medium` 40, `long` 100 and `very_long` 200. Each band SHALL have a hard range: `medium` 20–80, `long` 50–200, `very_long` 100–400. `short` MUST have no floor and MUST NOT be tuned. Settings validation, resolution, routing and the tuning rules MUST all use these same values.

#### Scenario: Built-in values
- **WHEN** nothing is tuned
- **THEN** the effective floors are `medium` 40, `long` 100 and `very_long` 200

### Requirement: Band of a run
The band of a worker line SHALL come from its `turnsP` by the band rule of the turn floor (worker-decision). The band used for tuning MUST be the band routing picks for the same `turnsP`. A counted run of a band is a `worker` line with `turnsP`, that band, an integer `turnsUsed`, and a `status` other than `aborted`, whether or not `turnFloor` was written. Lines without `turnsP` (turns not asked, a Jev miss) or without `turnsUsed`, `aborted` lines and `short` lines MUST NOT count.

#### Scenario: Band by cumulative probability
- **WHEN** a worker line has `turnsP` `short` .1, `medium` .2, `long` .6, `very_long` .1 and `turnsUsed` 37
- **THEN** it is a counted run of `long`

#### Scenario: Short runs not counted
- **WHEN** a worker line has `turnsP` `short` .7, `medium` .3 and `turnsUsed` 5
- **THEN** it is a counted run of no band

#### Scenario: Jev miss not counted
- **WHEN** a worker line has `requestedTurns` 20, `answered` false, `miss` `timeout`, no `turnsP` and `turnsUsed` 20
- **THEN** it is a counted run of no band

#### Scenario: Aborted run not counted
- **WHEN** a worker line has `turnsP` rating it `long`, `turnsUsed` 3 and `status` `aborted`
- **THEN** it is a counted run of no band

#### Scenario: No turn use
- **WHEN** a worker line has `turnsP` rating it `long` and no `turnsUsed`
- **THEN** it is a counted run of no band

#### Scenario: Not raised still counts
- **WHEN** a worker line has `turnsP` rating it `long`, `requestedTurns` 120, no `turnFloor` and `turnsUsed` 90
- **THEN** it is a counted run of `long`

### Requirement: Floor window and cooldown
For each band, the step SHALL use the counted runs of that band strictly after the later of the band's `changedAt` and its latest `turnFloor.<band>` history entry (all when neither exists), ordered by `at`, then by key-sorted JSON text. With fewer than 200 the band MUST NOT change; otherwise the window is the latest 200. Other bands' runs, main lines and `correction` lines MUST NOT count.

#### Scenario: Too few runs
- **WHEN** 199 counted `long` runs follow the latest `turnFloor.long` entry, all with `turnsUsed` 190
- **THEN** the `long` floor does not change

#### Scenario: Other bands do not count
- **WHEN** 150 counted `long` runs and 300 counted `medium` runs follow the latest `turnFloor.long` entry
- **THEN** the `long` floor does not change

#### Scenario: Input order irrelevant
- **WHEN** the same lines, several sharing one `at`, are passed in two different orders
- **THEN** both steps return equal records and events

#### Scenario: Cooldown survives a trimmed history
- **WHEN** the `very_long` floor has `changedAt` 1000, its history entry was dropped from the 50-entry history, and 150 counted `very_long` runs follow time 1000 with 100 more before it
- **THEN** the `very_long` floor does not change

### Requirement: New floor value
With a full window, the step SHALL take `wanted` = nearest-rank p95 of `turnsUsed` × 1.25, rounded up to 10, raised to `up` when `exhausted × 20 > runs`. It SHALL clamp `wanted` to `down`–`up`, then to the band range, then to the band order, then apply an active block. `up` = `max(current + 10, floor10(current × 1.25))`, `down` = `min(current − 10, ceil10(current × 0.75))`, so a move is at least 10. A value equal to `current` MUST make no change.

#### Scenario: Floor lowered within the step bound
- **WHEN** `long` is 100 and its window's p95 is 60
- **THEN** the new `long` floor is 80, since 60 × 1.25 = 75 rounds up to 80 and `down` is 80

#### Scenario: Decrease bounded
- **WHEN** `long` is 100 and its window's p95 is 30
- **THEN** the new `long` floor is 80

#### Scenario: Increase bounded
- **WHEN** `long` is 100 and its window's p95 is 150
- **THEN** the new `long` floor is 120

#### Scenario: Exhausted runs force a raise
- **WHEN** `long` is 100, its window's p95 is 70, and 11 of the 200 runs ended `exhausted`
- **THEN** the new `long` floor is 120

#### Scenario: Exactly 5% exhausted
- **WHEN** `long` is 100, its window's p95 is 70, and 10 of the 200 runs ended `exhausted`
- **THEN** the new `long` floor is 90

#### Scenario: Hard minimum
- **WHEN** `medium` is 20 and its window's p95 is 5
- **THEN** the `medium` floor does not change

#### Scenario: Hard maximum
- **WHEN** `very_long` is 400 and its window's p95 is 390
- **THEN** the `very_long` floor does not change

#### Scenario: Bands stay ordered
- **WHEN** `medium` is 80, `long` is 100, and the `long` window's p95 is 40
- **THEN** the new `long` floor is 90

#### Scenario: Minimum move of 10
- **WHEN** `medium` is 30 and its window's p95 is 10
- **THEN** the new `medium` floor is 20, a move of 10

#### Scenario: Unchanged value
- **WHEN** `long` is 100 and its window's p95 is 80
- **THEN** the `long` floor does not change, since 80 × 1.25 = 100

### Requirement: Band order
A new floor value SHALL stay at least 10 above the lower band and at least 10 below the upper band. A lower neighbour with a pending change MUST count as the higher of its `from` and `to`, and an upper neighbour as the lower of the two, so a later revert of either band keeps the order.

#### Scenario: Pending neighbour kept in order
- **WHEN** `long` has a pending change from 100 to 80, `very_long` is 200, and the `very_long` window's p95 is 70
- **THEN** the new `very_long` floor is 150, since `down` is 150 and the order needs only more than 100 + 10

#### Scenario: Pending neighbour bounds a decrease
- **WHEN** `long` has a pending change from 100 to 80, `very_long` is 130, and the `very_long` window's p95 is 70
- **THEN** the new `very_long` floor is 110, since `down` is 100 and the order needs at least the pending `from` 100 plus 10

### Requirement: Applying a floor change
When a band's new value differs from `current`, the step SHALL set the band's tuned floor to that value with `base` equal to the built-in floor, set the band's `changedAt` to the current time, set the band's pending change to `from` (`current`), `to`, `at` (the current time) and `before` (the window's `runs` 200 and its `exhausted` count), add a history entry with `parameter` `turnFloor.<band>` and cause `rule`, and return an `applied` event with that parameter.

#### Scenario: First floor change recorded
- **WHEN** nothing is tuned, `long` is 100, and at time 1000 its window gives 80 with 3 `exhausted` runs
- **THEN** the record's `long` floor is value 80 with base 100, its `changedAt` is 1000, its pending change is `from` 100, `to` 80, `at` 1000, `before` 200 runs and 3 exhausted, history ends with `rule` `turnFloor.long` from 100 to 80, and the event is `applied` `turnFloor.long` from 100 to 80

### Requirement: Judging a floor change
When at least 200 counted runs of the band follow its pending change's `at`, the step SHALL judge the first 200. When their `exhausted` share is strictly greater than the share in `before` (compared by cross-multiplying counts), it SHALL revert. Otherwise it SHALL keep the change: clear the band's pending change, add no history entry, and return a `kept` event. With fewer than 200 runs after it, the step MUST NOT judge it and MUST NOT change that band.

#### Scenario: More exhausted, reverted
- **WHEN** a `long` pending change from 100 to 80 has `before` 200 runs and 2 exhausted, and the first 200 `long` runs after it have 6 exhausted
- **THEN** the step returns a `reverted` event for `turnFloor.long`

#### Scenario: Equal, kept
- **WHEN** a `long` pending change has `before` 200 runs and 4 exhausted, and the first 200 `long` runs after it have 4 exhausted
- **THEN** the band's pending change is cleared, its tuned floor stays, and the events include `kept` for `turnFloor.long`

#### Scenario: Not yet judged
- **WHEN** a `long` pending change has 199 counted `long` runs after it
- **THEN** the step returns no event for `turnFloor.long` and the pending change stays

### Requirement: Reverting a floor change
A floor revert SHALL set the band's tuned floor back to the pending `from`, or remove it when `from` equals the base. It SHALL set the band's `changedAt` to the current time, clear the band's pending change, add a history entry with cause `revert` from `to` to `from`, set the band's block at `to` with the current time, and return a `reverted` event from `to` to `from`.

#### Scenario: Revert a decrease
- **WHEN** a `long` pending change from 100 to 80 with base 100 is judged worse at time 9000
- **THEN** the `long` tuned floor is removed, its block is at 80 at time 9000, and history ends with `revert` `turnFloor.long` from 80 to 100

### Requirement: Floor block
A band's block SHALL hold a value and the time it was set, and SHALL apply while fewer than 400 counted runs of the band follow that time, so it outlasts the 200-run cooldown that starts with it. While it applies, when the block value is above `current`, a new value at or above it MUST be lowered to the block value minus 10. When the block value is below `current`, a new value at or below it MUST be raised to the block value plus 10. A value that ends equal to `current` makes no change.

#### Scenario: Blocked decrease
- **WHEN** the `long` block is at 80 with 50 runs after it, `long` is 100, and the window gives 80
- **THEN** the new `long` floor is 90

#### Scenario: Blocked raise dropped
- **WHEN** the `long` block is at 120 with 50 runs after it, `long` is 110, and the window gives 130
- **THEN** the `long` floor does not change

#### Scenario: Block expired
- **WHEN** the `long` block is at 80 with 400 runs after it, `long` is 100, and the window gives 80
- **THEN** the new `long` floor is 80

#### Scenario: Block after a real revert
- **WHEN** a `long` change from 100 to 80 is reverted at time 9000, and 250 counted `long` runs follow, the latest 200 giving 80
- **THEN** the new `long` floor is 90

### Requirement: Floors follow the step order and off
Floor rules SHALL follow the step order and the `off` flag of `tuning-rules`. While `off` is set, no floor MUST change. A revert of `timeoutMs` in a step MUST prevent any floor change in that step.

#### Scenario: Off holds floors
- **WHEN** `off` is set and the `long` window would lower its floor
- **THEN** the step returns no events and the record is unchanged

#### Scenario: Timeout revert blocks a floor change
- **WHEN** a `timeoutMs` change is reverted and the `long` window would lower its floor
- **THEN** the step returns the `reverted` event and no `applied` event

### Requirement: Built-in floor change supersedes tuning
When a band's tuned floor has a `base` that differs from the band's built-in floor, the step SHALL first remove the band's tuned floor, pending change and block, set its `changedAt` to the current time, add a history entry with cause `superseded` from the tuned value to the built-in floor, and return a `superseded` event. The removal counts as a change for the band's cooldown.

#### Scenario: New built-in floor
- **WHEN** the `long` tuned floor is 120 with base 90 and the built-in `long` floor is 100
- **THEN** the `long` state holds only `changedAt` equal to the current time, history ends with `superseded` `turnFloor.long` from 120 to 100, and the events include `superseded` for `turnFloor.long`

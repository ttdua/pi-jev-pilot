## ADDED Requirements

### Requirement: Burst rule
The step SHALL use as the burst window the latest 5 asked decisions after the latest history entry whose `parameter` is `timeoutMs`; the window MAY hold fewer than 5. The burst rule SHALL fire when at least 3 decisions in the burst window have `miss` `timeout`. Its new value SHALL be `ceil100(current × 1.25)`, clamped to 300–5000, where `current` is the effective `timeoutMs` before the step. A value not above `current` MUST make no change and no event. The burst rule MUST NOT wait for the cooldown and MUST NOT be lowered by a block. It MAY fire while a `timeoutMs` change is pending, but not in a step that reverted a change.

#### Scenario: Three timeouts in a row
- **WHEN** `current` is 1700, the latest `timeoutMs` entry is at time 1000, and the 3 decisions after it are asked and timed out
- **THEN** the step returns an `applied` event for `timeoutMs` from 1700 to 2200

#### Scenario: Three of the latest five
- **WHEN** after the latest `timeoutMs` entry the asked decisions are, oldest first, timeout, answered, timeout, answered, timeout
- **THEN** the burst rule fires

#### Scenario: Two of five do not fire
- **WHEN** after the latest `timeoutMs` entry the latest 5 asked decisions hold 2 timeouts and fewer than 40 decisions follow the entry
- **THEN** the step returns no `applied` event for `timeoutMs`

#### Scenario: Older timeouts do not count
- **WHEN** 3 timeouts precede the latest `timeoutMs` entry and 2 timeouts follow it
- **THEN** the burst rule does not fire

#### Scenario: Unasked decisions skipped
- **WHEN** after the latest `timeoutMs` entry the decisions are timeout, unasked, timeout, unasked, timeout
- **THEN** the burst rule fires

#### Scenario: Block ignored
- **WHEN** a block at 1900 has 22 decisions after it, `current` is 1700, and 3 asked decisions after the latest `timeoutMs` entry timed out
- **THEN** the new value is 2200

#### Scenario: Steps under sustained timeouts
- **WHEN** `current` is 1700 and every decision times out, over several steps
- **THEN** the applied values are 2200, 2800, 3500, 4400 and 5000, each after 3 more timeouts

#### Scenario: Burst at the ceiling
- **WHEN** `current` is 5000 and the burst rule fires
- **THEN** the step returns no `applied` event and the record is unchanged

#### Scenario: Burst over a pending change
- **WHEN** a pending change from 1500 to 1700 has 10 asked decisions after it, the last 3 of them timed out
- **THEN** the step returns one `applied` event from 1700 to 2200, with no `kept` or `reverted` event, and the pending change is from 1700 to 2200

### Requirement: Lowering
The step SHALL lower a tuned `timeoutMs` when all hold: its `base` equals the untuned value, no `timeoutMs` change is pending, at least 200 decisions follow the latest history entry whose `parameter` is `timeoutMs`, the latest 200 decisions hold at least 100 asked decisions and none with `miss` `timeout`, and their p90 (see "The new value") is defined. The new value SHALL be `max(base, ceil100(p90 × 1.5), ceil100(current × 0.8))`, then adjusted by an active block that holds back lowerings. A value not below `current` MUST make no change and no event. A lowering SHALL be recorded as a change with cause `rule` and an `applied` event.

#### Scenario: Lowered after a clean stretch
- **WHEN** the tuned value is 3000 with base 1500, no change is pending, 200 asked decisions follow the latest `timeoutMs` entry with no timeout, and their p90 is 1270
- **THEN** the step returns an `applied` event from 3000 to 2400

#### Scenario: p90 limits the step
- **WHEN** the tuned value is 3000 with base 1500, the clean stretch holds, and the p90 is 1900
- **THEN** the new value is 2900, since 1900 × 1.5 = 2850 rounds up to 2900

#### Scenario: Not below the base
- **WHEN** the tuned value is 1700 with base 1500, the clean stretch holds, and the p90 is 500
- **THEN** the new value is 1500

#### Scenario: A timeout stops lowering
- **WHEN** the tuned value is 3000 with base 1500, 200 decisions follow the latest `timeoutMs` entry, and the latest 200 hold one timeout, not among the latest 5 asked
- **THEN** the step returns no `applied` event

#### Scenario: Too soon
- **WHEN** the tuned value is 3000 with base 1500 and 199 answered decisions, none timed out, follow the latest `timeoutMs` entry
- **THEN** the step returns no `applied` event

#### Scenario: Too few asked
- **WHEN** the tuned value is 3000 with base 1500 and the latest 200 decisions hold 99 asked decisions and no timeout
- **THEN** the step returns no `applied` event

#### Scenario: Untuned value never lowered
- **WHEN** no value is tuned and 200 clean decisions follow
- **THEN** the step returns no `applied` event

#### Scenario: Lowering at base clears the tuned value once kept
- **WHEN** a lowering from 1700 to 1500 with base 1500 is pending and is kept
- **THEN** the record has no tuned `timeoutMs` and the effective value is 1500

## MODIFIED Requirements

### Requirement: Pure tuning step
<!-- Intentional change: "Nothing to do" now states answered decisions, since 3 timeouts among 10 decisions fire the burst rule. -->
The package SHALL provide one pure step function. Its inputs are the tuning record, the untuned `timeoutMs` (from config, or the default), the ledger lines, and the current time. It returns the next tuning record and a list of events, each `superseded`, `kept`, `reverted` or `applied`, with the `parameter` (`timeoutMs` or `turnFloor.<band>`) and its `from` and `to` values. The function MUST do no I/O, MUST NOT call Jev, and MUST NOT change its inputs. The only parameters it may change are `timeoutMs` and the band floors `turnFloor.medium`, `turnFloor.long` and `turnFloor.very_long`.

#### Scenario: Nothing to do
- **WHEN** the record is empty and the ledger has 10 answered decisions
- **THEN** the step returns the record unchanged and no events

#### Scenario: Inputs unchanged
- **WHEN** the step applies a change
- **THEN** the record and the lines passed in are deep-equal to copies taken before the call

#### Scenario: Event names its parameter
- **WHEN** the timeout rule fires from 1500 to 1700
- **THEN** the event is `applied` with `parameter` `timeoutMs`, `from` 1500 and `to` 1700

### Requirement: Decisions counted by time
<!-- Intentional change: "Correction lines ignored" now states answered decisions and timed-out correction lines, so it also shows corrections never count for the burst rule. -->
A decision SHALL be a `main` or `worker` line; `correction` lines MUST be ignored. A decision is after an event when its `at` is strictly greater than the event's `at`. Decisions SHALL be ordered by `at`, with ties broken by `kind`, `session`, `answered`, `miss` and `ms`, in that order. Lines equal on all of these are interchangeable. The step MUST NOT depend on the order of the lines in its input.

#### Scenario: Correction lines ignored
- **WHEN** the ledger has 40 `correction` lines with `miss` `timeout` after the latest change and 39 answered decisions
- **THEN** the cooldown has not passed, the burst rule does not fire, and the step returns no events

#### Scenario: Line order does not matter
- **WHEN** the same lines, several of them sharing one `at`, are passed in two different orders
- **THEN** both steps return equal records and events

### Requirement: Config edit supersedes tuning
<!-- Intentional change: "No change right after superseding" now covers the burst rule, which needs 3 timeouts after the `superseded` entry instead of 40 decisions. -->
When the record has a tuned `timeoutMs` whose `base` differs from the untuned value, the step SHALL first remove the tuned `timeoutMs`, its pending change and its block, and MUST leave every band floor's state unchanged. It SHALL add a history entry with cause `superseded`, from the tuned value to the untuned value, and return a `superseded` event. The removal counts as a change for the `timeoutMs` cooldown and starts a new burst window.

#### Scenario: Operator edits config
- **WHEN** the tuned value is 1700 with base 1500 and the untuned value is now 2000
- **THEN** the record has no tuned value, no pending change and no block, history ends with `superseded` from 1700 to 2000, and the events are one `superseded` from 1700 to 2000

#### Scenario: No change right after superseding
- **WHEN** a tuned value is superseded, and the latest 40 decisions would make the window rule or the burst rule fire
- **THEN** the step returns no `applied` event; the next window rule change comes only after 40 decisions follow the `superseded` entry, and the next burst only after 3 asked decisions after it time out

#### Scenario: Matching base untouched
- **WHEN** the tuned value is 1700 with base 1500 and the untuned value is 1500
- **THEN** no `superseded` event is returned

#### Scenario: Floors kept on a config edit
- **WHEN** the tuned `timeoutMs` is 1700 with base 1500, the untuned value is now 2000, and the `long` floor is tuned to 120 with base 100
- **THEN** the `long` floor stays 120 with base 100

### Requirement: Undo
<!-- Intentional change: undo skips `rule` entries already undone, so repeated undos walk back through a lowering instead of alternating between two values. -->
A pure undo transition SHALL pick, among the parameters with a tuned value that applies (for `timeoutMs`, `base` equal to the untuned value; for a band floor, `base` equal to its built-in floor), the one changed most recently (for a band floor, the later of its `changedAt` and its latest history entry), ties going to the order `timeoutMs`, `turnFloor.medium`, `turnFloor.long`, `turnFloor.very_long`. For that parameter it SHALL move the tuned value to the `from` of the latest `rule` entry of that parameter whose `to` equals it and that is not undone, or remove it when there is no such entry or the target equals the base. A band floor target MUST first be kept in the band order by the Band order rule of `turn-floor-rules`, counting a neighbour's pending change at its worst value; when that leaves the target equal to the current value, undo MUST skip that parameter and pick the next most recent one. An undone band floor's `changedAt` SHALL be set to the current time. Undo clears that parameter's pending change, sets its block at the undone value with the current time, and adds an `undo` history entry for that parameter. `undo` and `revert` entries SHALL be matched to `rule` entries newest first and one to one: each `undo` or `revert` entry of the parameter reverses the latest earlier, not yet matched `rule` entry with `to` equal to its `from` and `from` equal to its `to`, and a matched `rule` entry is undone. Other parameters MUST NOT change. With no parameter left, undo MUST report nothing to undo and return the record unchanged.

#### Scenario: Undo a change
- **WHEN** the tuned value is 1700 with base 1500, the latest `rule` entry is from 1500 to 1700, and undo runs at time 5000
- **THEN** the record has no tuned value, no pending change, a block at 1700 at time 5000, and history ends with `undo` from 1700 to 1500

#### Scenario: Undo after a revert
- **WHEN** history holds `rule` 1500→1700, `rule` 1700→1900 and `revert` 1900→1700, the tuned value is 1700 with base 1500, and undo runs
- **THEN** the tuned value is removed, the block is at 1700, and history ends with `undo` from 1700 to 1500

#### Scenario: Second undo
- **WHEN** history holds `rule` 1500→1700 and `rule` 1700→1900, the tuned value is 1900, and undo runs twice
- **THEN** the first undo leaves 1700 with a block at 1900, the second removes the tuned value with a block at 1700, and history ends with two `undo` entries

#### Scenario: Nothing to undo
- **WHEN** no value is tuned and undo runs
- **THEN** undo reports nothing to undo and the record is unchanged

#### Scenario: Floor undo kept in order
- **WHEN** `very_long` is tuned to 100 with `changedAt` 1000, the `long` floor is tuned to 80 by a `rule` entry from 100 at time 2000, and undo runs at time 3000
- **THEN** the `long` floor becomes 90 and history ends with `undo` `turnFloor.long` from 80 to 90

#### Scenario: Floor undo against a pending neighbour
- **WHEN** `very_long` has a pending change from 100 to 120 with `changedAt` 1000, the `long` floor is tuned to 80 by a `rule` entry from 100 at time 2000, and undo runs
- **THEN** the `long` floor becomes 90, since `very_long` counts as 100 until its change is judged

#### Scenario: Floor undo blocked by the order
- **WHEN** `medium` is tuned to 50 with `changedAt` 1000, `timeoutMs` is tuned to 1700 by a `rule` entry from 1500 at time 1500, the `long` floor is tuned to 60 by a `rule` entry from 50 at time 2000, and undo runs
- **THEN** `long` is skipped, since its target 50 clamps to 60, and `timeoutMs` is undone from 1700 to 1500

#### Scenario: Latest change undone first
- **WHEN** `timeoutMs` is tuned to 1700 by a `rule` entry at time 1000 and the `long` floor to 80 by a `rule` entry at time 2000, and undo runs at time 3000
- **THEN** the `long` tuned floor is removed, its block is at 80 at time 3000, `timeoutMs` stays 1700, and history ends with `undo` `turnFloor.long` from 80 to 100

#### Scenario: Repeated undo walks back through a lowering
- **WHEN** history holds `rule` 1500→1900, `rule` 1900→2400, `rule` 2400→3000 and `rule` 3000→2400, the tuned value is 2400 with base 1500, and undo runs three times
- **THEN** the values after each undo are 3000, 2400 and 1900, and history ends with `undo` 2400→3000, `undo` 3000→2400 and `undo` 2400→1900

#### Scenario: Reverted rule skipped by repeated undo
- **WHEN** history holds `rule` 1500→1900, 1900→2400, 2400→3000, 3000→2400 and `revert` 2400→3000, the tuned value is 3000 with base 1500, and undo runs three times
- **THEN** the values after each undo are 2400, 1900 and 1500

#### Scenario: Repeated identical transitions undone one at a time
- **WHEN** history holds `rule` 1500→1900, 1900→2400, 2400→3000, 3000→2400 and 2400→3000, the tuned value is 3000 with base 1500, and undo runs three times
- **THEN** the values after each undo are 2400, 3000 and 2400

### Requirement: The timeout rule
The step SHALL use as the window the latest 40 decisions, all after the latest history entry whose `parameter` is `timeoutMs`. A decision was asked when it is answered or has a `miss`. This window rule SHALL fire when the window holds 40 decisions, at least 20 of them asked, and the asked ones with `miss` `timeout` are more than 10%: `timeouts × 10 > asked`, compared in integers. `error` and `schema` misses MUST NOT count as timeouts, but they do count as asked. The burst rule and lowering are separate rules with their own conditions.

#### Scenario: Fires on timeouts
- **WHEN** the window has 40 asked decisions, 5 of them with `miss` `timeout`
- **THEN** the rule fires

#### Scenario: Exactly 10% does not fire
- **WHEN** the window has 40 asked decisions, 4 of them with `miss` `timeout`
- **THEN** the rule does not fire

#### Scenario: Other misses do not count
- **WHEN** the window has 40 asked decisions, 10 with `miss` `error` and 3 with `miss` `schema`, and none timed out
- **THEN** the rule does not fire

#### Scenario: Too few asked
- **WHEN** the window has 40 decisions, 19 of them asked, and 10 of those with `miss` `timeout`
- **THEN** the rule does not fire

#### Scenario: Unasked decisions are not counted
- **WHEN** the window has 40 decisions, 20 asked with 3 timeouts among them, and 20 neither answered nor missed
- **THEN** the rule fires, since 3 × 10 > 20

### Requirement: The new value
<!-- Intentional change: "Answered lines without ms" now has the 10 timeouts without `ms`, since timed-out decisions with `ms` count in p90. -->
When the window rule fires, the step SHALL compute `max(current + 200, ceil100(p90 × 1.25))`, clamp it to 300–5000, apply any active `timeoutMs` block that holds back raises, then compare it with `current`, the effective `timeoutMs` before the step. `p90` is the nearest-rank 90th percentile of `ms` over the decisions in the window that are answered or have `miss` `timeout` and carry a finite `ms`; with none, only `current + 200` applies. A final value not above `current` MUST make no change and no event.

#### Scenario: Step of 200
- **WHEN** `current` is 1500, the rule fires and the window's p90 is 1000
- **THEN** the new value is 1700

#### Scenario: p90 wins
- **WHEN** `current` is 1500, the rule fires and the window's p90 is 1450
- **THEN** the new value is 1900, since 1450 × 1.25 = 1812.5 rounds up to 1900

#### Scenario: Nearest-rank p90
- **WHEN** the answered `ms` values in the window are 100, 200, …, 2000 (20 values)
- **THEN** p90 is 1800

#### Scenario: Answered lines without ms
- **WHEN** the window has 30 answered decisions, 10 of them without `ms`, and 10 timeouts without `ms`
- **THEN** p90 is taken over the 20 values present, and all 40 count as asked

#### Scenario: Timeouts count in p90
- **WHEN** `current` is 1700, the window has 34 answered decisions with `ms` up to 1300 and 6 timeouts with `ms` 1702
- **THEN** p90 is 1702 and the new value is 2200, since 1702 × 1.25 = 2127.5 rounds up to 2200

#### Scenario: Other misses not in p90
- **WHEN** the window has 36 answered decisions with `ms` 500 and 4 `error` misses with `ms` 3000
- **THEN** p90 is 500

#### Scenario: Clamped to the ceiling
- **WHEN** `current` is 4900 and the rule fires
- **THEN** the new value is 5000

#### Scenario: Already at the ceiling
- **WHEN** `current` is 5000 and the rule fires
- **THEN** the step returns no `applied` event and the record is unchanged

### Requirement: Applying a change
When the burst rule, the window rule or lowering applies a new value, the step SHALL set the tuned `timeoutMs` to that value, with `base` equal to the untuned value. It SHALL set the `timeoutMs` pending change to `from` (`current`), `to` (the new value), `at` (the current time) and `before`: for the window rule, the window's asked and timeout counts; for the burst rule and lowering, the asked and timeout counts of the latest 40 decisions in the ledger. A pending change already present is replaced without an event. The burst rule SHALL also remove the `timeoutMs` block. It SHALL add a history entry with `parameter` `timeoutMs` and cause `rule`, and return an `applied` event for `timeoutMs`.

#### Scenario: First change recorded
- **WHEN** the untuned value is 1500, no value is tuned, and the rule fires at time 1000 with 40 asked, 8 timeouts and a new value of 1700
- **THEN** the record's `timeoutMs` is value 1700 with base 1500, pending is `from` 1500, `to` 1700, `at` 1000, `before` 40 asked and 8 timeouts, the last history entry is `rule` from 1500 to 1700, and the events are one `applied` from 1500 to 1700

#### Scenario: Second step
- **WHEN** the tuned value is 1700 with base 1500, there is no pending change, and the rule fires with a new value of 1900
- **THEN** the tuned value is 1900 with base 1500, and pending `from` is 1700

#### Scenario: Burst clears the block
- **WHEN** a block at 1900 is active, `current` is 1700, and the burst rule fires at time 5000
- **THEN** the record has no block, the tuned value is 2200, and the last history entry is `rule` from 1700 to 2200 at time 5000

#### Scenario: Burst before counts
- **WHEN** the burst rule fires and the latest 40 decisions in the ledger hold 38 asked and 12 timeouts
- **THEN** pending `before` is 38 asked and 12 timeouts

### Requirement: Cooldown
<!-- Intentional change: "Inside the cooldown" no longer uses 39 timeouts, which now fire the burst rule (see "Burst inside the cooldown"); "Decisions before the change do not count" now states answered decisions after it. -->
The step SHALL NOT apply a `timeoutMs` change by the window rule while fewer than 40 decisions follow the latest history entry whose `parameter` is `timeoutMs`, whatever its cause. The burst rule MUST NOT wait for this cooldown; lowering has its own 200-decision wait. History entries of band floors MUST NOT start or extend any `timeoutMs` wait.

#### Scenario: Inside the cooldown
- **WHEN** the record has no pending change, the latest history entry is at time 1000, and 39 decisions follow it, 2 asked and timed out and the rest unasked
- **THEN** the step returns no `applied` event

#### Scenario: Burst inside the cooldown
- **WHEN** the record has no pending change, the latest history entry is at time 1000, and 39 decisions follow it, all with `miss` `timeout`
- **THEN** the step returns an `applied` event from the burst rule

#### Scenario: Cooldown passed
- **WHEN** the record has no pending change, the latest history entry is at time 1000, 40 asked decisions follow it, and 10 of them timed out
- **THEN** the step returns an `applied` event

#### Scenario: Decisions before the change do not count
- **WHEN** the latest history entry is at time 1000, the ledger has 100 decisions before it and 20 answered decisions after it
- **THEN** the cooldown has not passed and the step returns no `applied` event

#### Scenario: Floor change does not hold back the timeout
- **WHEN** the latest `timeoutMs` entry is at time 1000, a `turnFloor.long` entry is at time 5000, and the 40 decisions after time 1000, 10 of them after time 5000, have 40 asked with 10 timeouts
- **THEN** the step returns an `applied` event for `timeoutMs`

### Requirement: Evaluating a pending change
<!-- Intentional change: "Worse is judged a revert" now states no rescued answer; "Not yet judged" now states the burst rule does not fire. -->
When at least 40 decisions follow the `at` of the `timeoutMs` pending change, the step SHALL judge the first 40. A raise (`to` above `from`) SHALL be kept when at least one answered decision among them has `ms` above `from`. A lowering (`to` below `from`) SHALL be reverted when at least 20 are asked and at least one of them timed out. Otherwise, with at least 20 asked and a timeout share strictly greater than the share in `before` (compared by cross-multiplying counts), it SHALL revert. Otherwise it SHALL keep the change: clear the pending change, add no history entry, and return a `kept` event with the pending `from` and `to`. A kept change whose tuned value equals its base SHALL remove the tuned value. With fewer than 40 decisions after it, the step MUST NOT judge it and the window rule MUST NOT fire. Band floor changes are judged by `turn-floor-rules`.

#### Scenario: Worse is judged a revert
- **WHEN** a pending change from 1500 to 1700 has `before` 40 asked and 6 timeouts, and the first 40 decisions after it have 40 asked with 8 timeouts and no answer above 1500 ms
- **THEN** the step returns a `reverted` event

#### Scenario: Rescued answer keeps a raise
- **WHEN** a pending change from 1700 to 1900 has `before` 40 asked and 6 timeouts, and the first 40 decisions after it have 40 asked with 15 timeouts and one answer of 1850 ms
- **THEN** the events start with `kept` from 1700 to 1900 and hold no `reverted` event

#### Scenario: Answer at the old value is no rescue
- **WHEN** a pending change from 1700 to 1900 has `before` 40 asked and 6 timeouts, and the first 40 decisions after it have 40 asked with 8 timeouts and the slowest answer is 1700 ms
- **THEN** the step returns a `reverted` event

#### Scenario: Worse lowering reverted
- **WHEN** a pending change from 3000 to 2400 has `before` 40 asked and no timeout, and the first 40 decisions after it have 40 asked, 39 answered in 1000 ms and 1 timed out
- **THEN** the step returns a `reverted` event from 2400 to 3000

#### Scenario: Lowering with an empty before
- **WHEN** a pending change from 3000 to 2400 has `before` 0 asked and no timeout, and the first 40 decisions after it have 20 asked with 1 timeout
- **THEN** the step returns a `reverted` event from 2400 to 3000

#### Scenario: Equal, kept
- **WHEN** a pending change has `before` 40 asked and 8 timeouts, and the first 40 decisions after it have 40 asked with 8 timeouts
- **THEN** the pending change is cleared, the tuned value stays, and the events start with `kept`

#### Scenario: Too few asked, kept
- **WHEN** a pending change has `before` 40 asked and 6 timeouts, and the first 40 decisions after it have 10 asked, all timed out
- **THEN** the change is kept

#### Scenario: Not yet judged
- **WHEN** a pending change has 39 decisions after it and the burst rule does not fire
- **THEN** the step returns no `timeoutMs` event and the pending change stays

#### Scenario: Kept, then the rule fires
- **WHEN** a pending change from 1500 to 1700 has `before` 40 asked and 12 timeouts, it is kept, and the latest 40 decisions after its history entry have 40 asked with 10 timeouts
- **THEN** the events are `kept` from 1500 to 1700, then `applied` from 1700 to a higher value

### Requirement: Block after a revert or an undo
The `timeoutMs` block SHALL hold a value and the time it was set. Its direction SHALL be derived from the reference value, the record's tuned `timeoutMs` value when it has one, else the untuned value: a block above the reference value holds back raises, a block below it holds back lowerings, and a block equal to it holds back nothing. A raise block lasts while fewer than 200 decisions follow the block's time; a lowering block lasts while fewer than 400 do, so it outlives the 200-decision wait of lowering. While a raise block is active, a value the window rule computes at or above the blocked value MUST be lowered to the blocked value minus 100. While a lowering block is active, a value lowering computes at or below the blocked value MUST be raised to the blocked value plus 100. The burst rule MUST NOT be limited by a block. After its lifetime the block MUST no longer apply. Band floor blocks follow `turn-floor-rules`.

#### Scenario: Blocked raise lowered
- **WHEN** a block at 1700 has 50 decisions after it, `current` is 1500, and the rule computes 1700
- **THEN** the new value is 1600

#### Scenario: Blocked raise dropped
- **WHEN** a block at 1700 has 50 decisions after it, `current` is 1600, and the rule computes 1800
- **THEN** the step returns no `applied` event

#### Scenario: Block at the ceiling
- **WHEN** a block at 5000 has 50 decisions after it, `current` is 4800, and the rule computes 5200
- **THEN** the value is clamped to 5000, lowered by the block to 4900, and applied

#### Scenario: Block expired
- **WHEN** a block at 1700 has 200 decisions after it, `current` is 1500, and the rule computes 1700
- **THEN** the new value is 1700

#### Scenario: Blocked lowering raised
- **WHEN** a lowering from 3000 to 2400 is reverted at time 1000, 250 clean decisions follow, and lowering computes 2400
- **THEN** the new value is 2500

#### Scenario: Blocked lowering dropped
- **WHEN** a block at 2400 has 250 decisions after it, the tuned value is 2500 with base 1500, and lowering computes 2000
- **THEN** the step returns no `applied` event

#### Scenario: Raise block does not hold back a lowering
- **WHEN** a hand-edited record holds the tuned value 3000 with base 1500, a block at 3500 with 150 decisions after it, and its latest `timeoutMs` history entry 200 clean decisions back, and lowering computes 2400
- **THEN** the new value is 2400

#### Scenario: Lowering block expired
- **WHEN** a block at 2400 has 400 decisions after it, the tuned value is 3000 with base 1500, and lowering computes 2400
- **THEN** the new value is 2400

#### Scenario: Block equal to the reference holds back nothing
- **WHEN** a raise from 1500 to 1700 was reverted, leaving a block at 1700 and no tuned value, and the config now sets `classifier.timeoutMs` to 1700
- **THEN** the block holds back neither a raise nor a lowering, and the window rule computes its value with no block

### Requirement: Step order across parameters
<!-- Intentional change: "Revert blocks every apply" now uses the burst rule; "Floor applies when timeout does not" now says no `timeoutMs` rule applies. -->
The step SHALL handle the parameters `timeoutMs`, `turnFloor.medium`, `turnFloor.long` and `turnFloor.very_long` in that order, in four phases: supersede each parameter, judge each pending change, then, only when no change was reverted, try the `timeoutMs` rules in the order burst rule, window rule, lowering, and then each band floor rule. The step MUST return at most one `applied` event: it stops at the first rule that applies a change.

#### Scenario: One applied change per step
- **WHEN** the timeout rule fires and the `long` window would lower its floor in the same step
- **THEN** the events hold one `applied` event, for `timeoutMs`, and the `long` floor is unchanged

#### Scenario: Burst before the window rule
- **WHEN** both the burst rule and the window rule would fire
- **THEN** the events hold one `applied` event, with the burst rule's value

#### Scenario: Floor applies when timeout does not
- **WHEN** no `timeoutMs` rule applies and both the `medium` and `long` windows would change their floors
- **THEN** the events hold one `applied` event, for `turnFloor.medium`

#### Scenario: Revert blocks every apply
- **WHEN** a `long` floor change is reverted and the burst rule would fire
- **THEN** the step returns no `applied` event

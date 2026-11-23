# tuning-rules Specification

## Purpose
Pure rules that tune `classifier.timeoutMs` from plain ledger lines: when the timeout rule fires, the new value, the cooldown, judging and reverting a change, the block after a revert or undo, a config edit superseding tuning, and the undo, reset and off transitions.

## Requirements

### Requirement: Pure tuning step
The package SHALL provide one pure step function. Its inputs are the tuning record, the untuned `timeoutMs` (from config, or the default), the ledger lines, and the current time. It returns the next tuning record and a list of events, each `superseded`, `kept`, `reverted` or `applied`, with the `parameter` (`timeoutMs` or `turnFloor.<band>`) and its `from` and `to` values. The function MUST do no I/O, MUST NOT call Jev, and MUST NOT change its inputs. The only parameters it may change are `timeoutMs` and the band floors `turnFloor.medium`, `turnFloor.long` and `turnFloor.very_long`.

#### Scenario: Nothing to do
- **WHEN** the record is empty and the ledger has 10 decisions
- **THEN** the step returns the record unchanged and no events

#### Scenario: Inputs unchanged
- **WHEN** the step applies a change
- **THEN** the record and the lines passed in are deep-equal to copies taken before the call

#### Scenario: Event names its parameter
- **WHEN** the timeout rule fires from 1500 to 1700
- **THEN** the event is `applied` with `parameter` `timeoutMs`, `from` 1500 and `to` 1700

### Requirement: Decisions counted by time
A decision SHALL be a `main` or `worker` line; `correction` lines MUST be ignored. A decision is after an event when its `at` is strictly greater than the event's `at`. Decisions SHALL be ordered by `at`, with ties broken by `kind`, `session`, `answered`, `miss` and `ms`, in that order. Lines equal on all of these are interchangeable. The step MUST NOT depend on the order of the lines in its input.

#### Scenario: Correction lines ignored
- **WHEN** the ledger has 40 `correction` lines after the latest change and 39 decisions
- **THEN** the cooldown has not passed and the step returns no events

#### Scenario: Line order does not matter
- **WHEN** the same lines, several of them sharing one `at`, are passed in two different orders
- **THEN** both steps return equal records and events

### Requirement: The timeout rule
The step SHALL use as the window the latest 40 decisions, all after the latest history entry whose `parameter` is `timeoutMs`. A decision was asked when it is answered or has a `miss`. The rule SHALL fire when the window holds 40 decisions, at least 20 of them asked, and the asked ones with `miss` `timeout` are more than 10%: `timeouts × 10 > asked`, compared in integers. `error` and `schema` misses MUST NOT count as timeouts, but they do count as asked.

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
When the timeout rule fires, the step SHALL compute `max(current + 200, ceil100(p90 × 1.25))`, clamp it to 300–5000, apply any active `timeoutMs` block, then compare it with `current`, the effective `timeoutMs` before the step. `p90` is the nearest-rank 90th percentile of `ms` over answered decisions in the window that carry `ms`; with none, only `current + 200` applies. A final value not above `current` MUST make no change and no event.

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
- **WHEN** the window has 30 answered decisions, 10 of them without `ms`, and 10 timeouts
- **THEN** p90 is taken over the 20 values present, and all 40 count as asked

#### Scenario: Clamped to the ceiling
- **WHEN** `current` is 4900 and the rule fires
- **THEN** the new value is 5000

#### Scenario: Already at the ceiling
- **WHEN** `current` is 5000 and the rule fires
- **THEN** the step returns no `applied` event and the record is unchanged

### Requirement: Applying a change
When the timeout rule fires with a new value, the step SHALL set the tuned `timeoutMs` to that value, with `base` equal to the untuned value. It SHALL set the `timeoutMs` pending change to `from` (`current`), `to` (the new value), `at` (the current time) and `before`, the window's asked and timeout counts. It SHALL add a history entry with `parameter` `timeoutMs` and cause `rule`, and return an `applied` event for `timeoutMs`.

#### Scenario: First change recorded
- **WHEN** the untuned value is 1500, no value is tuned, and the rule fires at time 1000 with 40 asked, 8 timeouts and a new value of 1700
- **THEN** the record's `timeoutMs` is value 1700 with base 1500, pending is `from` 1500, `to` 1700, `at` 1000, `before` 40 asked and 8 timeouts, the last history entry is `rule` from 1500 to 1700, and the events are one `applied` from 1500 to 1700

#### Scenario: Second step
- **WHEN** the tuned value is 1700 with base 1500, there is no pending change, and the rule fires with a new value of 1900
- **THEN** the tuned value is 1900 with base 1500, and pending `from` is 1700

### Requirement: Cooldown
The step SHALL NOT apply a `timeoutMs` change while fewer than 40 decisions follow the latest history entry whose `parameter` is `timeoutMs`, whatever its cause. History entries of band floors MUST NOT start or extend the `timeoutMs` cooldown.

#### Scenario: Inside the cooldown
- **WHEN** the record has no pending change, the latest history entry is at time 1000, and 39 decisions follow it, all with `miss` `timeout`
- **THEN** the step returns no `applied` event

#### Scenario: Cooldown passed
- **WHEN** the record has no pending change, the latest history entry is at time 1000, 40 asked decisions follow it, and 10 of them timed out
- **THEN** the step returns an `applied` event

#### Scenario: Decisions before the change do not count
- **WHEN** the latest history entry is at time 1000, the ledger has 100 decisions before it and 20 after it
- **THEN** the cooldown has not passed

#### Scenario: Floor change does not hold back the timeout
- **WHEN** the latest `timeoutMs` entry is at time 1000, a `turnFloor.long` entry is at time 5000, and the 40 decisions after time 1000, 10 of them after time 5000, have 40 asked with 10 timeouts
- **THEN** the step returns an `applied` event for `timeoutMs`

### Requirement: Evaluating a pending change
When at least 40 decisions follow the `at` of the `timeoutMs` pending change, the step SHALL judge the first 40. With at least 20 asked and a timeout share strictly greater than the share in `before` (compared by cross-multiplying counts), it SHALL revert. Otherwise it SHALL keep the change: clear the pending change, add no history entry, and return a `kept` event with the pending `from` and `to`. With fewer than 40 decisions after it, the step MUST NOT judge it and the timeout rule MUST NOT fire. Band floor changes are judged by `turn-floor-rules`.

#### Scenario: Worse is judged a revert
- **WHEN** a pending change has `before` 40 asked and 6 timeouts, and the first 40 decisions after it have 40 asked with 8 timeouts
- **THEN** the step returns a `reverted` event

#### Scenario: Equal, kept
- **WHEN** a pending change has `before` 40 asked and 8 timeouts, and the first 40 decisions after it have 40 asked with 8 timeouts
- **THEN** the pending change is cleared, the tuned value stays, and the events start with `kept`

#### Scenario: Too few asked, kept
- **WHEN** a pending change has `before` 40 asked and 6 timeouts, and the first 40 decisions after it have 10 asked, all timed out
- **THEN** the change is kept

#### Scenario: Not yet judged
- **WHEN** a pending change has 39 decisions after it
- **THEN** the step returns no `timeoutMs` event and the pending change stays

#### Scenario: Kept, then the rule fires
- **WHEN** a pending change from 1500 to 1700 has `before` 40 asked and 12 timeouts, it is kept, and the latest 40 decisions after its history entry have 40 asked with 10 timeouts
- **THEN** the events are `kept` from 1500 to 1700, then `applied` from 1700 to a higher value

### Requirement: Reverting a change
A revert SHALL set the tuned value back to the pending change's `from`, or remove the tuned value when `from` equals its base. It SHALL clear the pending change, add a history entry with cause `revert` at the current time, set a block at the change's `to` value with the current time, and return a `reverted` event from `to` to `from`. The step MUST NOT apply a change of any parameter in the same call as a revert of any parameter.

#### Scenario: Revert to the untuned value
- **WHEN** a pending change from 1500 to 1700 has base 1500 and is judged worse at time 9000
- **THEN** the tuned value is removed, the effective value is 1500, a block is set at 1700 at time 9000, history ends with `revert` from 1700 to 1500, and the events are one `reverted` from 1700 to 1500

#### Scenario: Revert to an earlier tuned value
- **WHEN** a pending change from 1700 to 1900 has base 1500 and is judged worse
- **THEN** the tuned value becomes 1700 with base 1500

#### Scenario: No fire right after a revert
- **WHEN** the step reverts a change and the latest 40 decisions would make the rule fire
- **THEN** it returns no `applied` event in the same call

### Requirement: Block after a revert or an undo
The `timeoutMs` block SHALL hold a value and the time it was set. While fewer than 200 decisions follow the block's time, a value at or above the blocked value MUST be lowered to the blocked value minus 100. After 200 decisions the block MUST no longer apply. Band floor blocks follow `turn-floor-rules`.

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

### Requirement: Config edit supersedes tuning
When the record has a tuned `timeoutMs` whose `base` differs from the untuned value, the step SHALL first remove the tuned `timeoutMs`, its pending change and its block, and MUST leave every band floor's state unchanged. It SHALL add a history entry with cause `superseded`, from the tuned value to the untuned value, and return a `superseded` event. The removal counts as a change for the `timeoutMs` cooldown.

#### Scenario: Operator edits config
- **WHEN** the tuned value is 1700 with base 1500 and the untuned value is now 2000
- **THEN** the record has no tuned value, no pending change and no block, history ends with `superseded` from 1700 to 2000, and the events are one `superseded` from 1700 to 2000

#### Scenario: No change right after superseding
- **WHEN** a tuned value is superseded, and the latest 40 decisions would make the rule fire
- **THEN** the step returns no `applied` event, and the next one comes only after 40 decisions follow the `superseded` entry

#### Scenario: Matching base untouched
- **WHEN** the tuned value is 1700 with base 1500 and the untuned value is 1500
- **THEN** no `superseded` event is returned

#### Scenario: Floors kept on a config edit
- **WHEN** the tuned `timeoutMs` is 1700 with base 1500, the untuned value is now 2000, and the `long` floor is tuned to 120 with base 100
- **THEN** the `long` floor stays 120 with base 100

### Requirement: Tuning off
The record SHALL hold an `off` flag. A pure transition MUST set or clear it, adding no history entry and changing nothing else. While `off` is set, the step MUST return the record unchanged and no events, even with a pending change or a superseded value.

#### Scenario: Off stops everything
- **WHEN** `off` is set, a pending change has 40 worse decisions after it, and the rule would fire
- **THEN** the step returns the record unchanged and no events

#### Scenario: Turning off keeps the tuned value
- **WHEN** the tuned value is 1700 and tuning is turned off
- **THEN** the record keeps value 1700 and its history is unchanged

### Requirement: Undo
A pure undo transition SHALL pick, among the parameters with a tuned value that applies (for `timeoutMs`, `base` equal to the untuned value; for a band floor, `base` equal to its built-in floor), the one changed most recently (for a band floor, the later of its `changedAt` and its latest history entry), ties going to the order `timeoutMs`, `turnFloor.medium`, `turnFloor.long`, `turnFloor.very_long`. For that parameter it SHALL move the tuned value to the `from` of the latest `rule` entry of that parameter whose `to` equals it, or remove it when there is no such entry or the target equals the base. A band floor target MUST first be kept in the band order by the Band order rule of `turn-floor-rules`, counting a neighbour's pending change at its worst value; when that leaves the target equal to the current value, undo MUST skip that parameter and pick the next most recent one. An undone band floor's `changedAt` SHALL be set to the current time. Undo clears that parameter's pending change, sets its block at the undone value with the current time, and adds an `undo` history entry for that parameter. Other parameters MUST NOT change. With no parameter left, undo MUST report nothing to undo and return the record unchanged.

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

### Requirement: Reset
A pure reset transition SHALL remove the tuned value, pending change and block of every parameter, drop all band floor state including `changedAt`, and keep the `off` flag. For each parameter that had a tuned value, it SHALL add a history entry with cause `reset` from the tuned value to the untuned value (`timeoutMs`) or the built-in floor (band floors), in the order `timeoutMs`, `turnFloor.medium`, `turnFloor.long`, `turnFloor.very_long`. With no tuned value, it adds no entry.

#### Scenario: Reset after changes
- **WHEN** the tuned value is 1900 with base 1500, a block is set, `off` is set, and reset runs
- **THEN** the record has no tuned value, no pending change, no block, `off` still set, and history ends with `reset` from 1900 to 1500

#### Scenario: Reset floors too
- **WHEN** `timeoutMs` is tuned to 1700 with base 1500, the `long` floor to 120 with base 100 and a `long` block is set, and reset runs
- **THEN** the record has no tuned values, pending changes or blocks, and history ends with `reset` `timeoutMs` 1700→1500 then `reset` `turnFloor.long` 120→100

### Requirement: Bounded history
Every transition that adds a history entry SHALL keep only the latest 50 entries. Each entry MUST hold `at`, `parameter` (`timeoutMs`, `turnFloor.medium`, `turnFloor.long` or `turnFloor.very_long`), `from`, `to` and `cause`.

#### Scenario: Oldest dropped
- **WHEN** the history has 50 entries and a change is applied
- **THEN** the history has 50 entries, the oldest one dropped and the new one last

#### Scenario: Shared across parameters
- **WHEN** the history has 50 `timeoutMs` entries and a `turnFloor.long` change is applied
- **THEN** the history has 50 entries and the last one is the `turnFloor.long` entry

### Requirement: Step order across parameters
The step SHALL handle the parameters `timeoutMs`, `turnFloor.medium`, `turnFloor.long` and `turnFloor.very_long` in that order, in four phases: supersede each parameter, judge each pending change, then, only when no change was reverted, try the timeout rule and then each band floor rule. The step MUST return at most one `applied` event: it stops at the first parameter that applies a change.

#### Scenario: One applied change per step
- **WHEN** the timeout rule fires and the `long` window would lower its floor in the same step
- **THEN** the events hold one `applied` event, for `timeoutMs`, and the `long` floor is unchanged

#### Scenario: Floor applies when timeout does not
- **WHEN** the timeout rule does not fire and both the `medium` and `long` windows would change their floors
- **THEN** the events hold one `applied` event, for `turnFloor.medium`

#### Scenario: Revert blocks every apply
- **WHEN** a `long` floor change is reverted and the timeout rule would fire
- **THEN** the step returns no `applied` event

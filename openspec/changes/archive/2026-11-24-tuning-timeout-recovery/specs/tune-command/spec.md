## MODIFIED Requirements

### Requirement: Tune report state lines
After the `timeoutMs` line, the tune report SHALL show, from the record even while the config is invalid, each only when it holds: `tuning paused: config error` while the config is invalid; `pending: <from>→<to>, <n>/40 decisions since`, with `<n>` capped at 40; and, while a block is active, `block: raises to <value> or above held back for <k> more decisions` when it holds back raises, or `block: lowerings to <value> or below held back for <k> more decisions` when it holds back lowerings, with the direction and lifetime of `tuning-rules` "Block after a revert or an undo". A block that holds back nothing MUST show no line.

#### Scenario: Neither pending nor blocked
- **WHEN** `tuning.json` holds only `timeoutMs` value 1700 with base 1500
- **THEN** the report has no `pending:`, `block:` or `tuning paused` line

#### Scenario: Lowering block
- **WHEN** `tuning.json` holds value 3000 with base 1500 and a block at 2400 at time 1000, and 50 decisions follow it
- **THEN** the report contains `block: lowerings to 2400 or below held back for 350 more decisions`

#### Scenario: Lowering block while the config is invalid
- **WHEN** `tuning.json` holds value 3000 with base 1500 and a block at 2400 at time 1000, 50 decisions follow it, and `config.json` is invalid
- **THEN** the report contains `tuning paused: config error` and `block: lowerings to 2400 or below held back for 350 more decisions`

#### Scenario: Block equal to the reference not shown
- **WHEN** `tuning.json` holds no tuned value and a block at 1700 with 10 decisions after it, and the config sets `classifier.timeoutMs` to 1700
- **THEN** the report has no `block:` line

### Requirement: Tune undo
`/jev tune undo` SHALL apply the undo transition to `tuning.json`. For `timeoutMs` it SHALL report `Jev tune: timeoutMs <from>→<to> undone. The same raise is held back for 200 decisions.` when the undo moves the value down, and `Jev tune: timeoutMs <from>→<to> undone. The same lowering is held back for 400 decisions.` when it moves the value up. For a band floor it SHALL report `Jev tune: turnFloor.<band> <from>→<to> undone. The same change is held back for 400 <band> runs.` With `ctx.hasUI`, the same update SHALL set `seenAt` to the current time. When no parameter has a tuned value that applies, it SHALL report `Jev tune: nothing to undo.` and write nothing. While `config.json` is invalid, it MUST refuse with an error and change nothing.

#### Scenario: Undo a change
- **WHEN** `tuning.json` holds value 1700 with base 1500 and a `rule` entry from 1500 to 1700, and the operator runs `/jev tune undo`
- **THEN** `tuning.json` has no tuned value, a block at 1700, an `undo` history entry and `seenAt` equal to the current time, and the report is `Jev tune: timeoutMs 1700→1500 undone. The same raise is held back for 200 decisions.`

#### Scenario: Nothing to undo
- **WHEN** nothing is tuned and the operator runs `/jev tune undo`
- **THEN** the report is `Jev tune: nothing to undo.` and `tuning.json` is not created

#### Scenario: Stale tuned value
- **WHEN** `tuning.json` holds value 1700 with base 1500, the config sets `classifier.timeoutMs` to 2000, no floor is tuned, and the operator runs `/jev tune undo`
- **THEN** the report is `Jev tune: nothing to undo.` and `tuning.json` is unchanged

#### Scenario: Undo without a UI
- **WHEN** `tuning.json` holds value 1700 with base 1500, a `rule` entry from 1500 to 1700, and no `seenAt`, and Pi runs `/jev tune undo` with `-p`
- **THEN** `tuning.json` has no tuned value and still has no `seenAt`, and stdout holds nothing from the package

#### Scenario: Undo a floor change
- **WHEN** `tuning.json` holds the `long` floor 80 with base 100 and a `rule` entry `turnFloor.long` from 100 to 80, and the operator runs `/jev tune undo`
- **THEN** `tuning.json` has no `long` tuned floor and a `long` block at 80, and the report is `Jev tune: turnFloor.long 80→100 undone. The same change is held back for 400 long runs.`

#### Scenario: Undo a lowering
- **WHEN** `tuning.json` holds value 2400 with base 1500, history holds `rule` 1500→3000 and `rule` 3000→2400, and the operator runs `/jev tune undo`
- **THEN** `tuning.json` holds value 3000 with a block at 2400, and the report is `Jev tune: timeoutMs 2400→3000 undone. The same lowering is held back for 400 decisions.`

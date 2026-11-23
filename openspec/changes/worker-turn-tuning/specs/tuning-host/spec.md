## ADDED Requirements

### Requirement: Tuned floors reach worker routing
Worker routing SHALL take the band floors from the settings snapshot, so a tuned floor that applies is the floor written for a launch rated in that band. A tuned floor MUST still only raise a launch's limit: it is written only when the launch can raise and the floor is above `requested.maxTurns`.

#### Scenario: Tuned floor written
- **WHEN** `tuning.json` holds the `long` floor 120 with base 100, and a launch with `max_turns` 20 is rated `long`
- **THEN** the launch is written `maxTurns` 120 and its ledger line has `turnFloor` 120

#### Scenario: Lowered floor never lowers a limit
- **WHEN** `tuning.json` holds the `long` floor 80 with base 100, and a launch with `max_turns` 90 is rated `long`
- **THEN** no `maxTurns` is written

#### Scenario: Bad tuning file uses built-in floors
- **WHEN** `tuning.json` is truncated and a launch with `max_turns` 20 is rated `long`
- **THEN** the launch is written `maxTurns` 100

#### Scenario: Jev miss writes no floor
- **WHEN** `tuning.json` holds the `long` floor 120 with base 100, and a launch with `max_turns` 20 is asked `turns` and Jev times out
- **THEN** no `maxTurns` is written

## MODIFIED Requirements

### Requirement: Change line texts
Each `applied`, `reverted` and `superseded` event SHALL show one info notification, in event order. A `kept` event MUST show nothing. The texts MUST be, with `→` being U+2192:
- `timeoutMs` applied: `Jev tune: timeoutMs <from>→<to> · /jev tune undo`
- `timeoutMs` reverted: `Jev tune: timeoutMs <from>→<to>, reverted: timeouts did not improve · /jev tune`
- `timeoutMs` superseded: `Jev tune: timeoutMs <from>→<to>, your config value replaces the tuned one`
- floor applied: `Jev tune: turnFloor.<band> <from>→<to> · /jev tune undo`
- floor reverted: `Jev tune: turnFloor.<band> <from>→<to>, reverted: more runs ran out of turns · /jev tune`
- floor superseded: `Jev tune: turnFloor.<band> <from>→<to>, the built-in floor changed`

#### Scenario: Applied line
- **WHEN** a settle applies a change from 1500 to 1700
- **THEN** one info notification carries `Jev tune: timeoutMs 1500→1700 · /jev tune undo`

#### Scenario: Reverted line
- **WHEN** a settle reverts a pending change from 1500 to 1700
- **THEN** one info notification carries `Jev tune: timeoutMs 1700→1500, reverted: timeouts did not improve · /jev tune`

#### Scenario: Superseded line
- **WHEN** `tuning.json` holds value 1700 with base 1500, the config now sets `classifier.timeoutMs` to 2000, and a main run settles
- **THEN** one info notification carries `Jev tune: timeoutMs 1700→2000, your config value replaces the tuned one`

#### Scenario: Kept is silent
- **WHEN** a settle keeps a pending change and applies nothing else
- **THEN** `tuning.json` no longer has a pending change and no tuning line is shown

#### Scenario: Floor applied line
- **WHEN** a main run settles with 200 counted `long` runs whose p95 is 60, and nothing else changes
- **THEN** `tuning.json` holds the `long` floor 80 with base 100 and one info notification carries `Jev tune: turnFloor.long 100→80 · /jev tune undo`

#### Scenario: Floor superseded line
- **WHEN** a settle supersedes a `long` tuned floor 120 whose base differs from the built-in floor 100
- **THEN** one info notification carries `Jev tune: turnFloor.long 120→100, the built-in floor changed`

#### Scenario: Floor reverted line
- **WHEN** a settle reverts a `long` pending change from 100 to 80
- **THEN** one info notification carries `Jev tune: turnFloor.long 80→100, reverted: more runs ran out of turns · /jev tune`

### Requirement: Session start line
At the start of a main session with a UI, when `tuning.json` has unseen history entries, the package SHALL first set `seenAt` to the `at` of the latest unseen entry. Only after that write succeeds, it SHALL show one info notification `Jev tune since your last session: <changes> (<n> change|changes) · /jev tune`. `<changes>` lists each parameter with unseen entries, in the order of its first unseen entry, separated by `, `, each as `<parameter> <from>→<to>`, where `<from>` is the `from` of that parameter's earliest unseen entry and `<to>` the `to` of its latest. `<n>` counts all unseen entries, with `change` when `n` is 1. `<from>` and `<to>` MAY be equal.

#### Scenario: One unseen change
- **WHEN** `tuning.json` has no `seenAt` and one `rule` entry from 1500 to 1700 at time 1000, and a main session starts with a UI
- **THEN** one info notification carries `Jev tune since your last session: timeoutMs 1500→1700 (1 change) · /jev tune`, and `tuning.json` holds `seenAt` 1000

#### Scenario: Several unseen changes
- **WHEN** `seenAt` is 1000, history holds a `rule` entry at 1000 (1500 to 1700), a `rule` entry at 2000 (1700 to 1900) and a `rule` entry at 3000 (1900 to 2100), and a main session starts with a UI
- **THEN** the line reads `Jev tune since your last session: timeoutMs 1700→2100 (2 changes) · /jev tune` and `seenAt` becomes 3000

#### Scenario: Changes that cancel out
- **WHEN** the unseen entries are a `rule` from 1500 to 1700 and a `revert` from 1700 to 1500
- **THEN** the line reads `Jev tune since your last session: timeoutMs 1500→1500 (2 changes) · /jev tune`

#### Scenario: Shown once
- **WHEN** a session start shows the line and a second session starts with no new change
- **THEN** the second session shows no tuning line

#### Scenario: Several parameters
- **WHEN** the unseen entries are `rule` `timeoutMs` 1500→1700, `rule` `turnFloor.long` 100→80 and `rule` `timeoutMs` 1700→1900, in that order
- **THEN** the line reads `Jev tune since your last session: timeoutMs 1500→1900, turnFloor.long 100→80 (3 changes) · /jev tune`

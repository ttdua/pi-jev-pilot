## MODIFIED Requirements

### Requirement: Tuning step at agent_settled
<!-- Intentional change: "Rule fires at settle" now pins that the 9 seeded timeouts come first and carry no `ms`, so neither the burst rule nor the measured p90 changes its outcome. -->
When a main-session run settles, the package SHALL run the tuning step once, after that run's ledger lines are written. The step's inputs are the record read from `tuning.json`, the untuned `timeoutMs` (the config value, or the default), the lines read from the ledger and the current time. The step MUST NOT call Jev or any network service, and tuning MUST NOT store or show prompt text, tool arguments or tool output.

#### Scenario: Rule fires at settle
- **WHEN** no `tuning.json` exists, the config does not set `classifier.timeoutMs`, the ledger holds 39 main decisions after time 0, the first 9 timed out without `ms` and the next 30 answered in 1000 ms, and one more main run settles with a timeout
- **THEN** `tuning.json` holds `timeoutMs` value 1700 with base 1500, a pending change from 1500 to 1700, and a `rule` history entry

#### Scenario: No Jev call
- **WHEN** a main run settles and a tuning change is applied
- **THEN** the Jev fixture received only the requests of the turn itself

### Requirement: Change line texts
Each `applied`, `reverted` and `superseded` event SHALL show one info notification, in event order. A `kept` event MUST show nothing. The texts MUST be, with `→` being U+2192:
- `timeoutMs` applied: `Jev tune: timeoutMs <from>→<to> · /jev tune undo`
- `timeoutMs` raise reverted (`to` below `from`): `Jev tune: timeoutMs <from>→<to>, reverted: timeouts did not improve · /jev tune`
- `timeoutMs` lowering reverted (`to` above `from`): `Jev tune: timeoutMs <from>→<to>, reverted: timeouts came back · /jev tune`
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

#### Scenario: Lowering reverted line
- **WHEN** a settle reverts a pending change from 3000 to 2400
- **THEN** one info notification carries `Jev tune: timeoutMs 2400→3000, reverted: timeouts came back · /jev tune`

#### Scenario: Burst applied line
- **WHEN** `tuning.json` holds value 1700 with base 1500 and a `rule` entry, three main runs after that entry time out, and the third settles
- **THEN** one info notification carries `Jev tune: timeoutMs 1700→2200 · /jev tune undo`

## ADDED Requirements

### Requirement: Tuning step at agent_settled
When a main-session run settles, the package SHALL run the tuning step once, after that run's ledger lines are written. The step's inputs are the record read from `tuning.json`, the untuned `timeoutMs` (the config value, or the default), the lines read from the ledger and the current time. The step MUST NOT call Jev or any network service, and tuning MUST NOT store or show prompt text, tool arguments or tool output.

#### Scenario: Rule fires at settle
- **WHEN** no `tuning.json` exists, the config does not set `classifier.timeoutMs`, the ledger holds 39 main decisions after time 0 of which 9 timed out and 30 were answered in 1000 ms, and one more main run settles with a timeout
- **THEN** `tuning.json` holds `timeoutMs` value 1700 with base 1500, a pending change from 1500 to 1700, and a `rule` history entry

#### Scenario: No Jev call
- **WHEN** a main run settles and a tuning change is applied
- **THEN** the Jev fixture received only the requests of the turn itself

### Requirement: Tuned value reaches every reader
Every reader of `classifier.timeoutMs` (the main decision, worker routing and tool assessment) SHALL take it from the settings snapshot, so a tuned value that applies is used by all of them.

#### Scenario: Tuned value used by the next request
- **WHEN** `tuning.json` holds `timeoutMs` value 2500 with base 1500, the config does not set `classifier.timeoutMs`, Jev hangs, and a prompt is sent
- **THEN** the main ledger line has `miss` `timeout` and `ms` at least 2500

#### Scenario: Worker routing uses the tuned value
- **WHEN** `tuning.json` holds `timeoutMs` value 2500 with base 1500 and a worker launch asks Jev
- **THEN** the worker request is made with timeout 2500

### Requirement: Tuning writes only on change
When the step returns no events, `tuning.json` MUST NOT be written. Otherwise the package SHALL update `tuning.json` atomically, computing the step again on the record read inside the update. The lines shown and `seenAt` MUST come from the events of that second computation. The tuning step MUST NOT write `config.json`, `state.json` or the ledger.

#### Scenario: Nothing to change
- **WHEN** the ledger holds 10 answered decisions and a main run settles
- **THEN** no `tuning.json` is created

#### Scenario: Other files untouched
- **WHEN** `config.json` and `state.json` exist and a settle applies a change
- **THEN** both files have the same bytes as before

#### Scenario: Another process changed it first
- **WHEN** the first computation returns an `applied` event, but the record read inside the update already holds that change, so the second computation returns no events
- **THEN** `tuning.json` has the same content as before, `seenAt` is not changed, and no tuning line is shown

### Requirement: When the tuning step is skipped
The tuning step MUST NOT run in a worker session, while `config.json` is invalid, while `tuning.json` exists but cannot be read, or while the ledger cannot be read. In each case `tuning.json` MUST be left unchanged and no tuning line shown. A malformed `tuning.json` reads as an empty record. A step that then changes something recovers the file as any update does, moving it to `tuning.json.bad`.

#### Scenario: Worker session
- **WHEN** a worker run settles in a child session and the ledger would make the rule fire
- **THEN** `tuning.json` is unchanged

#### Scenario: Invalid config
- **WHEN** `config.json` has an invalid `classifier.timeoutMs`, `tuning.json` holds value 1700 with base 2000, and a main run settles
- **THEN** `tuning.json` is unchanged and no tuning line is shown

#### Scenario: Unreadable tuning file
- **WHEN** `tuning.json` has mode `0000` and a main run settles with a ledger that would make the rule fire
- **THEN** `tuning.json` is unchanged and no `tuning.json.bad` exists (skipped when the test runs as root)

#### Scenario: Unreadable ledger
- **WHEN** `ledger.jsonl` has mode `0000` and a main run settles
- **THEN** `tuning.json` is unchanged and no tuning line is shown (skipped when the test runs as root)

#### Scenario: Malformed tuning file recovered
- **WHEN** `tuning.json` is truncated and a main run settles with a ledger that makes the rule fire
- **THEN** the old bytes are in `tuning.json.bad`, and `tuning.json` holds the new change

### Requirement: Change line texts
Each `applied`, `reverted` and `superseded` event SHALL show one info notification, in event order. A `kept` event MUST show nothing. The texts MUST be, with `→` being U+2192:
- applied: `Jev tune: timeoutMs <from>→<to> · /jev tune undo`
- reverted: `Jev tune: timeoutMs <from>→<to>, reverted: timeouts did not improve · /jev tune`
- superseded: `Jev tune: timeoutMs <from>→<to>, your config value replaces the tuned one`

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

### Requirement: Change line channel
Change lines SHALL go through `ctx.ui.notify` only when `ctx.hasUI`, and only after `tuning.json` was written. When the write is refused, no line MUST be shown. A line MUST NOT be added to the session or sent to the model, and in print and JSON modes nothing MUST be printed.

#### Scenario: RPC notify
- **WHEN** a settle applies a change in RPC mode
- **THEN** one `notify` request of type `info` carries the line, and no message is added to the session

#### Scenario: Refused write
- **WHEN** the step returns an `applied` event and the update of `tuning.json` is refused
- **THEN** no tuning line is shown

#### Scenario: Print mode
- **WHEN** a settle applies a change in print mode
- **THEN** `tuning.json` holds the change and the output contains no `Jev tune` text

### Requirement: Seen marker
The package SHALL record in `seenAt` the time up to which the operator was shown tuning changes. A history entry is unseen when `seenAt` is absent or below the entry's `at`. An update MUST NOT lower a stored `seenAt`. With `ctx.hasUI`, a settle with at least one visible event MUST set `seenAt` to the current time, in the same update, before the line is shown. If the notification then fails, that line is lost, but the history keeps the change. A settle without a UI MUST NOT change `seenAt`.

#### Scenario: Line shown
- **WHEN** a settle with a UI applies a change at time 5000
- **THEN** `tuning.json` holds `seenAt` 5000

#### Scenario: No UI
- **WHEN** a settle in print mode applies a change and `tuning.json` had no `seenAt`
- **THEN** `tuning.json` has no `seenAt`

### Requirement: Session start line
At the start of a main session with a UI, when `tuning.json` has unseen history entries, the package SHALL first set `seenAt` to the `at` of the latest unseen entry. Only after that write succeeds, it SHALL show one info notification `Jev tune since your last session: timeoutMs <from>→<to> (<n> change|changes) · /jev tune`. `<from>` is the `from` of the earliest unseen entry, `<to>` the `to` of the latest, and `<n>` their count, with `change` when `n` is 1. `<from>` and `<to>` MAY be equal.

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

### Requirement: Session start line skipped
At session start, nothing MUST be shown or written when there is no unseen entry, no UI, a missing, malformed or unreadable `tuning.json`, a refused write of `seenAt`, or a worker session.

#### Scenario: Everything seen
- **WHEN** `seenAt` equals the latest history entry's `at` and a main session starts
- **THEN** no tuning line is shown and `tuning.json` is unchanged

#### Scenario: No UI at start
- **WHEN** `tuning.json` has an unseen entry and Pi starts in print mode
- **THEN** nothing from tuning is printed and `tuning.json` is unchanged

#### Scenario: Malformed file at start
- **WHEN** `tuning.json` is truncated and a main session starts
- **THEN** no tuning line is shown and `tuning.json` keeps its bytes

#### Scenario: Refused seen write
- **WHEN** `tuning.json` has an unseen entry and the update that sets `seenAt` is refused
- **THEN** no tuning line is shown

#### Scenario: Worker session start
- **WHEN** a child session starts and `tuning.json` has an unseen entry
- **THEN** no tuning line is shown and `tuning.json` is unchanged

### Requirement: Tuning failures stay inside the package
Any error while reading, stepping, writing or notifying for tuning MUST be caught inside the package. It MUST NOT change the run's outcome, the ledger line already written, the status line or the thinking level, and MUST NOT propagate to Pi.

#### Scenario: Throwing ledger read
- **WHEN** reading the ledger throws during a settle
- **THEN** the handler returns normally, `tuning.json` is unchanged and no tuning line is shown

#### Scenario: Throwing notify
- **WHEN** `ctx.ui.notify` throws while a change line is shown
- **THEN** the handler returns normally and `tuning.json` holds the change

# tune-command Specification

## Purpose
The `/jev tune` command: the tuning report with its state lines, history and signals, and the `undo`, `reset`, `on` and `off` subcommands with their refusals.

## Requirements
### Requirement: Tune command forms
`/jev tune` SHALL accept no further word, or exactly one of `undo`, `reset`, `on` and `off`. Any other word, more than one word, or a different case MUST produce the `/jev` usage text as a warning and change nothing. No form SHALL call Jev or any network service, and no form MUST write `config.json`, `state.json` or the ledger. Output follows the `/jev` output channel: `ctx.ui.notify` only when `ctx.hasUI`, nothing printed in print or JSON mode, and a requested change still applied there.

#### Scenario: Unknown subcommand
- **WHEN** the operator runs `/jev tune apply`, `/jev tune Undo` or `/jev tune undo now`
- **THEN** usage text is reported as a warning and `tuning.json` is unchanged

#### Scenario: Other files untouched
- **WHEN** `config.json` and `state.json` exist and the operator runs `/jev tune off`
- **THEN** both files have the same bytes as before

### Requirement: Tune report
`/jev tune` SHALL report, as one info notification that writes nothing, in order: `tuning: on|off`; `timeoutMs: <value> (tuned from <base>)` while a tuned value applies, else `timeoutMs: <untuned> (not tuned)`; the `turnFloor:` line; the state lines, timeout first, then floors; then the history, the signals, the turn signals, and last any problems.

#### Scenario: Not tuned
- **WHEN** no `tuning.json` exists, the ledger is empty and the operator runs `/jev tune`
- **THEN** the report reads `tuning: on`, `timeoutMs: 1500 (not tuned)`, `turnFloor: medium 40 · long 100 · very_long 200`, `history: none`, `signals: no decisions yet`, and the three turn signal lines `no runs yet`

#### Scenario: Pending change
- **WHEN** `tuning.json` holds value 1700 with base 1500, a pending change from 1500 to 1700 at time 1000, a `rule` entry at 1000, and 12 decisions follow it
- **THEN** the report contains `timeoutMs: 1700 (tuned from 1500)`, `pending: 1500→1700, 12/40 decisions since` and one history line with `rule 1500→1700`

#### Scenario: Active block
- **WHEN** `tuning.json` holds a block at 1700 at time 1000 and 50 decisions follow it
- **THEN** the report contains `block: raises to 1700 or above held back for 150 more decisions`

#### Scenario: Config edited
- **WHEN** `tuning.json` holds value 1700 with base 1500 and the config sets `classifier.timeoutMs` to 2000
- **THEN** the report contains `timeoutMs: 2000 (not tuned)`

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

### Requirement: Tune report history
The tune report SHALL show `history:` followed by the latest five history entries, newest first, each as `  <UTC time to the minute, ISO 8601> <cause> <from>→<to>` for `timeoutMs` and `  <UTC time to the minute, ISO 8601> <cause> turnFloor.<band> <from>→<to>` for a band floor, or `history: none` when there is none.

#### Scenario: History newest first
- **WHEN** history holds a `rule` entry at `2026-11-07T10:00:00Z` (1500 to 1700) and an `undo` entry at `2026-11-07T11:30:00Z` (1700 to 1500)
- **THEN** the report lists `  2026-11-07T11:30Z undo 1700→1500` before `  2026-11-07T10:00Z rule 1500→1700`

#### Scenario: Only five shown
- **WHEN** history holds seven entries
- **THEN** the report lists the latest five

#### Scenario: Floor entry named
- **WHEN** history holds a `rule` entry for `turnFloor.long` at `2026-11-30T09:00:00Z` from 100 to 80
- **THEN** the report lists `  2026-11-30T09:00Z rule turnFloor.long 100→80`

### Requirement: Tune report signals
After the history, the tune report SHALL show `signals (observed, not applied; latest 200 decisions per mode):` followed by one line per mode with decisions, `  <mode>: lowWorkerErrors <c>/<n> · corrected <c>/<n> · largeAtLow <c>/<n> · highSmall <c>/<n>`, or with `signals: no decisions yet`.

#### Scenario: Signals shown
- **WHEN** the ledger holds `standard` decisions and the operator runs `/jev tune`
- **THEN** the report contains a line starting `  standard: lowWorkerErrors` with the four signals, and no `budget` or `premium` line

#### Scenario: Off shown
- **WHEN** `tuning.json` holds `off` `true`
- **THEN** the report starts with `tuning: off`

### Requirement: Tune report with bad inputs
When the ledger cannot be read, the pending, block, signal and turn signal lines of the tune report MUST be replaced by one `ledger unreadable` line, placed before the history. A missing `tuning.json` SHALL report as not tuned with no history, with the built-in floors. A malformed or unreadable `tuning.json` SHALL report as not tuned, with the built-in floors, and with its problems last under `problems:`, each as `  tuning (<kind>) <path or (file)>: <message>`, the format of `/jev`.

#### Scenario: Unreadable ledger
- **WHEN** the ledger file has mode `0000` and the operator runs `/jev tune`
- **THEN** the report contains `ledger unreadable` and no signal line (skipped when the test runs as root)

#### Scenario: Unreadable tuning file in the report
- **WHEN** `tuning.json` has mode `0000` and the operator runs `/jev tune`
- **THEN** the report shows `timeoutMs: 1500 (not tuned)` and lists a problem naming `EACCES` (skipped when the test runs as root)

#### Scenario: Invalid config in the report
- **WHEN** `config.json` is invalid, `tuning.json` holds value 1700 with base 1500 and the `long` floor 80 with base 100 and a pending change from 100 to 80, and the operator runs `/jev tune`
- **THEN** the report contains `timeoutMs: 1500 (not tuned)`, `turnFloor: medium 40 · long 100 · very_long 200`, `tuning paused: config error` and `pending turnFloor.long: 100→80`

#### Scenario: Pending count capped
- **WHEN** tuning is off, a change is pending and 55 decisions follow it
- **THEN** the report contains `40/40 decisions since`

#### Scenario: Malformed tuning file
- **WHEN** `tuning.json` is truncated and the operator runs `/jev tune`
- **THEN** the report shows `timeoutMs: 1500 (not tuned)` and `turnFloor: medium 40 · long 100 · very_long 200`, lists a problem under `problems:`, and `tuning.json` is unchanged

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

### Requirement: Tune reset
`/jev tune reset` SHALL apply the reset transition with the untuned `timeoutMs` and report `Jev tune: back to your settings (timeoutMs <untuned>, turn floors 40/100/200).` With `ctx.hasUI`, the same update SHALL set `seenAt` to the current time. When the record has no tuned value, pending change, block or band floor state for any parameter, it MUST write nothing. While `config.json` is invalid, it MUST refuse with an error that names the config problem, and change nothing.

#### Scenario: Reset after changes
- **WHEN** `tuning.json` holds value 1900 with base 1500, a pending change and a block, with `off` set, and the operator runs `/jev tune reset`
- **THEN** `tuning.json` has no tuned value, no pending change and no block, `off` is still set, history ends with `reset` from 1900 to 1500, and the report is `Jev tune: back to your settings (timeoutMs 1500, turn floors 40/100/200).`

#### Scenario: Reset with nothing tuned
- **WHEN** no `tuning.json` exists and the operator runs `/jev tune reset`
- **THEN** the report is `Jev tune: back to your settings (timeoutMs 1500, turn floors 40/100/200).` and `tuning.json` is not created

#### Scenario: Invalid config
- **WHEN** `config.json` is invalid and the operator runs `/jev tune reset` or `/jev tune undo`
- **THEN** an error is reported and `tuning.json` is unchanged

#### Scenario: Reset only a floor block
- **WHEN** `tuning.json` holds only a `long` state with `changedAt` 1000 and a block at 80, and the operator runs `/jev tune reset`
- **THEN** `tuning.json` has no `turnFloors` and no new history entry

### Requirement: Tune on and off
`/jev tune off` SHALL set the off flag and report `Jev tune: off. A tuned value stays until /jev tune undo or reset.` `/jev tune on` SHALL clear it and report `Jev tune: on.` Neither MUST change anything else in `tuning.json`. A switch set this way MUST still apply after Pi restarts.

#### Scenario: Off stops tuning
- **WHEN** the operator runs `/jev tune off` and a main run then settles with a ledger that would make the rule fire
- **THEN** `tuning.json` holds `off` `true`, no tuned value is added and no tuning line is shown

#### Scenario: Off keeps the tuned value
- **WHEN** `tuning.json` holds value 1700 with base 1500 and the operator runs `/jev tune off`
- **THEN** `tuning.json` still holds value 1700 with base 1500 and its history is unchanged

#### Scenario: On again
- **WHEN** `off` is set and the operator runs `/jev tune on`
- **THEN** `tuning.json` holds `off` `false` and the report is `Jev tune: on.`

#### Scenario: Off survives a restart
- **WHEN** the operator runs `/jev tune off`, Pi exits, a new Pi process starts with the same agent directory, and `/jev tune` runs
- **THEN** the report starts with `tuning: off`

### Requirement: Refused tune changes
When the tuning store refuses a change (an unreadable `tuning.json`, or a write error), the subcommand SHALL report only the problem, as an error, and MUST NOT report the change as applied.

#### Scenario: Unreadable tuning file
- **WHEN** `tuning.json` has mode `0000` and the operator runs `/jev tune off`
- **THEN** an error naming `EACCES` is reported, `tuning.json` is unchanged, and no `tuning.json.bad` exists (skipped when the test runs as root)

#### Scenario: Malformed file recovered by a change
- **WHEN** `tuning.json` is malformed and the operator runs `/jev tune off`
- **THEN** the old bytes move to `tuning.json.bad`, and `tuning.json` holds only `version` and `off` `true`

### Requirement: Tune report floors
Right after the `timeoutMs` line, the tune report SHALL show `turnFloor: medium <v> · long <v> · very_long <v>` with the effective floors, each followed by ` (tuned from <base>)` while a tuned floor applies.

#### Scenario: Floors not tuned
- **WHEN** no `tuning.json` exists and the operator runs `/jev tune`
- **THEN** the report contains `turnFloor: medium 40 · long 100 · very_long 200`

### Requirement: Tune report floor state lines
After the timeout state lines, the tune report SHALL show, from the record even while the config is invalid, per band in order and only when it holds, `pending turnFloor.<band>: <from>→<to>, <n>/200 runs since`, with `<n>` capped at 200, and `block turnFloor.<band>: <value> held back for <k> more runs`, where `<k>` is 400 minus the counted runs since the block.

#### Scenario: Floor tuned and pending
- **WHEN** `tuning.json` holds the `long` floor 80 with base 100 and a pending change from 100 to 80 at time 1000, and 37 counted `long` runs follow it
- **THEN** the report contains `turnFloor: medium 40 · long 80 (tuned from 100) · very_long 200` and `pending turnFloor.long: 100→80, 37/200 runs since`

#### Scenario: Floor block
- **WHEN** `tuning.json` holds a `long` block at 80 at time 1000 and 50 counted `long` runs follow it
- **THEN** the report contains `block turnFloor.long: 80 held back for 350 more runs`

### Requirement: Tune report turn signals
After the mode signals, the tune report SHALL show `turn signals (observed; latest 200 runs per band):` followed by one line per band, `  <band>: runs <n> · p90 <v> · p95 <v> · exhausted <c> · warned <c> · used/floor <r> · suggest <v>`. `<r>` has two decimals, or is `-` when absent. The suggestion part SHALL read `needs 200 runs` when no floor is suggested. A band with no run SHALL show `  <band>: no runs yet`. When the ledger cannot be read, no turn signal line MUST be shown.

#### Scenario: Turn signals shown
- **WHEN** the ledger holds 200 counted `long` runs with p90 50, p95 60, 4 `exhausted`, 9 `warned` and a mean used/floor of 0.62, and no `medium` or `very_long` run
- **THEN** the report contains `  long: runs 200 · p90 50 · p95 60 · exhausted 4 · warned 9 · used/floor 0.62 · suggest 80`, `  medium: no runs yet` and `  very_long: no runs yet`

#### Scenario: Not enough runs
- **WHEN** the ledger holds 120 counted `long` runs, none with `turnFloor`
- **THEN** the `long` line ends with `used/floor - · needs 200 runs`

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
`/jev tune` SHALL report, as one info notification that writes nothing, in order: `tuning: on|off`; `timeoutMs: <value> (tuned from <base>)` while a tuned value applies, else `timeoutMs: <untuned> (not tuned)`; the state lines; then the history, the signals, and last any problems.

#### Scenario: Not tuned
- **WHEN** no `tuning.json` exists, the ledger is empty and the operator runs `/jev tune`
- **THEN** the report reads `tuning: on`, `timeoutMs: 1500 (not tuned)`, `history: none` and `signals: no decisions yet`

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
After the `timeoutMs` line, the tune report SHALL show, from the record even while the config is invalid, each only when it holds: `tuning paused: config error` while the config is invalid; `pending: <from>→<to>, <n>/40 decisions since`, with `<n>` capped at 40; and `block: raises to <value> or above held back for <k> more decisions` while a block is active.

#### Scenario: Neither pending nor blocked
- **WHEN** `tuning.json` holds only `timeoutMs` value 1700 with base 1500
- **THEN** the report has no `pending:`, `block:` or `tuning paused` line

### Requirement: Tune report history
The tune report SHALL show `history:` followed by the latest five history entries, newest first, each as `  <UTC time to the minute, ISO 8601> <cause> <from>→<to>`, or `history: none` when there is none.

#### Scenario: History newest first
- **WHEN** history holds a `rule` entry at `2026-11-07T10:00:00Z` (1500 to 1700) and an `undo` entry at `2026-11-07T11:30:00Z` (1700 to 1500)
- **THEN** the report lists `  2026-11-07T11:30Z undo 1700→1500` before `  2026-11-07T10:00Z rule 1500→1700`

#### Scenario: Only five shown
- **WHEN** history holds seven entries
- **THEN** the report lists the latest five

### Requirement: Tune report signals
After the history, the tune report SHALL show `signals (observed, not applied; latest 200 decisions per mode):` followed by one line per mode with decisions, `  <mode>: lowWorkerErrors <c>/<n> · corrected <c>/<n> · largeAtLow <c>/<n> · highSmall <c>/<n>`, or with `signals: no decisions yet`.

#### Scenario: Signals shown
- **WHEN** the ledger holds `standard` decisions and the operator runs `/jev tune`
- **THEN** the report contains a line starting `  standard: lowWorkerErrors` with the four signals, and no `budget` or `premium` line

#### Scenario: Off shown
- **WHEN** `tuning.json` holds `off` `true`
- **THEN** the report starts with `tuning: off`

### Requirement: Tune report with bad inputs
When the ledger cannot be read, the pending, block and signal lines of the tune report MUST be replaced by one `ledger unreadable` line, placed before the history. A missing `tuning.json` SHALL report as not tuned with no history. A malformed or unreadable `tuning.json` SHALL report as not tuned, with its problems last under `problems:`, each as `  tuning (<kind>) <path or (file)>: <message>`, the format of `/jev`.

#### Scenario: Unreadable ledger
- **WHEN** the ledger file has mode `0000` and the operator runs `/jev tune`
- **THEN** the report contains `ledger unreadable` and no signal line (skipped when the test runs as root)

#### Scenario: Unreadable tuning file in the report
- **WHEN** `tuning.json` has mode `0000` and the operator runs `/jev tune`
- **THEN** the report shows `timeoutMs: 1500 (not tuned)` and lists a problem naming `EACCES` (skipped when the test runs as root)

#### Scenario: Invalid config in the report
- **WHEN** `config.json` is invalid, `tuning.json` holds value 1700 with base 1500, and the operator runs `/jev tune`
- **THEN** the report contains `timeoutMs: 1500 (not tuned)` and `tuning paused: config error`

#### Scenario: Pending count capped
- **WHEN** tuning is off, a change is pending and 55 decisions follow it
- **THEN** the report contains `40/40 decisions since`

#### Scenario: Malformed tuning file
- **WHEN** `tuning.json` is truncated and the operator runs `/jev tune`
- **THEN** the report shows `timeoutMs: 1500 (not tuned)` and lists a problem under `problems:`, and `tuning.json` is unchanged

### Requirement: Tune undo
`/jev tune undo` SHALL apply the undo transition to `tuning.json` and report `Jev tune: timeoutMs <from>→<to> undone. The same raise is held back for 200 decisions.` With `ctx.hasUI`, the same update SHALL set `seenAt` to the current time. With nothing tuned, or a tuned value whose base no longer equals the untuned value, it SHALL report `Jev tune: nothing to undo.` and write nothing. While `config.json` is invalid, it MUST refuse with an error and change nothing.

#### Scenario: Undo a change
- **WHEN** `tuning.json` holds value 1700 with base 1500 and a `rule` entry from 1500 to 1700, and the operator runs `/jev tune undo`
- **THEN** `tuning.json` has no tuned value, a block at 1700, an `undo` history entry and `seenAt` equal to the current time, and the report is `Jev tune: timeoutMs 1700→1500 undone. The same raise is held back for 200 decisions.`

#### Scenario: Nothing to undo
- **WHEN** nothing is tuned and the operator runs `/jev tune undo`
- **THEN** the report is `Jev tune: nothing to undo.` and `tuning.json` is not created

#### Scenario: Stale tuned value
- **WHEN** `tuning.json` holds value 1700 with base 1500, the config sets `classifier.timeoutMs` to 2000, and the operator runs `/jev tune undo`
- **THEN** the report is `Jev tune: nothing to undo.` and `tuning.json` is unchanged

#### Scenario: Undo without a UI
- **WHEN** `tuning.json` holds value 1700 with base 1500, a `rule` entry from 1500 to 1700, and no `seenAt`, and Pi runs `/jev tune undo` with `-p`
- **THEN** `tuning.json` has no tuned value and still has no `seenAt`, and stdout holds nothing from the package

### Requirement: Tune reset
`/jev tune reset` SHALL apply the reset transition with the untuned `timeoutMs` and report `Jev tune: back to your settings (timeoutMs <untuned>).` With `ctx.hasUI`, the same update SHALL set `seenAt` to the current time. When the record has no tuned value, no pending change and no block, it MUST write nothing. While `config.json` is invalid, it MUST refuse with an error that names the config problem, and change nothing.

#### Scenario: Reset after changes
- **WHEN** `tuning.json` holds value 1900 with base 1500, a pending change and a block, with `off` set, and the operator runs `/jev tune reset`
- **THEN** `tuning.json` has no tuned value, no pending change and no block, `off` is still set, history ends with `reset` from 1900 to 1500, and the report is `Jev tune: back to your settings (timeoutMs 1500).`

#### Scenario: Reset with nothing tuned
- **WHEN** no `tuning.json` exists and the operator runs `/jev tune reset`
- **THEN** the report is `Jev tune: back to your settings (timeoutMs 1500).` and `tuning.json` is not created

#### Scenario: Invalid config
- **WHEN** `config.json` is invalid and the operator runs `/jev tune reset` or `/jev tune undo`
- **THEN** an error is reported and `tuning.json` is unchanged

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

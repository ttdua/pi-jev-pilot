# tuning-file Specification

## Purpose
`tuning.json` holds the tuned `timeoutMs` with its base, the change under evaluation, the block, the off flag and a bounded history, written atomically, read as nothing tuned when missing or malformed, and never discarded when it cannot be read.

## Requirements

### Requirement: Tuning file content
`tuning.json` in the jev directory SHALL hold `version` `1` and the optional fields `off`, `timeoutMs`, `pending`, `block`, `history` and `seenAt`. Within each object every key is required: `timeoutMs` has `value` and `base`; `pending` has `from`, `to`, `at` and `before` (`asked`, `timeouts`); `block` has `value` and `at`; each history entry has `at`, `parameter`, `from`, `to` and `cause`. Any other key MUST be rejected. Problem paths SHALL use the existing validator format, such as `history[3].cause`.

#### Scenario: Valid file read
- **WHEN** `tuning.json` holds `{"version":1,"timeoutMs":{"value":1700,"base":1500},"pending":{"from":1500,"to":1700,"at":1000,"before":{"asked":40,"timeouts":8}},"history":[{"at":1000,"parameter":"timeoutMs","from":1500,"to":1700,"cause":"rule"}]}`
- **THEN** the read returns those values

#### Scenario: Seen marker read
- **WHEN** `tuning.json` holds `{"version":1,"seenAt":1000}`
- **THEN** the read is ok and returns `seenAt` 1000

#### Scenario: Other parameter rejected
- **WHEN** `tuning.json` has a `riskFloor` key
- **THEN** the read is malformed with a problem at `riskFloor`

#### Scenario: Missing inner key
- **WHEN** `timeoutMs` has `value` but no `base`
- **THEN** the read is malformed with a problem at `timeoutMs.base`

### Requirement: Tuning file values
Every timeout value (`value`, `base`, `from`, `to`) SHALL be an integer from 300 to 5000, and every `at` and `seenAt` an integer from 0 to 8640000000000000. `before.asked` and `before.timeouts` SHALL be integers from 0 to 40, with `timeouts` at most `asked`. `parameter` SHALL be `timeoutMs`, and `cause` one of `rule`, `revert`, `undo`, `reset` or `superseded`. `history` MUST hold at most 50 entries.

#### Scenario: Out of range
- **WHEN** `timeoutMs.value` is `9000`
- **THEN** the read is malformed with a problem at `timeoutMs.value`

#### Scenario: Bad seen marker
- **WHEN** `seenAt` is `-1` or `1.5`
- **THEN** the read is malformed with a problem at `seenAt`

#### Scenario: Too much history
- **WHEN** `history` has 51 entries
- **THEN** the read is malformed with a problem at `history`

#### Scenario: Unknown cause
- **WHEN** the entry at index 3 of `history` has `cause` `manual`
- **THEN** the read is malformed with a problem at `history[3].cause`

#### Scenario: More timeouts than asked
- **WHEN** `pending.before` is `{"asked":10,"timeouts":11}`
- **THEN** the read is malformed with a problem at `pending.before.timeouts`

### Requirement: Missing tuning means nothing tuned
A missing `tuning.json` SHALL read as missing, with an empty record, and MUST NOT be reported as a problem.

#### Scenario: No file
- **WHEN** the jev directory has no `tuning.json`
- **THEN** the read is missing, with no tuned value, no pending change, no block, no history and `off` unset

### Requirement: Malformed tuning falls back to nothing tuned
A `tuning.json` that is not valid JSON, is not an object, has a `version` other than `1`, has an unknown key or has a wrong value SHALL read as malformed. The read carries an empty record and the list of problems. No field MUST be salvaged. A malformed file MUST NOT make the package inert. Problem messages MUST NOT include the value found.

#### Scenario: Bad JSON
- **WHEN** `tuning.json` is truncated
- **THEN** the read is malformed with a problem at `""` and an empty record

#### Scenario: Partly valid file is not salvaged
- **WHEN** `tuning.json` has a valid `timeoutMs` and an invalid `history`
- **THEN** the read is malformed and no tuned value is returned

#### Scenario: Value not echoed
- **WHEN** `timeoutMs.base` is the string `"secret-123"`
- **THEN** no problem message contains `secret-123`

### Requirement: Unreadable tuning is not discarded
A `tuning.json` that exists but cannot be read SHALL read as unreadable. The read carries an empty record and a problem at `""` naming the error code. An update MUST then refuse with that problem, without renaming or replacing the file.

#### Scenario: Permission denied
- **WHEN** `tuning.json` has mode `0000` and an update runs
- **THEN** the read is unreadable naming `EACCES`, the update returns that problem, the file is not replaced, and no `tuning.json.bad` is created

### Requirement: Tuning updates are atomic and recover a bad file
Updating the tuning SHALL read the file, apply a change function, validate the result and write it atomically (directory `0700`, file `0600`), creating a missing file. A malformed file MUST first move to `tuning.json.bad` (mode `0600`, replacing any older one), and the update starts from an empty record. An invalid result or a throwing change function MUST be refused with the file unchanged. `config.json` and `state.json` MUST NOT be touched.

#### Scenario: Change persists
- **WHEN** no `tuning.json` exists and an update sets the tuned value to 1700 with base 1500
- **THEN** a new read returns that value, the file has mode `0600`, and a newly created jev directory has mode `0700`

#### Scenario: Bad file moved aside
- **WHEN** `tuning.json` is malformed and an update sets `off`
- **THEN** the old bytes are in `tuning.json.bad` with mode `0600`, and `tuning.json` holds only `version` and `off`

#### Scenario: Invalid update refused
- **WHEN** an update sets the tuned value to 9000
- **THEN** the update returns a problem at `timeoutMs.value` and `tuning.json` is unchanged

#### Scenario: Throwing change refused
- **WHEN** the change function throws
- **THEN** the update returns a problem at `""` and `tuning.json` is unchanged

#### Scenario: Other files untouched
- **WHEN** `config.json` and `state.json` exist and an update runs
- **THEN** both files have the same bytes and modification times as before

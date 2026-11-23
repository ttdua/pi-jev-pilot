## MODIFIED Requirements

### Requirement: Tuning file content
<!-- Intentional change: "Other parameter rejected" now uses a `version` 2 file; "Floor state read", "Floors in a version 1 file", "Floor history in a version 1 file", "Written as version 2" and "Kept at version 1" are added. -->
`tuning.json` in the jev directory SHALL hold `version` `1` or `2` and the optional fields `off`, `timeoutMs`, `pending`, `block`, `history` and `seenAt`, and, in `version` `2` only, `turnFloors` and history entries of band floors. Within each object every key is required: `timeoutMs` has `value` and `base`; `pending` has `from`, `to`, `at` and `before` (`asked`, `timeouts`); `block` has `value` and `at`; each history entry has `at`, `parameter`, `from`, `to` and `cause`. `turnFloors` MAY hold `medium`, `long` and `very_long`, each an object with the required key `changedAt` and the optional keys `tuned` (`value`, `base`), `pending` (`from`, `to`, `at`, `before` with `runs` and `exhausted`) and `block` (`value`, `at`), each inner object with all its keys required. Any other key MUST be rejected. Problem paths SHALL use the existing validator format, such as `history[3].cause` or `turnFloors.long.tuned.value`. A band state holding only `changedAt` SHALL be kept. A write SHALL emit `version` `2` when the record holds `turnFloors` or a band floor history entry, and `version` `1` otherwise, so an older package keeps reading a file with no floor data.

#### Scenario: Valid file read
- **WHEN** `tuning.json` holds `{"version":1,"timeoutMs":{"value":1700,"base":1500},"pending":{"from":1500,"to":1700,"at":1000,"before":{"asked":40,"timeouts":8}},"history":[{"at":1000,"parameter":"timeoutMs","from":1500,"to":1700,"cause":"rule"}]}`
- **THEN** the read returns those values

#### Scenario: Seen marker read
- **WHEN** `tuning.json` holds `{"version":1,"seenAt":1000}`
- **THEN** the read is ok and returns `seenAt` 1000

#### Scenario: Other parameter rejected
- **WHEN** a `version` 2 `tuning.json` has a `riskFloor` key
- **THEN** the read is malformed with a problem at `riskFloor`

#### Scenario: Missing inner key
- **WHEN** `timeoutMs` has `value` but no `base`
- **THEN** the read is malformed with a problem at `timeoutMs.base`

#### Scenario: Floor state read
- **WHEN** `tuning.json` holds `{"version":2,"turnFloors":{"long":{"changedAt":1000,"tuned":{"value":80,"base":100},"pending":{"from":100,"to":80,"at":1000,"before":{"runs":200,"exhausted":3}}}},"history":[{"at":1000,"parameter":"turnFloor.long","from":100,"to":80,"cause":"rule"}]}`
- **THEN** the read returns those values

#### Scenario: Floors in a version 1 file
- **WHEN** a `version` 1 `tuning.json` has a `turnFloors` key
- **THEN** the read is malformed with a problem at `turnFloors`

#### Scenario: Floor history in a version 1 file
- **WHEN** a `version` 1 `tuning.json` has a history entry with `parameter` `turnFloor.long`
- **THEN** the read is malformed with a problem at `history[0].parameter`

#### Scenario: Written as version 2
- **WHEN** a `version` 1 `tuning.json` holds a tuned `timeoutMs` and an update sets the `long` floor to 80 with base 100
- **THEN** the file holds `version` 2, the same `timeoutMs` and the `long` floor

#### Scenario: Kept at version 1
- **WHEN** a `version` 1 `tuning.json` holds a tuned `timeoutMs` and an update sets `off`
- **THEN** the file holds `version` 1, the same `timeoutMs` and `off` `true`

### Requirement: Tuning file values
Every timeout value (`timeoutMs.value` and `base`, `pending.from` and `to`, `block.value`) SHALL be an integer from 300 to 5000, and every `at` and `seenAt` an integer from 0 to 8640000000000000. `before.asked` and `before.timeouts` SHALL be integers from 0 to 40, with `timeouts` at most `asked`. Every floor value of a band (`tuned.value` and `base`, `pending.from` and `to`, `block.value`) SHALL be an integer in that band's range: `medium` 20–80, `long` 50–200, `very_long` 100–400. A floor `before.runs` SHALL be an integer from 0 to 200 and `before.exhausted` one from 0 to `runs`. `changedAt` SHALL be an integer from 0 to 8640000000000000. `parameter` SHALL be `timeoutMs`, `turnFloor.medium`, `turnFloor.long` or `turnFloor.very_long`, and an entry's `from` and `to` SHALL be in the range of its parameter. `cause` SHALL be one of `rule`, `revert`, `undo`, `reset` or `superseded`. `history` MUST hold at most 50 entries.

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

#### Scenario: Floor out of its band range
- **WHEN** `turnFloors.medium.tuned.value` is `100`
- **THEN** the read is malformed with a problem at `turnFloors.medium.tuned.value`

#### Scenario: History value out of its parameter range
- **WHEN** the entry at index 0 of `history` has `parameter` `turnFloor.long` and `to` `1500`
- **THEN** the read is malformed with a problem at `history[0].to`

#### Scenario: More exhausted than runs
- **WHEN** `turnFloors.long.pending.before` is `{"runs":10,"exhausted":11}`
- **THEN** the read is malformed with a problem at `turnFloors.long.pending.before.exhausted`

### Requirement: Malformed tuning falls back to nothing tuned
A `tuning.json` that is not valid JSON, is not an object, has a `version` other than `1` or `2`, has an unknown key or has a wrong value SHALL read as malformed. The read carries an empty record and the list of problems. No field MUST be salvaged. A malformed file MUST NOT make the package inert. Problem messages MUST NOT include the value found.

#### Scenario: Bad JSON
- **WHEN** `tuning.json` is truncated
- **THEN** the read is malformed with a problem at `""` and an empty record

#### Scenario: Partly valid file is not salvaged
- **WHEN** `tuning.json` has a valid `timeoutMs` and an invalid `history`
- **THEN** the read is malformed and no tuned value is returned

#### Scenario: Value not echoed
- **WHEN** `timeoutMs.base` is the string `"secret-123"`
- **THEN** no problem message contains `secret-123`

#### Scenario: Unknown version
- **WHEN** `tuning.json` holds `{"version":3}`
- **THEN** the read is malformed with a problem at `version`

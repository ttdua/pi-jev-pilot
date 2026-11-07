## MODIFIED Requirements

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

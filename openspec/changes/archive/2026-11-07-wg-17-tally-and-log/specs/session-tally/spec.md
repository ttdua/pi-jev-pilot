## ADDED Requirements

### Requirement: Tally fed by ledger lines
In a main session, the package SHALL keep a session tally in memory. It SHALL be updated from every `main`, `worker` and `correction` line that the session's main effort and worker routing build and that passes ledger validation, whether or not the ledger write succeeded. A line that fails validation MUST change no count. The tally MUST make no network call and MUST NOT read or write any file.

#### Scenario: Counted although the write failed
- **WHEN** the ledger directory cannot be written and one eligible prompt is answered and settles
- **THEN** the tally counts 1 prompt

#### Scenario: Invalid line ignored
- **WHEN** a worker launch uses an agent named `my agent!` and completes
- **THEN** the tally's worker count is unchanged

#### Scenario: Jev down
- **WHEN** Jev returns HTTP 500 for an eligible prompt and the run settles
- **THEN** the tally counts 1 prompt, as the `main` line with `miss` `error` is written

### Requirement: Tally counts
The tally SHALL hold:
- `prompts`: the number of `main` lines.
- `workers`: the number of `worker` lines, with a count per `model` for lines that carry `model`, and an `unrouted` count for lines without `model`.
- `workerTokens`: the sum of `tokens` over `worker` lines.
- `fallbacks`: see Fallback count.

`correction` lines MUST change no count. The tally MUST NOT hold a price or a tools-flagged count.

#### Scenario: Mixed session
- **WHEN** a session writes three `main` lines, one `worker` line with `model` `fixture/fast` and `tokens` 100, one with `model` `fixture/deep`, `tier` `balanced`, `fallback` `deep` and `tokens` 50, one untouched `worker` line without `model`, and one `correction` line
- **THEN** the tally holds `prompts` 3, `workers` 3 with `fixture/fast` 1, `fixture/deep` 1 and `unrouted` 1, `workerTokens` 150 and `fallbacks` 1

### Requirement: Fallback count
`fallbacks` SHALL count the `worker` lines that carry both `tier` and `fallback`, with `fallback` different from `tier`.

#### Scenario: Nothing could run is not a fallback
- **WHEN** a `worker` line has `tier` `balanced` and `fallback` `balanced` and no `model`
- **THEN** `fallbacks` is unchanged and `unrouted` grows by 1

### Requirement: Tally reset at session start
The tally SHALL be reset to zero counts at every main `session_start`, for every start reason, and SHALL then belong to that session's id. It MUST NOT be rebuilt from the session file or the ledger. A line whose `session` differs from the id of the session the tally belongs to MUST change no count.

#### Scenario: New session
- **WHEN** a session has a tally of 4 prompts and the operator starts a new session
- **THEN** `/jev` in the new session reports 0 prompts

#### Scenario: Resume
- **WHEN** the operator resumes a session that had 4 decided prompts
- **THEN** `/jev` reports 0 prompts until the next decided prompt

#### Scenario: Late worker line from a replaced session
- **WHEN** a worker launched in session A completes after the operator started session B
- **THEN** `/jev` in session B reports `workers 0`

### Requirement: No tally in a child session
A child session MUST keep no tally, and a ledger line whose `session` is a child session id MUST change no count in the main session's tally.

#### Scenario: Child line ignored
- **WHEN** the observer receives a line whose `session` is a child session id
- **THEN** the tally is unchanged

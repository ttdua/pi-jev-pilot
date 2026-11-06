## ADDED Requirements

### Requirement: One main line per decided turn
For every eligible prompt whose Jev request completed (answered or missed), the package SHALL append exactly one `main` ledger line when the run settles, never earlier and never rewritten, unless the run settled aborted with no provider request. A prompt that was not eligible, or whose run was cancelled before any provider request, MUST write no `main` line. A ledger write failure MUST NOT affect the turn.

#### Scenario: Decided turn
- **WHEN** an eligible prompt is answered and its run completes
- **THEN** the ledger holds one new `main` line for it

#### Scenario: Ineligible prompt
- **WHEN** a prompt is submitted with `effort` off
- **THEN** no ledger line is added

#### Scenario: Run fails before any provider request
- **WHEN** an eligible prompt is answered and the run settles not aborted with an error before any provider request
- **THEN** one `main` line is written with `outcome` `error`

#### Scenario: Ledger directory unwritable
- **WHEN** the ledger cannot be written
- **THEN** the turn proceeds and completes normally

### Requirement: Main line fields
A `main` line SHALL carry `v`, `at` (prompt time), `kind`, `session`, `mode` (at the prompt), `answered`, `turnId` and `outcome`, and when known: `ms`, `miss`, `effortP` (all five probabilities), `risky`, `corrects`, `requested`, `effective`, `from` (level before the request), `toolCalls`, `failures`, `inputTokens`, `outputTokens`, `durationMs`. `held`, `advised`, `strategy`, `strategyP`, `skill`, `skillP` and `gate` MUST be absent.

#### Scenario: Required fields
- **WHEN** any `main` line is written
- **THEN** it validates against the ledger schema and carries `v`, `at`, `kind`, `session`, `mode`, `answered`, `turnId` and `outcome`

#### Scenario: Effective is read back from Pi
- **WHEN** the package applies `xhigh` and Pi clamps it to `high`
- **THEN** the line has `requested` `xhigh` and `effective` `high`

### Requirement: Turn outcome
`outcome` SHALL be `aborted` when the run settled aborted, `error` when its last assistant message ended with an error stop reason, and `ok` otherwise. `toolCalls` and `failures` SHALL count the tool results of the run and those that are errors; `inputTokens` and `outputTokens` SHALL sum the assistant messages' usage.

#### Scenario: Applied decision
- **WHEN** the level was `low`, Jev answered `effort` `high` with `risky` 0.1 and `corrects` 0.05, and the run completed with two tool calls, one failed
- **THEN** the line has `answered` true, `from` `low`, `requested` `high`, `effective` `high`, `effortP` with five keys, `risky` 0.1, `corrects` 0.05, `toolCalls` 2, `failures` 1 and `outcome` `ok`

#### Scenario: Miss
- **WHEN** the Jev request timed out
- **THEN** the line has `answered` false, `miss` `timeout`, `from`, and no `requested`, `effective` or `effortP`

#### Scenario: Discarded
- **WHEN** the result was discarded on a manual change
- **THEN** the line has `requested` and `effortP` and no `effective`

#### Scenario: Aborted after the request
- **WHEN** the operator aborts after the first provider request
- **THEN** the line has `outcome` `aborted`

### Requirement: Turn id recorded on the branch
After writing a `main` line, the package SHALL record its `turnId` as a session custom entry of type `jev-turn` holding only `{ turnId }`. The entry MUST NOT be sent to the model.

#### Scenario: Entry after a decided turn
- **WHEN** a decided turn settles
- **THEN** the session holds one new custom entry `jev-turn` whose data is exactly `{ turnId }` equal to the line's `turnId`

### Requirement: Correction lines
When `corrects` is answered with a value of at least 0.7 and the current branch holds an earlier `jev-turn` entry, the package SHALL append one `correction` line with that entry's `turnId` (the newest on the branch, looked up when the prompt is classified) and the `corrects` value, when the run settles and just before its `main` line. A run cancelled before any provider request MUST write no `correction` line. Without such an entry, no `correction` line MUST be written.

#### Scenario: Correction of the previous turn
- **WHEN** a first prompt was decided with `turnId` T1 and the second prompt is answered with `corrects` 0.9
- **THEN** a `correction` line with `turnId` T1 and `corrects` 0.9 is appended, it validates against the ledger schema, and its `session` equals the `main` lines' `session`

#### Scenario: Correction in a cancelled turn
- **WHEN** the second prompt is answered with `corrects` 0.9 and the operator aborts before any provider request
- **THEN** no `correction` line is written

#### Scenario: Boundary
- **WHEN** `corrects` is 0.69
- **THEN** no `correction` line is written

#### Scenario: First prompt of a session
- **WHEN** the first prompt is answered with `corrects` 0.95
- **THEN** no `correction` line is written

#### Scenario: Other branch
- **WHEN** turns T1 and T2 were decided, the operator moved with `/tree` to the `jev-turn` entry of T1 (before T2's user message), and the next prompt is answered with `corrects` 0.8
- **THEN** the `correction` line names T1

#### Scenario: Branch before any turn entry
- **WHEN** the operator moved with `/tree` to a point before T1's `jev-turn` entry, and the next prompt is answered with `corrects` 0.8
- **THEN** no `correction` line is written

### Requirement: No prompt text in the ledger or entries
No ledger line and no session entry written by the package SHALL contain prompt text, conversation text, tool arguments or tool output.

#### Scenario: Marker absent
- **WHEN** a host run submits a prompt containing `JEV-MARKER-PROMPT` and the run completes
- **THEN** neither the ledger files nor the package's custom entries contain `JEV-MARKER-PROMPT`

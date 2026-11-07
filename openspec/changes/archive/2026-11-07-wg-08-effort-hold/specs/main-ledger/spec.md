## MODIFIED Requirements

### Requirement: Main line fields
A `main` line SHALL carry `v`, `at` (prompt time), `kind`, `session`, `mode` (at the prompt), `answered`, `turnId` and `outcome`, and when known: `ms`, `miss`, `effortP` (all five probabilities), `risky`, `corrects`, `requested`, `effective`, `from` (level before the request), `toolCalls`, `failures`, `inputTokens`, `outputTokens`, `durationMs`. A held turn's line MUST carry `held` `true` and `effective` (the level in force once the Jev request completed), and MUST NOT carry `effortP`, `risky` or `requested`. `held` MUST be absent from any other line. `advised`, `strategy`, `strategyP`, `skill`, `skillP` and `gate` MUST be absent.

#### Scenario: Required fields
- **WHEN** any `main` line is written
- **THEN** it validates against the ledger schema and carries `v`, `at`, `kind`, `session`, `mode`, `answered`, `turnId` and `outcome`

#### Scenario: Effective is read back from Pi
- **WHEN** the package applies `xhigh` and Pi clamps it to `high`
- **THEN** the line has `requested` `xhigh` and `effective` `high`

#### Scenario: Held turn
- **WHEN** a held turn at level `high` is answered with `corrects` 0.1 and completes
- **THEN** the line has `held` `true`, `effective` `high`, `from` `high`, `corrects` 0.1, and no `effortP`, `risky` or `requested`

#### Scenario: Held turn with a miss
- **WHEN** a held turn's Jev request times out
- **THEN** the line has `held` `true`, `answered` false, `miss` `timeout` and `effective` equal to the level in force

#### Scenario: Decided turn is not held
- **WHEN** a turn on a listed provider is decided with `effort` asked
- **THEN** the line has no `held`

### Requirement: Turn id recorded on the branch
After writing a `main` line, the package SHALL record its `turnId` as a session custom entry of type `jev-turn`. The entry data MUST be exactly `{ turnId }`, or `{ turnId, decided }` for a turn that anchors a hold as `effort-hold` defines. The entry MUST NOT be sent to the model.

#### Scenario: Entry after a decided turn
- **WHEN** a decided turn with no effective level (its Jev request missed) settles
- **THEN** the session holds one new custom entry `jev-turn` whose data is exactly `{ turnId }` equal to the line's `turnId`

#### Scenario: Entry after an applied turn
- **WHEN** a turn that applied a level settles
- **THEN** the session holds one new custom entry `jev-turn` whose `turnId` equals the line's `turnId` and whose `decided.level` equals the line's `effective`

#### Scenario: Entry not in the provider request
- **WHEN** a turn with a `decided` entry is followed by another prompt
- **THEN** the next provider request contains neither `jev-turn` nor `decided`

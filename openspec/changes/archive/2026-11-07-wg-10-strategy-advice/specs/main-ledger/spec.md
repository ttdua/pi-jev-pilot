## MODIFIED Requirements

### Requirement: One main line per decided turn
For every eligible prompt whose Jev request completed (answered or missed), the package SHALL append exactly one `main` ledger line when the run settles, never earlier and never rewritten, unless the run settled aborted with no provider request. A prompt that was not eligible, or whose run was cancelled before any provider request, MUST write no `main` line. A turn whose session is replaced before its run settles MUST write no line. A ledger write failure MUST NOT affect the turn.

#### Scenario: Decided turn
- **WHEN** an eligible prompt is answered and its run completes
- **THEN** the ledger holds one new `main` line for it

#### Scenario: Ineligible prompt
- **WHEN** a prompt is submitted with `effort` and `strategy` both off
- **THEN** no ledger line is added

#### Scenario: Strategy only
- **WHEN** a prompt is submitted with `effort` off and `strategy` on, and Jev answers
- **THEN** the ledger holds one new `main` line for it, with no `requested` or `effective`

#### Scenario: Run fails before any provider request
- **WHEN** an eligible prompt is answered and the run settles not aborted with an error before any provider request
- **THEN** one `main` line is written with `outcome` `error`

#### Scenario: Session replaced before the turn settles
- **WHEN** an eligible prompt is answered, the session starts again before its run settles, and the old run then settles
- **THEN** no `main` line, no `correction` line and no `jev-turn` entry are written for that turn

#### Scenario: Ledger directory unwritable
- **WHEN** the ledger cannot be written
- **THEN** the turn proceeds and completes normally

### Requirement: Main line fields
A `main` line SHALL carry `v`, `at` (prompt time), `kind`, `session`, `mode` (at the prompt), `answered`, `turnId` and `outcome`, and when known: `ms`, `miss`, `effortP` (all five probabilities), `risky`, `corrects`, `requested`, `effective`, `from` (level before the request), `strategy` (the chosen strategy), `strategyP` (its probability), `advised` (whether advice was attached), `toolCalls`, `failures`, `inputTokens`, `outputTokens`, `durationMs`. `answered` is true whenever Jev returned a readable response, whatever was asked. `strategy`, `strategyP` and `advised` MUST be present exactly when `strategy` was answered. `held`, `skill`, `skillP` and `gate` MUST be absent. No main `tier` field MUST be written.

#### Scenario: Required fields
- **WHEN** any `main` line is written
- **THEN** it validates against the ledger schema and carries `v`, `at`, `kind`, `session`, `mode`, `answered`, `turnId` and `outcome`

#### Scenario: Effective is read back from Pi
- **WHEN** the package applies `xhigh` and Pi clamps it to `high`
- **THEN** the line has `requested` `xhigh` and `effective` `high`

#### Scenario: Advice attached
- **WHEN** Jev answered `strategy` `delegate` with probability 0.9 and advice was attached
- **THEN** the line has `strategy` `delegate`, `strategyP` 0.9 and `advised` true

#### Scenario: Advice not attached
- **WHEN** Jev answered `strategy` `graph` with probability 0.7 and `tier` `deep`
- **THEN** the line has `strategy` `graph`, `strategyP` 0.7 and `advised` false

#### Scenario: Strategy not asked or unanswered
- **WHEN** `strategy` is off, or the request was a miss, or `strategy` came back with an unknown choice
- **THEN** the line has no `strategy`, `strategyP` or `advised`

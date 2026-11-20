## MODIFIED Requirements

### Requirement: Main line fields
A `main` line SHALL carry `v`, `at` (prompt time), `kind`, `session`, `mode` (at the prompt), `answered`, `turnId` and `outcome`, and when known: `ms`, `miss`, `effortP` (all five probabilities), `risky`, `corrects`, `requested`, `effective`, `from` (level before the request), `strategy` (the chosen strategy), `strategyP` (its probability), `advised` (whether advice was attached), `skill` (the picked skill), `skillP` (the best leader's probability), `gate` (the gate mean), `toolCalls`, `failures`, `inputTokens`, `outputTokens`, `durationMs`. `answered` is true whenever Jev returned a readable main response, whatever was asked. `strategy`, `strategyP` and `advised` MUST be present exactly when `strategy` was answered, held or not. `skill` MUST be present exactly when a skill was picked, in any delivery form; `skillP` and `gate` exactly when the pick result carries them; with no skill questions asked, all three MUST be absent. A held turn's line MUST carry `held` `true` and `effective` (the level in force once the Jev request completed), and MUST NOT carry `effortP`, `risky` or `requested`. `held` MUST be absent from any other line. `effortP`, `risky` and `requested` MUST be written only when the effort result is applied (see `main-effort`); an `effort` answer asked only for the strategy gate MUST NOT be recorded. No main `tier` field MUST be written.

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
- **WHEN** Jev answered `strategy` `graph` with probability 0.7 and `effort` `xhigh`
- **THEN** the line has `strategy` `graph`, `strategyP` 0.7 and `advised` false

#### Scenario: Strategy not asked or unanswered
- **WHEN** `strategy` is off, or the request was a miss, or `strategy` came back with an unknown choice
- **THEN** the line has no `strategy`, `strategyP` or `advised`

#### Scenario: Skill picked
- **WHEN** `debug` is picked at .6 with gate mean .4
- **THEN** the line has `skill` `debug`, `skillP` 0.6 and `gate` 0.4

#### Scenario: Skill picked again as a reference
- **WHEN** `debug` is picked and attached in the `reference` form
- **THEN** the line has `skill` `debug`

#### Scenario: Below the threshold
- **WHEN** the leader is `debug` at .45 and the gate mean is .29
- **THEN** the line has `skillP` 0.45 and `gate` 0.29 and no `skill`

#### Scenario: None leads
- **WHEN** every batch is led by `(none)` and the gate mean is .1
- **THEN** the line has `gate` 0.1 and no `skill` or `skillP`

#### Scenario: Skills not asked
- **WHEN** `skills` is off, or the prompt has an explicit skill, or a skill batch failed
- **THEN** the line has no `skill`, `skillP` or `gate`

#### Scenario: Held turn
- **WHEN** a held turn at level `high`, with `strategy` off and skills not applying, is answered with `corrects` 0.1 and completes
- **THEN** the line has `held` `true`, `effective` `high`, `from` `high`, `corrects` 0.1, and no `effortP`, `risky` or `requested`

#### Scenario: Held turn with advice
- **WHEN** a held turn at level `high`, with `strategy` on, is answered with `effort` `xhigh` and `strategy` `delegate` at probability 0.9
- **THEN** the line has `held` `true`, `effective` `high`, `strategy` `delegate`, `strategyP` 0.9 and `advised` true, and no `effortP`, `risky` or `requested`

#### Scenario: Held turn with a miss
- **WHEN** a held turn's Jev request times out
- **THEN** the line has `held` `true`, `answered` false, `miss` `timeout` and `effective` equal to the level in force

#### Scenario: Gate-only effort not recorded
- **WHEN** `effort` is off, `strategy` is on, and Jev answers `effort` `high` and `strategy` `delegate` at probability 0.9
- **THEN** the line has `strategy` `delegate` and `advised` true, and no `effortP`, `risky` or `requested`

#### Scenario: Decided turn is not held
- **WHEN** a turn on a listed provider is decided with `effort` asked
- **THEN** the line has no `held`


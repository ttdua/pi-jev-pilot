## MODIFIED Requirements

### Requirement: One main line per decided turn
For every eligible prompt whose Jev request completed (answered or missed), the package SHALL append exactly one `main` ledger line when the run settles, never earlier and never rewritten, unless the run settled aborted with no provider request. A prompt that was not eligible, or whose run was cancelled before any provider request, MUST write no `main` line. A turn whose session is replaced before its run settles MUST write no line. A ledger write failure MUST NOT affect the turn.

#### Scenario: Decided turn
- **WHEN** an eligible prompt is answered and its run completes
- **THEN** the ledger holds one new `main` line for it

#### Scenario: Ineligible prompt
- **WHEN** a prompt is submitted with `effort` and `skills` both off
- **THEN** no ledger line is added

#### Scenario: Skills only
- **WHEN** a prompt is submitted with `effort` off and skills applying, and Jev answers
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
A `main` line SHALL carry `v`, `at` (prompt time), `kind`, `session`, `mode` (at the prompt), `answered`, `turnId` and `outcome`, and when known: `ms`, `miss`, `effortP` (all five probabilities), `risky`, `corrects`, `requested`, `effective`, `from` (level before the request), `skill` (the picked skill), `skillP` (the best leader's probability), `gate` (the gate mean), `toolCalls`, `failures`, `inputTokens`, `outputTokens`, `durationMs`. `answered` is true whenever Jev returned a readable main response, whatever was asked. `skill` MUST be present exactly when a skill was picked, in any delivery form; `skillP` and `gate` exactly when the pick result carries them. With no skill questions asked, all three MUST be absent. A held turn's line MUST carry `held` `true` and `effective` (the level in force once the Jev request completed), and MUST NOT carry `effortP`, `risky` or `requested`. `held` MUST be absent from any other line. `advised`, `strategy` and `strategyP` MUST be absent.

#### Scenario: Required fields
- **WHEN** any `main` line is written
- **THEN** it validates against the ledger schema and carries `v`, `at`, `kind`, `session`, `mode`, `answered`, `turnId` and `outcome`

#### Scenario: Effective is read back from Pi
- **WHEN** the package applies `xhigh` and Pi clamps it to `high`
- **THEN** the line has `requested` `xhigh` and `effective` `high`

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
- **WHEN** a held turn at level `high`, with skills not applying, is answered with `corrects` 0.1 and completes
- **THEN** the line has `held` `true`, `effective` `high`, `from` `high`, `corrects` 0.1, and no `effortP`, `risky` or `requested`

#### Scenario: Held turn with a miss
- **WHEN** a held turn's Jev request times out
- **THEN** the line has `held` `true`, `answered` false, `miss` `timeout` and `effective` equal to the level in force

#### Scenario: Decided turn is not held
- **WHEN** a turn on a listed provider is decided with `effort` asked
- **THEN** the line has no `held`

### Requirement: No prompt text in the ledger or entries
No ledger line and no session entry written by the package SHALL contain prompt text, conversation text, tool arguments or tool output. A skill message's `content` holds the skill's own text (body or path), which is not prompt or conversation text; its skill fields in `details` MUST be only the skill name, fingerprint and form.

#### Scenario: Marker absent
- **WHEN** a host run submits a prompt containing `JEV-MARKER-PROMPT` and the run completes
- **THEN** neither the ledger files nor the package's custom entries contain `JEV-MARKER-PROMPT`

#### Scenario: Skill details
- **WHEN** a skill message is attached
- **THEN** its `details` has the keys `name`, `fingerprint` and `form`, and contains no prompt text

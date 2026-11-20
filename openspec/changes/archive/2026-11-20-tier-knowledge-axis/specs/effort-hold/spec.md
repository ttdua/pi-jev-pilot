## MODIFIED Requirements

### Requirement: Held turn keeps the level
A held prompt SHALL ask `corrects`, and `effort` and `strategy` when the `strategy` feature is on (as `strategy-advice` defines, with advice attached as on any other turn, the `effort` answer read for the gate only); it MUST NOT ask `risky` or `tier`, MUST NOT call `pi.setThinkingLevel`, and MUST NOT change the model. Only a prompt with the `effort` feature on can be held. The turn's provider requests MUST carry the thinking level in force when the Jev request completes. A Jev miss on a held prompt MUST change nothing else.

#### Scenario: No thinking change while held
- **WHEN** the anchor was decided at `high` on a listed provider, `strategy` is off, and three more prompts are submitted
- **THEN** each of those requests to Jev asks no `effort` or `risky`, the session gains no thinking-level change entry, and each provider request carries `high`

#### Scenario: Held turn with strategy advice
- **WHEN** the anchor was decided at `high` on a listed provider, `strategy` is on, and the next prompt is answered with `effort` `xhigh` and `strategy` `delegate` at probability 0.9
- **THEN** that request to Jev has exactly the question keys `effort`, `strategy` and `corrects`, the provider request carries `high` and the `delegate` advice block, and the ledger line has `held` `true`, `advised` true, and no `effortP` or `requested`

#### Scenario: Held and Jev fails
- **WHEN** a prompt is held and the Jev fixture answers HTTP 500
- **THEN** the provider request carries the level in force and the turn completes

#### Scenario: Manual change while held
- **WHEN** the anchor was decided at `high`, the operator sets `low`, and submits a prompt
- **THEN** the prompt is held, the provider request carries `low`, and the ledger line has `held` `true`, `from` `low` and `effective` `low`

#### Scenario: Correction while held
- **WHEN** the anchor turn T1 was decided and the next prompt is held and answered with `corrects` 0.9
- **THEN** a `correction` line with `turnId` T1 is written

### Requirement: One decision after a compaction
After a compaction, the first eligible prompt on a listed provider whose turn produces an effective level SHALL be decided with `effort` and `risky` asked and the effort result applied, and later prompts SHALL be held again. A held prompt MAY still ask `effort` for the strategy gate (see "Held turn keeps the level"); that answer MUST NOT end the hold or become the anchor. A prompt after the compaction whose request misses, whose result is discarded, or whose run is cancelled MUST NOT end the release: the next prompt is decided again.

#### Scenario: Exactly one decision after a compaction
- **WHEN** on a listed provider with `strategy` off, the anchor was decided at `low`, two prompts were held, the session is compacted, and three more prompts are submitted with Jev answering `high` each time
- **THEN** exactly the first prompt after the compaction asks `effort` and changes the level to `high`, and the other two are held with no further thinking-level change

#### Scenario: Held after a compaction with strategy on
- **WHEN** on a listed provider with `strategy` on, the session is compacted, and three prompts are submitted with Jev answering `effort` `xhigh` each time
- **THEN** only the first changes the level and asks `risky`; the other two ask `effort` for the gate, are held, change no level, and write no `jev-turn` entry with `decided`

#### Scenario: Miss right after a compaction
- **WHEN** on a listed provider the session was compacted, the next prompt's Jev request times out, and another prompt is submitted
- **THEN** that later prompt asks `effort` and `risky`

#### Scenario: Compaction inside a decided turn
- **WHEN** on a listed provider a prompt is decided at `high`, an overflow compaction happens before its run settles, and another prompt is submitted
- **THEN** the decided turn's `jev-turn` entry holds only `{ turnId }`, and the later prompt asks `effort` and `risky`

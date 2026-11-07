# effort-hold Specification

## Purpose
Main prompts on providers listed in `effort.holdProviders` keep the thinking level of the newest decision recorded on the current branch after its latest compaction, for the same provider and model, asking Jev only `corrects`; a compaction or a provider or model switch releases the hold so the next prompt decides once.

## Requirements

### Requirement: Held prompt
An eligible main prompt SHALL be held when the selected model's provider is in `effort.holdProviders` and the anchor matches the selected provider and model. The anchor is the newest `jev-turn` entry with `decided` on the current branch after its latest `compaction` entry. Otherwise the prompt MUST be decided as in `main-effort`. The hold rule MUST be a pure function with no Pi import.

#### Scenario: Second prompt on a held provider
- **WHEN** the provider is in `holdProviders` and the first prompt of the session was decided at `high` on the same provider and model
- **THEN** the second prompt is held

#### Scenario: Provider not listed
- **WHEN** the provider is not in `holdProviders` and an earlier prompt was decided
- **THEN** the prompt is not held and `effort`, `risky` and `corrects` are asked

#### Scenario: First prompt of a session
- **WHEN** the provider is in `holdProviders` and the branch holds no `jev-turn` entry with `decided`
- **THEN** the prompt is not held

#### Scenario: Anchor before the latest compaction
- **WHEN** the only `jev-turn` entry with `decided` is before the latest `compaction` entry on the branch
- **THEN** the prompt is not held

#### Scenario: Model switched
- **WHEN** the anchor was decided on model A of a listed provider and the operator selected model B of the same provider
- **THEN** the prompt is not held, and once it is decided it becomes the anchor for later prompts on model B

#### Scenario: Provider switched back
- **WHEN** a turn was decided on a listed provider, the next turn was decided on an unlisted provider, and the operator switches back to the listed provider and model
- **THEN** the prompt is not held, since the newest anchor is for the other provider

#### Scenario: Resume keeps the hold
- **WHEN** a session on a listed provider had a decided turn, Pi is restarted and the session resumed, and a prompt is submitted
- **THEN** the prompt is held

#### Scenario: Branch without the anchor
- **WHEN** the operator moved with `/tree` to a point before the anchor's `jev-turn` entry and submits a prompt
- **THEN** the prompt is not held

### Requirement: Held turn keeps the level
A held prompt SHALL ask only `corrects`, MUST NOT call `pi.setThinkingLevel`, and MUST NOT change the model. The turn's provider requests MUST carry the thinking level in force when the Jev request completes. A Jev miss on a held prompt MUST change nothing else.

#### Scenario: No thinking change while held
- **WHEN** the anchor was decided at `high` on a listed provider and three more prompts are submitted
- **THEN** each of those requests to Jev has exactly the question key `corrects`, the session gains no thinking-level change entry, and each provider request carries `high`

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
After a compaction, the first eligible prompt on a listed provider whose turn produces an effective level SHALL be decided with `effort` and `risky` asked, and later prompts SHALL be held again. A prompt after the compaction whose request misses, whose result is discarded, or whose run is cancelled MUST NOT end the release: the next prompt is decided again.

#### Scenario: Exactly one decision after a compaction
- **WHEN** on a listed provider the anchor was decided at `low`, two prompts were held, the session is compacted, and three more prompts are submitted with Jev answering `high` each time
- **THEN** exactly the first prompt after the compaction asks `effort` and changes the level to `high`, and the other two are held with no further thinking-level change

#### Scenario: Miss right after a compaction
- **WHEN** on a listed provider the session was compacted, the next prompt's Jev request times out, and another prompt is submitted
- **THEN** that later prompt asks `effort` and `risky`

#### Scenario: Compaction inside a decided turn
- **WHEN** on a listed provider a prompt is decided at `high`, an overflow compaction happens before its run settles, and another prompt is submitted
- **THEN** the decided turn's `jev-turn` entry holds only `{ turnId }`, and the later prompt asks `effort` and `risky`

### Requirement: Anchor recorded with the turn
When a turn's run settles, the turn was not held, it produced an effective level (applied, already equal to the target, or `max` kept), and no compaction happened on the branch between the prompt and the settle, its `jev-turn` entry SHALL carry `decided`, whether or not the provider is listed, with `provider`, `model` and `level` (the effective level), in addition to `turnId`. Any other turn's `jev-turn` entry MUST hold only `{ turnId }`. `decided` MUST NOT contain prompt or conversation text.

#### Scenario: Applied turn
- **WHEN** a prompt on provider `fixture` and model `fixture-main` is decided at `high` and the run completes
- **THEN** its `jev-turn` entry data is exactly `{ turnId, decided: { provider: "fixture", model: "fixture-main", level: "high" } }`

#### Scenario: Held turn
- **WHEN** a held turn settles
- **THEN** its `jev-turn` entry data is exactly `{ turnId }`

#### Scenario: Discarded turn
- **WHEN** the result was discarded on a manual change
- **THEN** its `jev-turn` entry data is exactly `{ turnId }`

#### Scenario: Aborted after the provider request
- **WHEN** a prompt is decided at `high` and the operator aborts after its first provider request started
- **THEN** its `jev-turn` entry carries `decided` with `level` `high`

#### Scenario: Non-reasoning model
- **WHEN** the selected model is not a reasoning model and the prompt is answered
- **THEN** its `jev-turn` entry data is exactly `{ turnId }`, since no effort was decided

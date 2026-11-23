## ADDED Requirements

### Requirement: Worker turn fields
The line SHALL carry `requestedTurns` (the launch's `requested.maxTurns`) whenever `turns` was asked, `turnsP` (the band probabilities) when it was answered, and `turnFloor` (the `maxTurns` written) only when one was written; a launch that did not ask `turns` MUST carry none of them. They MUST pass the schema with `v` 1, and older lines MUST stay valid. A turns-only line SHALL read like a thinking-only one.

#### Scenario: Raised limit recorded
- **WHEN** a launch with `max_turns` 20 gets `turns` probabilities `short` .1, `medium` .2, `long` .6 and `very_long` .1, and is routed to `broad`
- **THEN** its line has `requestedTurns` 20, `turnsP` with the four band keys, `turnFloor` 100, and `tier` `broad`

#### Scenario: Asked but not raised
- **WHEN** a launch with `max_turns` 120 is asked `turns` and the floor is 100
- **THEN** its line has `requestedTurns` 120 and `turnsP`, and no `turnFloor`

#### Scenario: Unlimited launch
- **WHEN** a launch with no turn limit is routed
- **THEN** its line has no `requestedTurns`, `turnsP` or `turnFloor`

#### Scenario: Turns-only recorded
- **WHEN** a launch whose agent locks both `model` and `thinking` has `max_turns` 20 and is rated `very_long` (floor 200)
- **THEN** its line has `reason` `untouched`, `answered` true, `locked` true, `requestedTurns` 20, `turnFloor` 200, and no `tier`, `model`, `effort`, `score` or `rubric`

#### Scenario: Turn miss recorded
- **WHEN** a launch with `max_turns` 20 is asked `turns` and Jev times out
- **THEN** its line has `requestedTurns` 20, `answered` false, `miss` `timeout`, and no `turnsP` or `turnFloor`

#### Scenario: Old line still valid
- **WHEN** a worker line written before this change, without the turn fields, is read
- **THEN** it passes the ledger schema

### Requirement: Worker turn use
The line SHALL carry `turnsUsed` and `turnPhase` from the `turnBudget` of the executor's `subagents:completed` or `subagents:failed` event: `turnsUsed` from `used` and `turnPhase` from `phase`, which MUST be one of `within`, `warned` or `exhausted`. Each field SHALL be written only when the event carries a valid value, for every worker line whether or not `turns` was asked, and MUST pass the schema with `v` 1.

#### Scenario: Turn use recorded
- **WHEN** a worker with a turn limit completes and its event carries `turnBudget` `{ maxTurns: 100, used: 37, phase: "within" }`
- **THEN** its line has `turnsUsed` 37 and `turnPhase` `within`

#### Scenario: Exhausted run recorded
- **WHEN** a worker stopped at its limit ends with `turnBudget` `{ maxTurns: 20, used: 20, phase: "exhausted" }`
- **THEN** its line has `turnsUsed` 20 and `turnPhase` `exhausted`

#### Scenario: No turn budget
- **WHEN** a worker's event carries no `turnBudget`
- **THEN** its line has no `turnsUsed` or `turnPhase`

#### Scenario: Unknown phase dropped
- **WHEN** a worker's event carries `turnBudget` with `used` 5 and `phase` `paused`
- **THEN** its line has `turnsUsed` 5 and no `turnPhase`

## MODIFIED Requirements

### Requirement: Worker decision fields
The line SHALL carry the route fields: `score` when scored; `rubric` and `frontierOffered` whenever `tier` was asked, and never `expertOffered`; `tier` and `fallback` as a tier or `slot::<name>`; and `tierP` keyed by every offered target Jev returned. It SHALL also carry `effectiveModel` and `effectiveThinking` as joined from the executor.

#### Scenario: Routed fields
- **WHEN** a launch is routed by rule `cut` to `broad` with thinking `high`, with score 1.3, and the caller asked for `fixture/fixture-main`
- **THEN** the line has `tier` `broad`, `reason` `cut`, `score` 1.3, `rubric` 3, `model` the `broad` model, `effort` `high` and `callerModel` `fixture/fixture-main`

#### Scenario: Expert offered recorded
<!-- Intentional change: `expertOffered` is renamed `frontierOffered`. -->
- **WHEN** all four tiers are offered and the launch is routed
- **THEN** the line has `frontierOffered` true

#### Scenario: Expert switched off recorded
<!-- Intentional change: the `expert` switch is renamed `frontier`. -->
- **WHEN** the `frontier` switch is off and the launch is routed
- **THEN** the line has `frontierOffered` false

#### Scenario: Fallback recorded
- **WHEN** a launch cascades from `deep` to `broad`
- **THEN** the line has `tier` `broad` and `fallback` `deep`

#### Scenario: Nothing could run recorded
- **WHEN** rule `cut` decides `broad` and no tier from `broad` down can run
- **THEN** the line has `tier` `broad`, `reason` `cut`, `fallback` `broad`, and no `model` or `effort`

#### Scenario: Thinking-only recorded
- **WHEN** a forked launch with the setting `thinking` is asked and thinking `high` is written
- **THEN** the line has `answered` true, `reason` `untouched`, `effort` `high`, and no `tier`, `model`, `score` or `rubric`

#### Scenario: Untouched recorded
- **WHEN** a launch whose agent locks both `model` and `thinking`, and that has no turn limit, completes
- **THEN** the line has `reason` `untouched`, `answered` false, and no `tier`, `model`, `score` or `rubric`

#### Scenario: Tier asked, nothing decided
- **WHEN** tiers are offered, Jev answers `effort` but not `tier`, and no target is decided
- **THEN** the line has `reason` `untouched`, `rubric` 3, `frontierOffered`, and no `tier` or `score`

#### Scenario: Locked recorded
- **WHEN** a launch's agent locks `model`
- **THEN** the line has `locked` true and no `model`

#### Scenario: Not locked
- **WHEN** a launch's agent locks nothing and the launch is not a service launch naming a model
- **THEN** the line has no `locked` field

#### Scenario: Slot decision recorded
- **WHEN** a launch is routed to slot `reviewer` with thinking `high`
- **THEN** the line has `tier` `slot::reviewer`, `reason` `slot`, `model` the slot's model, `effort` `high`, and `tierP` with a `slot::reviewer` key

#### Scenario: Slot fallback recorded
- **WHEN** a launch decided for slot `reviewer` falls back to `broad`
- **THEN** the line has `tier` `broad`, `reason` `slot` and `fallback` `slot::reviewer`, and it passes the ledger schema

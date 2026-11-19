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
- **WHEN** a launch whose agent locks both `model` and `thinking` completes
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

### Requirement: Worker request fields
The line SHALL carry `mode` (captured at classification, see `worker-routing`), `agent`, `briefChars` (the brief's code points), the raw `tierP`, `effortP` and `risky`, and `answered`, `ms` and `miss` from the worker request, with `answered` false and no `ms` or `miss` when no request was sent.

#### Scenario: Mode recorded
- **WHEN** a launch is classified while the mode is `budget`
- **THEN** its line has `mode` `budget`

#### Scenario: Miss recorded
- **WHEN** Jev times out for a launch
- **THEN** the line has `answered` false, `miss` `timeout`, `reason` `miss`, `rubric` 3, `frontierOffered` as offered, and no `tier` or `score`

## MODIFIED Requirements

### Requirement: Decision fields
The line SHALL carry `mode` (the mode captured when the launch was classified, see `worker-routing`); `answered`, `ms` and `miss` from the worker request, with `answered` false and no `ms` or `miss` when no request was sent; `agent` and `briefChars` (code points of the brief); the raw `tierP`, `effortP`, `risky` and `expertNeeded`; and the route's recorded fields. The line MUST NOT contain the brief, the description or any other tool argument.

#### Scenario: Routed fields
- **WHEN** a launch is routed to `balanced` with thinking `high` and the caller asked for `fixture/fixture-main`
- **THEN** the line has `tier` `balanced`, `reason` `choice`, `model` the `balanced` model, `effort` `high` and `callerModel` `fixture/fixture-main`

#### Scenario: Fallback recorded
- **WHEN** a launch cascades from `deep` to `balanced`
- **THEN** the line has `tier` `balanced` and `fallback` `deep`

#### Scenario: Nothing could run recorded
- **WHEN** Jev decides `balanced` by choice and no tier from `balanced` down can run
- **THEN** the line has `tier` `balanced`, `reason` `choice`, `fallback` `balanced`, and no `model` or `effort`

#### Scenario: Thinking-only recorded
- **WHEN** a forked launch with the setting `thinking` is asked and thinking `high` is written
- **THEN** the line has `answered` true, `reason` `untouched`, `effort` `high`, and no `tier` or `model`

#### Scenario: Miss recorded
- **WHEN** Jev times out for a launch
- **THEN** the line has `answered` false, `miss` `timeout`, `reason` `miss`, and no `tier`

#### Scenario: Untouched recorded
- **WHEN** a resumed launch completes
- **THEN** the line has `reason` `untouched`, `answered` false, and no `tier` or `model`

#### Scenario: Locked recorded
- **WHEN** a launch's agent locks `model`
- **THEN** the line has `locked` true and no `model`

#### Scenario: Not locked
- **WHEN** a launch's agent locks nothing
- **THEN** the line has no `locked` field

#### Scenario: No prompt text
- **WHEN** a launch with a brief containing a unique marker is recorded
- **THEN** no ledger file contains that marker

#### Scenario: Mode recorded
- **WHEN** a launch is classified while the mode is `budget`
- **THEN** its line has `mode` `budget`

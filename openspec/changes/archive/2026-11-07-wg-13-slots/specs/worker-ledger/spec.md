## MODIFIED Requirements

### Requirement: Decision fields
The line SHALL carry `mode` (the mode captured when the launch was classified, see `worker-routing`); `answered`, `ms` and `miss` from the worker request, with `answered` false and no `ms` or `miss` when no request was sent; `agent` and `briefChars` (code points of the brief); the raw `tierP`, `effortP`, `risky` and `expertNeeded`; the route's recorded fields, where `tier` and `fallback` hold a tier or a `slot::<name>` target and `tierP` holds a key for every offered tier and slot that Jev returned; and `toolsScored` and `toolsFlagged` when that launch started a worker session whose tool assessment got an answer, omitted otherwise (a resumed launch starts no new session). The line MUST NOT contain the brief, the description, tool names or tool arguments.

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

#### Scenario: Tool counts recorded
- **WHEN** a launch's worker was assessed with 4 tools scored and 1 flagged
- **THEN** the line has `toolsScored` 4 and `toolsFlagged` 1

#### Scenario: No assessment, no counts
- **WHEN** a launch's worker got no tool assessment answer, because its agent declares `tools`, the `tools` switch is off, or the request failed
- **THEN** the line has no `toolsScored` and no `toolsFlagged`

#### Scenario: Resumed launch carries no counts
- **WHEN** a launch resumes a worker that was assessed earlier and completes
- **THEN** its line has no `toolsScored` and no `toolsFlagged`

#### Scenario: Slot decision recorded
- **WHEN** a launch is routed to slot `reviewer` with thinking `high`
- **THEN** the line has `tier` `slot::reviewer`, `reason` `slot`, `model` the slot's model, `effort` `high`, and `tierP` with a `slot::reviewer` key

#### Scenario: Slot fallback recorded
- **WHEN** a launch decided for slot `reviewer` falls back to `balanced`
- **THEN** the line has `tier` `balanced`, `reason` `slot` and `fallback` `slot::reviewer`, and it passes the ledger schema

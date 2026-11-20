## MODIFIED Requirements

### Requirement: Missing state means defaults
A missing `state.json` SHALL read as missing, with no fields set, and MUST NOT be reported as a problem.

#### Scenario: No file
- **WHEN** the jev directory has no `state.json`
- **THEN** the read is missing, with no switches and no mode

### Requirement: Reset
Resetting the state SHALL write a state with no fields set, so every switch and the mode fall back to their config or code defaults.

#### Scenario: Reset clears everything
- **WHEN** the state has switches and a mode, and it is reset
- **THEN** a new read returns no switches and no mode

## ADDED Requirements

### Requirement: State file fields
`state.json` SHALL hold `version` `1` and the optional fields `switches` (feature name to boolean) and `mode` (`budget`, `standard` or `premium`). The features are those in `docs/usage-guide.md`. A field MUST be present only when the operator set it. A boolean `switches.review` or `switches.tools`, left by an older version, MUST be accepted on read and dropped from the returned state (with `switches` itself dropped when nothing else is left in it), so it is gone after the next write. A non-boolean `switches.review` or `switches.tools` is malformed. A boolean `switches.expert`, the former name of `switches.frontier`, MUST be accepted on read and returned as `switches.frontier` when `switches.frontier` is absent, and dropped when it is present, so it is gone after the next write. A non-boolean `switches.expert` is malformed. For one minor release, `cliReview` and `cliReviewEnabled`, left by the removed CLI review, MUST be accepted on read with any value and dropped from the returned state, so they are gone after the next write.

#### Scenario: Valid state read
- **WHEN** `state.json` holds `{"version":1,"switches":{"skills":false},"mode":"budget"}`
- **THEN** the read returns those values

#### Scenario: Retired CLI review fields accepted and dropped
- **WHEN** `state.json` holds `{"version":1,"mode":"budget","cliReview":{"cli":"codex","model":"luna"},"cliReviewEnabled":true}`
- **THEN** the read is ok and returns only mode `budget`, with no `cliReview` or `cliReviewEnabled`

#### Scenario: Retired CLI review fields of any shape
- **WHEN** `cliReview.model` is `"-m"` in one read and `cliReviewEnabled` is `"yes"` in another
- **THEN** both reads are ok and return no `cliReview` or `cliReviewEnabled`

#### Scenario: Retired CLI review fields gone after a write
- **WHEN** `state.json` holds `cliReviewEnabled` `true` and an update sets `mode` to `premium`
- **THEN** the written file has `mode` `premium` and no `cliReviewEnabled`

#### Scenario: Every documented feature accepted
- **WHEN** `state.json` sets each of `effort`, `subagents`, `skills`, `strategy`, `frontier`, `status`, `verbose` to `false`
- **THEN** the read returns all seven switches off

#### Scenario: Legacy review switch accepted and dropped
- **WHEN** `state.json` holds `{"version":1,"mode":"budget","switches":{"review":false,"skills":false}}`
- **THEN** the read is ok and returns mode `budget` and `switches` `{"skills":false}`, with no `review`

#### Scenario: Legacy review switch alone
- **WHEN** `state.json` holds `{"version":1,"switches":{"review":true}}`
- **THEN** the read is ok and returns a state with no `switches`

#### Scenario: Legacy review switch gone after a write
- **WHEN** `state.json` holds `switches.review` `false` and an update sets `mode` to `premium`
- **THEN** the written file has `mode` `premium` and no `switches.review`

#### Scenario: Non-boolean legacy review switch
- **WHEN** `switches.review` is `"off"`
- **THEN** the read is malformed with a problem at `switches.review`

#### Scenario: Legacy tools switch accepted and dropped
- **WHEN** `state.json` holds `{"version":1,"switches":{"tools":false,"skills":false}}`
- **THEN** the read is ok and returns `switches` `{"skills":false}`, with no `tools`

#### Scenario: Legacy tools switch gone after a write
- **WHEN** `state.json` holds `switches.tools` `true` and an update sets `mode` to `premium`
- **THEN** the written file has `mode` `premium` and no `switches.tools`

#### Scenario: Non-boolean legacy tools switch
- **WHEN** `switches.tools` is `"on"`
- **THEN** the read is malformed with a problem at `switches.tools`

#### Scenario: Legacy expert switch moved
- **WHEN** `state.json` holds `{"version":1,"switches":{"expert":false}}`
- **THEN** the read is ok and returns `switches` `{"frontier":false}`, with no `expert`

#### Scenario: Frontier wins over the legacy switch
- **WHEN** `state.json` holds `switches.expert` `false` and `switches.frontier` `true`
- **THEN** the read returns `switches.frontier` `true` and no `expert`

#### Scenario: Legacy expert switch gone after a write
- **WHEN** `state.json` holds `switches.expert` `false` and an update sets `mode` to `premium`
- **THEN** the written file has `switches.frontier` `false`, `mode` `premium` and no `switches.expert`

#### Scenario: Non-boolean legacy expert switch
- **WHEN** `switches.expert` is `"off"`
- **THEN** the read is malformed with a problem at `switches.expert`

#### Scenario: Unknown feature
- **WHEN** `state.json` has `switches.colors`
- **THEN** the read is malformed with a problem at `switches.colors`

## REMOVED Requirements

### Requirement: State file content

**Reason**: Restated as "State file fields" because the cliReview and cliReviewEnabled fields and their scenarios are removed with the CLI review; OpenSpec cannot drop a scenario through MODIFIED.

**Migration**: Replaced by "State file fields" in this capability.

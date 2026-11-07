## MODIFIED Requirements

### Requirement: State file content
`state.json` SHALL hold `version` `1` and the optional fields `switches` (feature name to boolean), `mode` (`budget`, `standard` or `premium`), `cliReviewEnabled` (a boolean: whether the CLI review is on) and `cliReview` (required `cli` of `codex` or `opencode`; optional `model` of 1–128 characters from letters, digits, `.`, `_`, `-`, `:`, `/`, not starting with `-`, `:` or `/`; optional `effort` of 1–64 characters from letters, digits, `.`, `_`, `-`; neither of them the word `default`, which the `/jev cli-review` command expresses by omitting the field). The features are those in `docs/usage-guide.md`. A field MUST be present only when the operator set it.

#### Scenario: Valid state read
- **WHEN** `state.json` holds `{"version":1,"switches":{"skills":false},"mode":"budget","cliReview":{"cli":"codex","model":"luna","effort":"high"}}`
- **THEN** the read returns those values

#### Scenario: OpenCode model id accepted
- **WHEN** `cliReview` is `{"cli":"opencode","model":"ollama-cloud/gpt-oss:120b"}`
- **THEN** the read returns that model

#### Scenario: Model that looks like a flag
- **WHEN** `cliReview.model` is `"-m"`
- **THEN** the read is malformed with a problem at `cliReview.model`

#### Scenario: Every documented feature accepted
- **WHEN** `state.json` sets each of `effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `review`, `status`, `verbose` to `false`
- **THEN** the read returns all nine switches off

#### Scenario: Literal default rejected
- **WHEN** `cliReview.model` is `"default"`
- **THEN** the read is malformed with a problem at `cliReview.model`

#### Scenario: CLI review switch read
- **WHEN** `state.json` holds `{"version":1,"cliReviewEnabled":true}`
- **THEN** the read returns `cliReviewEnabled` `true` and no `cliReview`

#### Scenario: Non-boolean CLI review switch
- **WHEN** `cliReviewEnabled` is `"yes"`
- **THEN** the read is malformed with a problem at `cliReviewEnabled`

#### Scenario: Unknown feature
- **WHEN** `state.json` has `switches.colors`
- **THEN** the read is malformed with a problem at `switches.colors`

### Requirement: Reset
Resetting the state SHALL write a state with no fields set, so every switch, the mode, the CLI review default and the CLI review on/off setting fall back to their config or code defaults.

#### Scenario: Reset clears everything
- **WHEN** the state has switches, a mode, a CLI review default and `cliReviewEnabled` `true`, and it is reset
- **THEN** a new read returns no switches, no mode, no CLI review default and no `cliReviewEnabled`

## MODIFIED Requirements

### Requirement: Status report
`/jev` with no argument SHALL report the status: the status line text, the effective mode, each of the nine feature switches with `on` or `off`, the effective CLI review default (the CLI, and the model and effort when set, or that the CLI's defaults apply), whether the API key is set (naming the environment variable, never its value), whether the executor is present, every config and state problem with its field path, and, last, the session tally. Without the executor, the report MUST say `no executor` and that worker routing and tool assessment are off. The tally SHALL be a `session:` line followed by lines indented by two spaces: `prompts <P>`, `workers <W>` followed by ` (<model> <n>, ...)` in first-seen order when `W` is not 0 (lines without a model appear as `unrouted <n>`), `worker tokens <T>` and `fallbacks <F>`. It MUST show no price and no tools count. The command MUST NOT call Jev or any other network service.

#### Scenario: Default status
- **WHEN** the config is valid, the key is set, the executor is installed, and `/jev` runs
- **THEN** the report names mode `standard`, lists every feature `on` except `verbose`, shows the CLI review default as `codex` with the CLI's defaults, says the key in `TYPESAFE_API_KEY` is set, and reports the executor as present

#### Scenario: CLI review default shown
- **WHEN** the state holds `cliReview` `{"cli":"codex","model":"luna","effort":"high"}` and `/jev` runs
- **THEN** the report shows the CLI review default as `codex` with model `luna` and effort `high`

#### Scenario: No executor
- **WHEN** the executor is not installed and `/jev` runs
- **THEN** the report contains `no executor` and says worker routing and tool assessment are off

#### Scenario: Key name, never value
- **WHEN** the key is set to a test value and `/jev` runs
- **THEN** the report names `TYPESAFE_API_KEY` and does not contain the value

#### Scenario: Malformed state reported
- **WHEN** `state.json` is malformed and `/jev` runs
- **THEN** the report shows the default switches and lists the state problems with their paths

#### Scenario: Invalid config reported
- **WHEN** `config.json` has an invalid `classifier.timeoutMs` and `/jev` runs
- **THEN** the report says `config error` and lists the problem at `classifier.timeoutMs`

#### Scenario: Empty tally
- **WHEN** a new session starts and `/jev` runs before any prompt
- **THEN** the report ends with `session:`, `  prompts 0`, `  workers 0`, `  worker tokens 0` and `  fallbacks 0`

#### Scenario: Tally after work
- **WHEN** two prompts were decided and one worker routed to `fixture/fast` used 120 tokens, and `/jev` runs
- **THEN** the report ends with `session:`, `  prompts 2`, `  workers 1 (fixture/fast 1)`, `  worker tokens 120` and `  fallbacks 0`

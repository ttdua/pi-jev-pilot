## MODIFIED Requirements

### Requirement: Status report
`/jev` with no argument SHALL report the status: the status line text, the effective mode (as `mode: <m>`, or `mode: <m> (this directory; global <g>)` while a directory mode is set, with `<g>` the global mode), each of the seven feature switches with `on` or `off`, the CLI review on one line `cli review: <on|off> (<cli>, <details>)` where `<details>` is `model <m>` and `effort <e>` when set, joined by `, `, or `CLI defaults` when neither is set, whether the API key is set (naming the environment variable, never its value), the executor line (see `readiness-checks`), every config, state, directory mode and `tuning.json` problem with its field path, one line `deprecated: config tools is ignored` under the problems when the config read reports `tools` as deprecated (this report is the only place the deprecation is shown; it MUST NOT be notified on its own), the recent worker mix when worker routing can run (the executor is present with a launch policy), and, last, the session tally. The recent worker mix SHALL be one line `mix (last <n>, <mode>): fast <a>% / balanced <b>% / deep <c>% / expert <d>% · target <f>/<b>/<d>/≤<cap>` from the cut-point window and the effective mode's target table, followed by `cut points: seed` while the window holds fewer than 100 entries. With an empty window it SHALL read `mix: no routed workers yet` and the seed line. Shares are rounded to whole percents independently, so they may not sum to 100. The executor line SHALL read `executor: no executor; worker routing is off` when the executor is absent; `executor: <implementation>` when it is present with a launch policy, where `<implementation>` is the service's `implementation` or `unknown`; and `executor: <implementation>; no launch policy, worker routing is off` when the launch policy is missing. When the agent registry is missing, the line SHALL end with `; no agent registry`. The report MUST NOT advise uninstalling any package. The tally SHALL be a `session:` line followed by lines indented by two spaces: `prompts <P>`, `workers <W>` followed by ` (<model> <n>, ...)` in first-seen order when `W` is not 0 (lines without a model appear as `unrouted <n>`), `worker tokens <T>` and `fallbacks <F>`. It MUST show no price and no tools count. The command MUST NOT call Jev or any other network service.

#### Scenario: Default status
- **WHEN** the config is valid, the key is set, the executor is installed, and `/jev` runs
- **THEN** the report names mode `standard`, lists every feature `on` except `verbose`, contains `cli review: off (codex, CLI defaults)`, says the key in `TYPESAFE_API_KEY` is set, and contains `executor: @ttdua/pi-subagents`

#### Scenario: Directory mode in the report
- **WHEN** `state.json` sets the mode to `standard`, the directory mode is `premium`, and `/jev` runs
- **THEN** the report contains `mode: premium (this directory; global standard)`, and its `mix` line, when shown, names `premium` and the `premium` target

#### Scenario: Malformed directory mode reported
- **WHEN** `<cwd>/.pi/jev-mode.json` is not valid JSON and `/jev` runs
- **THEN** the report contains `mode: standard` and lists a `local mode (malformed)` problem at `(file)`

#### Scenario: CLI review default shown
- **WHEN** the state holds `cliReview` `{"cli":"codex","model":"luna","effort":"high"}` and `cliReviewEnabled` `true`, and `/jev` runs
- **THEN** the report contains `cli review: on (codex, model luna, effort high)`

#### Scenario: No executor
- **WHEN** the executor is not installed and `/jev` runs
- **THEN** the report contains `executor: no executor; worker routing is off`

#### Scenario: Key name, never value
- **WHEN** the key is set to a test value and `/jev` runs
- **THEN** the report names `TYPESAFE_API_KEY` and does not contain the value

#### Scenario: Malformed state reported
- **WHEN** `state.json` is malformed and `/jev` runs
- **THEN** the report shows the default switches and lists the state problems with their paths

#### Scenario: Invalid config reported
- **WHEN** `config.json` has an invalid `classifier.timeoutMs` and `/jev` runs
- **THEN** the report says `config error` and lists the problem at `classifier.timeoutMs`

#### Scenario: Deprecated tools section reported
- **WHEN** `config.json` is otherwise valid, holds a `tools` section and `/jev` runs
- **THEN** the report contains `deprecated: config tools is ignored`, does not say `config error`, and the status line text is unchanged by the key

#### Scenario: Deprecation never notified on its own
- **WHEN** `config.json` holds a `tools` section and a session starts, prompts run and workers launch, without `/jev`
- **THEN** no notification mentions the deprecated `tools` section

#### Scenario: Malformed tuning reported
- **WHEN** `tuning.json` is truncated and `/jev` runs
- **THEN** the report lists a `tuning (malformed)` problem at `(file)`

#### Scenario: Empty tally
- **WHEN** a new session starts and `/jev` runs before any prompt
- **THEN** the report ends with `session:`, `  prompts 0`, `  workers 0`, `  worker tokens 0` and `  fallbacks 0`

#### Scenario: Tally after work
- **WHEN** two prompts were decided and one worker routed to `fixture/fast` used 120 tokens, and `/jev` runs
- **THEN** the report ends with `session:`, `  prompts 2`, `  workers 1 (fixture/fast 1)`, `  worker tokens 120` and `  fallbacks 0`

#### Scenario: Mix with a full window
- **WHEN** the mode is `standard`, the window holds 200 entries with decided tiers 38 `fast`, 110 `balanced`, 48 `deep` and 4 `expert`, and `/jev` runs
- **THEN** the report contains `mix (last 200, standard): fast 19% / balanced 55% / deep 24% / expert 2% · target 20/53/25/≤2` and no `cut points: seed` line

#### Scenario: Budget target shown
- **WHEN** the mode is `budget`, the window holds 120 entries and `/jev` runs
- **THEN** the `mix` line ends with `target 50/40/10/≤0`

#### Scenario: Mix while the seed applies
- **WHEN** the window holds 40 entries and `/jev` runs
- **THEN** the report contains a `mix (last 40, …)` line followed by `cut points: seed`

#### Scenario: Empty window
- **WHEN** the window is empty and `/jev` runs
- **THEN** the report contains `mix: no routed workers yet` and `cut points: seed`

#### Scenario: No mix without the executor
- **WHEN** the executor is not installed and `/jev` runs
- **THEN** the report has no `mix` line

#### Scenario: Duplicate executor reported
- **WHEN** jev-pilot runs with an executor whose service, like that of `@gotgenes/pi-subagents` 25.0.5, has no `implementation`, no `registerLaunchPolicy` and no `listAgentTypes`, and `/jev` runs
- **THEN** the report contains `executor: unknown; no launch policy, worker routing is off; no agent registry`, has no `mix` line, and does not contain `uninstall`

#### Scenario: Executor without an agent registry reported
- **WHEN** the executor's service has `registerLaunchPolicy` and no `listAgentTypes`, and `/jev` runs
- **THEN** the executor line ends with `; no agent registry`

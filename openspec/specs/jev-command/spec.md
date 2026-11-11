# jev-command Specification

## Purpose
The `/jev` command reports the status and changes feature switches through `state.json`; forms owned by later work groups print usage text, and output goes only through UI notifications.

## Requirements

### Requirement: Status report
`/jev` with no argument SHALL report the status: the status line text, the effective mode (as `mode: <m>`, or `mode: <m> (this directory; global <g>)` while a directory mode is set, with `<g>` the global mode), each of the eight feature switches with `on` or `off`, the CLI review on one line `cli review: <on|off> (<cli>, <details>)` where `<details>` is `model <m>` and `effort <e>` when set, joined by `, `, or `CLI defaults` when neither is set, whether the API key is set (naming the environment variable, never its value), whether the executor is present, the duplicate executor problem when one is detected (see `readiness-checks`), every config, state, directory mode and `tuning.json` problem with its field path, the recent worker mix when the executor is present, and, last, the session tally. The recent worker mix SHALL be one line `mix (last <n>, <mode>): fast <a>% / balanced <b>% / deep <c>% / expert <d>% · target <f>/<b>/<d>/≤<cap>` from the cut-point window and the effective mode's target table, followed by `cut points: seed` while the window holds fewer than 100 entries. With an empty window it SHALL read `mix: no routed workers yet` and the seed line. Shares are rounded to whole percents independently, so they may not sum to 100. Without the executor, the report MUST say `no executor` and that worker routing and tool assessment are off. With a duplicate executor, the report MUST say `duplicate executor`, name the path of the other `subagent` tool's extension, say to uninstall `@gotgenes/pi-subagents`, and say that worker routing and tool assessment are off. The tally SHALL be a `session:` line followed by lines indented by two spaces: `prompts <P>`, `workers <W>` followed by ` (<model> <n>, ...)` in first-seen order when `W` is not 0 (lines without a model appear as `unrouted <n>`), `worker tokens <T>` and `fallbacks <F>`. It MUST show no price and no tools count. The command MUST NOT call Jev or any other network service.

#### Scenario: Default status
- **WHEN** the config is valid, the key is set, the executor is installed, and `/jev` runs
- **THEN** the report names mode `standard`, lists every feature `on` except `verbose`, contains `cli review: off (codex, CLI defaults)`, says the key in `TYPESAFE_API_KEY` is set, and reports the executor as present

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
- **WHEN** jev-pilot's extension runs with `@gotgenes/pi-subagents` and without the vendored executor, and `/jev` runs
- **THEN** the report contains `duplicate executor`, the other extension's path, the advice to uninstall `@gotgenes/pi-subagents`, and says worker routing and tool assessment are off

### Requirement: Feature switches
`/jev <feature> on|off`, where `<feature>` is one of `effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `status`, `verbose`, SHALL set that switch in `state.json` through the state store, leaving other fields unchanged, then report the new status and refresh the status line. A switch set this way MUST still apply after Pi restarts. `review` is not a feature.

#### Scenario: Turn a feature off
- **WHEN** the operator runs `/jev skills off`
- **THEN** `state.json` holds `switches.skills` `false`, other fields are unchanged, and the report shows `skills` `off`

#### Scenario: Switch survives a restart
- **WHEN** the operator runs `/jev skills off`, Pi exits, a new Pi process starts with the same agent directory and `/jev` runs
- **THEN** the report shows `skills` `off`

#### Scenario: Turn a feature back on
- **WHEN** `skills` is off and the operator runs `/jev skills on`
- **THEN** `state.json` holds `switches.skills` `true`

#### Scenario: Status lists eight features
- **WHEN** `/jev` runs
- **THEN** the `features:` block lists exactly `effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `status`, `verbose`, in that order, and no `review`

### Requirement: All features
`/jev all on|off` SHALL set the six decision features (`effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`) in one state update, and MUST leave `status`, `verbose` and the CLI review on/off setting unchanged.

#### Scenario: All off
- **WHEN** the operator runs `/jev all off`
- **THEN** the six decision features are `false` in `state.json`, `status` and `verbose` keep their values, and, with the key set and the config valid, the status line reads `Jev · off`

#### Scenario: All on
- **WHEN** every decision feature is off and the operator runs `/jev all on`
- **THEN** the six decision features are `true` in `state.json`

#### Scenario: All leaves the CLI review alone
- **WHEN** the state holds `cliReviewEnabled` `true` and the operator runs `/jev all off`
- **THEN** `state.json` still holds `cliReviewEnabled` `true`

### Requirement: Reset
`/jev reset` SHALL reset the state through the state store, so switches, the mode, the CLI review default and the CLI review on/off setting fall back to config or code defaults. When the reset succeeds and the current directory has a directory mode file, it SHALL also remove that file (see `directory-mode`). It then reports the status and refreshes the status line. When the state store refuses the reset, the directory mode file MUST stay as it was. When the state reset succeeds but the file cannot be removed, the command SHALL still report the status and refresh the status line, with one warning that the global settings were reset and the directory mode was not removed, naming the error.

#### Scenario: Reset after changes
- **WHEN** `skills` is off, the mode is `premium`, and the operator runs `/jev reset`
- **THEN** a new read of `state.json` has no switches, no mode and no CLI review default, and, with the key set and the config valid, the status line reads `Jev · standard`

#### Scenario: Reset removes the directory mode
- **WHEN** the directory mode is `premium` and the operator runs `/jev reset`
- **THEN** `<cwd>/.pi/jev-mode.json` no longer exists, the report contains `mode: standard` with no `(this directory` text, and, with the key set and the config valid, the status line reads `Jev · standard`

#### Scenario: Refused reset keeps the directory mode
- **WHEN** the directory mode is `premium`, `state.json` has mode `0000`, and the operator runs `/jev reset`
- **THEN** an error naming `EACCES` is reported and `<cwd>/.pi/jev-mode.json` still holds `premium`

#### Scenario: Partial reset reports a warning and redraws
- **WHEN** `skills` is off, the global mode is `premium`, the directory mode is `budget`, `<cwd>/.pi` cannot be written, and the operator runs `/jev reset`
- **THEN** `state.json` holds only `version`, `<cwd>/.pi/jev-mode.json` still holds `budget`, one warning contains `global settings reset; directory mode not removed:`, the error code and `mode: budget (this directory; global standard)`, and, with the key set and the config valid, the status line is redrawn as `Jev · budget (local)`

#### Scenario: Reset turns the CLI review off
- **WHEN** the state holds `cliReviewEnabled` `true`, the config does not set `review.enabled`, and the operator runs `/jev reset`
- **THEN** a new read of `state.json` has no `cliReviewEnabled` and the report contains `cli review: off`

### Requirement: Refused changes
When the state store refuses a change (an unreadable `state.json`, or a write error), `/jev` SHALL report only the problem, as an error, and MUST NOT report the change as applied. The status line is not redrawn, since nothing changed.

#### Scenario: Unreadable state
- **WHEN** `state.json` has mode `0000` and the operator runs `/jev skills off`
- **THEN** an error naming `EACCES` is reported, `state.json` is unchanged, and no `state.json.bad` exists (skipped when the test runs as root, which ignores file modes)

#### Scenario: Malformed state recovered by a change
- **WHEN** `state.json` is malformed and the operator runs `/jev skills off`
- **THEN** the old bytes move to `state.json.bad`, and `state.json` holds only `version` and `switches.skills` `false`

### Requirement: Usage text for other input
Any other argument SHALL produce usage text as a warning and change nothing. The usage text MUST list exactly the forms `/jev`, `/jev <feature> on|off` with the eight feature names, `/jev all on|off`, `/jev mode budget|standard|premium [global]`, `/jev mode clear`, `/jev reset`, `/jev cli-review on|off`, `/jev cli-review <codex|opencode> [model|default] [effort|default]`, `/jev <slot> <provider/model> [when <text>]`, `/jev <slot>`, `/jev remove <slot>` and `/jev tune [undo|reset|on|off]`. A first word that is `tune` MUST be handled by the tune forms (see `tune-command`). A first word that is a valid, non-reserved slot name, or `remove`, MUST be handled by the slot forms (see `slot-commands`), not by this requirement. Arguments are split on whitespace and matched case-sensitively; extra words make the input unknown, except the text after `when` in the slot add form.

#### Scenario: Command from a later work group
<!-- Intentional change: WG-18 adds the tune forms, so `/jev tune` is no longer usage. -->
- **WHEN** the operator runs `/jev tune`
- **THEN** the tune report is shown as info, not usage text, and `state.json` is unchanged

#### Scenario: Usage lists the tune form
- **WHEN** usage text is reported
- **THEN** it contains `/jev tune [undo|reset|on|off]`

#### Scenario: Unknown mode
- **WHEN** the operator runs `/jev mode quality`, `/jev mode Premium`, `/jev mode`, `/jev mode premium now`, `/jev mode premium Global`, `/jev mode global`, `/jev mode clear now`, `/jev mode Clear` or `/jev mode premium session`
- **THEN** usage text is reported, and neither `state.json` nor `<cwd>/.pi/jev-mode.json` is created or changed

#### Scenario: Usage lists the mode form
- **WHEN** usage text is reported
- **THEN** it contains `/jev mode budget|standard|premium [global]` and `/jev mode clear`

#### Scenario: Unknown feature
<!-- Intentional change: lower-case `colors` is now slot-shaped; see `slot-commands` "Name-shaped typo of a feature". -->
- **WHEN** the operator runs `/jev Colors off`
- **THEN** usage text is reported and `state.json` is unchanged

#### Scenario: Bad value
- **WHEN** the operator runs `/jev skills maybe`
- **THEN** usage text is reported and `state.json` is unchanged

#### Scenario: Extra words
- **WHEN** the operator runs `/jev skills off now`
- **THEN** usage text is reported and `state.json` is unchanged

#### Scenario: Extra words after cli-review
- **WHEN** the operator runs `/jev cli-review codex luna high now`
- **THEN** usage text is reported and `state.json` is unchanged

#### Scenario: Removed review switch
- **WHEN** the operator runs `/jev review off` or `/jev review on`
- **THEN** usage text is reported as a warning and `state.json` is unchanged

#### Scenario: Extra words after cli-review off
- **WHEN** the operator runs `/jev cli-review off now`
- **THEN** usage text is reported and `state.json` is unchanged

#### Scenario: Usage lists the cli-review switch
- **WHEN** usage text is reported
- **THEN** it contains `/jev cli-review on|off`

#### Scenario: Whitespace only
- **WHEN** the operator runs `/jev` followed only by spaces
- **THEN** the status is reported, as with no argument

#### Scenario: Usage lists the slot forms
- **WHEN** usage text is reported
- **THEN** it contains `/jev <slot> <provider/model> [when <text>]`, `/jev <slot>` and `/jev remove <slot>`

### Requirement: Command failures stay inside the package
An unexpected error while running `/jev` MUST be caught inside the package. It SHALL be reported as an error notification when `ctx.hasUI`, and MUST NOT propagate to Pi or print anything in print or JSON mode.

#### Scenario: Throwing tool list
- **WHEN** `getAllTools` throws while `/jev` builds the status
- **THEN** the handler returns normally and, with a UI, one error notification is shown

### Requirement: Output channel
`/jev` output SHALL go through `ctx.ui.notify` only when `ctx.hasUI` is true. In print and JSON modes it MUST print nothing; a state change requested there MUST still be applied. `/jev` output MUST NOT be added to the conversation or sent to the model.

#### Scenario: RPC notify
- **WHEN** `/jev` runs in RPC mode
- **THEN** one `extension_ui_request` with method `notify` and type `info` carries the report, and no message is added to the session

#### Scenario: Print mode is silent
- **WHEN** Pi runs `/jev skills off` with `-p`
- **THEN** stdout holds nothing from the package and `state.json` holds `switches.skills` `false`

### Requirement: Inert in a child session
`/jev` SHALL do nothing in a child session: no output, no state change, no widget update.

#### Scenario: Command in a child
- **WHEN** the `/jev` handler runs with a session id that the child registry holds
- **THEN** it returns without calling notify, writing state or setting a widget

### Requirement: CLI review default
`/jev cli-review <codex|opencode> [<model>|default] [<effort>|default]` SHALL replace the CLI review default in `state.json` and set `cliReviewEnabled` to `true`, in one update through the state store, leaving other state fields unchanged. A refused or failed change MUST write neither. A model or effort that is omitted or `default` MUST be left unset. After a change the command SHALL report the status and refresh the status line. A value outside the state rules MUST be refused with the store's problem. The command MUST NOT call Jev.

#### Scenario: Bare reviewer
- **WHEN** the operator runs `/jev cli-review opencode`
- **THEN** `state.json` holds `cliReview` `{"cli":"opencode"}` and `cliReviewEnabled` `true`

#### Scenario: Choosing a reviewer turns the review on
- **WHEN** the state holds `cliReviewEnabled` `false` and the operator runs `/jev cli-review codex`
- **THEN** `state.json` holds `cliReviewEnabled` `true` and the report contains `cli review: on (codex, CLI defaults)`

#### Scenario: Default clears the model
- **WHEN** the state holds `cliReview` `{"cli":"codex","model":"luna","effort":"high"}` and the operator runs `/jev cli-review codex default`
- **THEN** `state.json` holds `cliReview` `{"cli":"codex"}`, and no model list is read

#### Scenario: Unknown CLI
- **WHEN** the operator runs `/jev cli-review claude`
- **THEN** usage text is reported as a warning and `state.json` is unchanged

#### Scenario: No reviewer named
- **WHEN** the operator runs `/jev cli-review`
- **THEN** usage text is reported as a warning and `state.json` is unchanged

#### Scenario: Reviewer name is case-sensitive
- **WHEN** the operator runs `/jev cli-review Codex`
- **THEN** usage text is reported as a warning and `state.json` is unchanged

#### Scenario: Value outside the state rules
- **WHEN** the operator runs `/jev cli-review codex -m`
- **THEN** an error names `cliReview.model`, and `state.json` is unchanged

#### Scenario: Refused model leaves the review off
- **WHEN** the state holds `cliReviewEnabled` `false` and the operator runs `/jev cli-review codex nova`, which the Codex list does not hold
- **THEN** an error is reported and `state.json` still holds `cliReviewEnabled` `false`

### Requirement: Codex model check
Before storing a Codex model, `/jev cli-review` SHALL read `codex debug models` through `pi.exec` with a 30-second timeout. The model MUST match, ignoring case, a tier, slug or display name of a model whose `visibility` is `list` or absent; a tier is stored as typed, anything else as its slug. A given effort MUST be in that model's `supported_reasoning_levels`. A failed check SHALL be refused with up to five suggestions, and nothing is written.

#### Scenario: Codex tier stored as a tier
- **WHEN** the Codex list has `gpt-6-luna` with efforts `low`, `high` and the operator runs `/jev cli-review codex luna high`
- **THEN** `state.json` holds `cliReview` `{"cli":"codex","model":"luna","effort":"high"}` and the report shows the CLI review default

#### Scenario: Tier in another case
- **WHEN** the Codex list has `gpt-6-luna` and the operator runs `/jev cli-review codex Luna`
- **THEN** `state.json` holds `cliReview` `{"cli":"codex","model":"Luna"}`

#### Scenario: Codex display name stored as its slug
- **WHEN** the Codex list has slug `gpt-5.6-luna` named `GPT-5.6-Luna` and the operator runs `/jev cli-review codex GPT-5.6-Luna`
- **THEN** `state.json` holds `cliReview` `{"cli":"codex","model":"gpt-5.6-luna"}`

#### Scenario: Unknown Codex model
- **WHEN** the operator runs `/jev cli-review codex nova`
- **THEN** an error names suggestions from the Codex tiers, and `state.json` is unchanged

#### Scenario: Codex effort without a model
- **WHEN** the operator runs `/jev cli-review codex default high`
- **THEN** `state.json` holds `cliReview` `{"cli":"codex","effort":"high"}` and no model list is read

#### Scenario: Unsupported Codex effort
- **WHEN** `gpt-6-luna` lists efforts `low`, `high` and the operator runs `/jev cli-review codex luna ultra`
- **THEN** an error lists `low`, `high`, and `state.json` is unchanged

### Requirement: OpenCode model check
Before storing an OpenCode model, `/jev cli-review` SHALL read `opencode models` through `pi.exec` with a 30-second timeout. The model MUST be a listed `provider/model` id, or a name exactly one provider lists, stored as the full id. An effort without a model MUST be refused. The effort is not checked. A failed check SHALL be refused with an error naming up to five candidate ids, and nothing is written.

#### Scenario: OpenCode model by name
- **WHEN** `opencode models` lists only `ollama-cloud/glm-5.3` ending in `/glm-5.3` and the operator runs `/jev cli-review opencode glm-5.3 high`
- **THEN** `state.json` holds `cliReview` `{"cli":"opencode","model":"ollama-cloud/glm-5.3","effort":"high"}`

#### Scenario: OpenCode name with two providers
- **WHEN** `opencode models` lists `a/glm-5.3` and `b/glm-5.3` and the operator runs `/jev cli-review opencode glm-5.3`
- **THEN** an error names both ids, and `state.json` is unchanged

#### Scenario: OpenCode effort without a model
- **WHEN** the operator runs `/jev cli-review opencode default high`
- **THEN** an error says an OpenCode effort needs a model, and `state.json` is unchanged

### Requirement: Unreadable model list
When the model list cannot be read (non-zero exit, timeout, or nothing parsed), `/jev cli-review` SHALL store the values as typed and report a warning that they were not checked.

#### Scenario: List unreadable
- **WHEN** `codex debug models` exits non-zero and the operator runs `/jev cli-review codex luna high`
- **THEN** `state.json` holds `cliReview` `{"cli":"codex","model":"luna","effort":"high"}` and a warning says the model was not checked

#### Scenario: OpenCode list unreadable
- **WHEN** `opencode` is not on `PATH` and the operator runs `/jev cli-review opencode p/m`
- **THEN** `state.json` holds `cliReview` `{"cli":"opencode","model":"p/m"}` and a warning says the model was not checked

### Requirement: Mode
<!-- Intentional change: `/jev mode <m>` now targets the current directory; the global form needs `global`. The scenarios "Set premium", "Mode survives a restart" and "Back to standard" now use the `global` form, which carries the old behaviour. -->
`/jev mode <m>`, where `<m>` is `budget`, `standard` or `premium`, SHALL set the directory mode of the current directory (see `directory-mode`). `/jev mode <m> global` SHALL set `mode` in `state.json` through the state store, leaving other fields unchanged. Either form then reports the new status and refreshes the status line, and MUST NOT call Jev. The new mode SHALL apply from the next worker launch; launches already classified keep the mode they were classified with. A global mode MUST still apply after Pi restarts. While the current directory has a directory mode, the global form MUST leave it unchanged and in effect, and the report MUST add the line `directory mode <d> still applies here; global mode is now <m>`.

#### Scenario: Set premium
- **WHEN** the operator runs `/jev mode premium global`
- **THEN** `state.json` holds `mode` `premium`, other fields are unchanged, no `<cwd>/.pi/jev-mode.json` is created, the report names mode `premium`, and, with the key set and the config valid, the status line reads `Jev · premium`

#### Scenario: Mode survives a restart
- **WHEN** the operator runs `/jev mode budget global`, Pi exits, a new Pi process starts with the same agent directory in a directory without a directory mode, and `/jev` runs
- **THEN** the report names mode `budget`

#### Scenario: Back to standard
- **WHEN** the global mode is `budget` and the operator runs `/jev mode standard global`
- **THEN** `state.json` holds `mode` `standard`

#### Scenario: Plain form targets the directory
- **WHEN** `state.json` sets the mode to `standard` and the operator runs `/jev mode premium`
- **THEN** `state.json` is unchanged, `<cwd>/.pi/jev-mode.json` holds `premium`, and the report contains `mode: premium (this directory; global standard)`

#### Scenario: Global set keeps the directory mode
- **WHEN** the directory mode is `budget` and the operator runs `/jev mode premium global`
- **THEN** `state.json` holds `mode` `premium`, `<cwd>/.pi/jev-mode.json` still holds `budget`, the report contains `mode: budget (this directory; global premium)` and `directory mode budget still applies here; global mode is now premium`, and, with the key set and the config valid, the status line reads `Jev · budget (local)`

#### Scenario: Refused mode change
- **WHEN** `state.json` has mode `0000` and the operator runs `/jev mode premium global`
- **THEN** an error naming `EACCES` is reported and `state.json` is unchanged

### Requirement: CLI review switch
`/jev cli-review on|off` SHALL set `cliReviewEnabled` in `state.json` through the state store, leaving other state fields unchanged, including `cliReview`. It SHALL then report the status, refresh the status line, and bring the session's active tools in line with the new setting (see `cli-review`). The setting MUST still apply after Pi restarts. The command MUST NOT call Jev or read a model list. A refused change SHALL be reported as under "Refused changes".

#### Scenario: Turn the CLI review off
- **WHEN** the state holds `cliReview` `{"cli":"opencode","model":"p/m"}` and `cliReviewEnabled` `true`, and the operator runs `/jev cli-review off`
- **THEN** `state.json` holds `cliReviewEnabled` `false` and the same `cliReview`, and the report contains `cli review: off (opencode, model p/m)`

#### Scenario: Turn the CLI review on
- **WHEN** the state has no `cliReviewEnabled` and the operator runs `/jev cli-review on`
- **THEN** `state.json` holds `cliReviewEnabled` `true`, no `cliReview` is added, no process runs, and the report contains `cli review: on (codex, CLI defaults)`

#### Scenario: Switch survives a restart
- **WHEN** the operator runs `/jev cli-review on`, Pi exits, a new Pi process starts with the same agent directory and `/jev` runs
- **THEN** the report contains `cli review: on`

#### Scenario: Switch is case-sensitive
- **WHEN** the operator runs `/jev cli-review OFF`
- **THEN** usage text is reported as a warning and `state.json` is unchanged

#### Scenario: Refused switch
- **WHEN** `state.json` has mode `0000` and the operator runs `/jev cli-review on`
- **THEN** an error naming `EACCES` is reported and `state.json` is unchanged (skipped when the test runs as root)

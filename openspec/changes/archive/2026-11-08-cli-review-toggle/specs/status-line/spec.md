## MODIFIED Requirements

### Requirement: Status line text
In a main session, the status line SHALL show the first that applies of: `Jev · config error` (config invalid), `Jev · no key` (key not set), `Jev · off` (all six decision features `effort`, `subagents`, `skills`, `strategy`, `tools`, `expert` off), and `Jev · <mode>` with the effective mode.

When the text is `Jev · <mode>`, suffixes follow in this order:
- **Effort suffix.** When `effort` is on and a main decision has been made in this session, ` · <level>` MUST follow, with the effective level of the latest applied, kept or held decision. ` · no answer` MUST follow instead when the latest request was not held and was a miss (whatever was asked), or asked `effort` and left it unanswered. A held turn MUST show the level in force, whether or not Jev answered. A discarded or cancelled decision, and an answered request that did not ask `effort` and was not held, MUST leave this suffix as it was.
- **Advice suffix.** When `strategy` is on and the latest decided request that asked `strategy` attached advice, ` · <strategy>` MUST follow, with the attached strategy. A later decided request that asked `strategy` and attached none, or a miss, MUST remove it. A request that did not ask `strategy` MUST leave it as it was. A discarded effort result MUST NOT affect it, and a held turn sets or removes it like any other turn. A cancelled decision MUST leave both suffixes as they were. While `strategy` is off the advice suffix MUST NOT be shown; turning `strategy` back on shows the latest kept advice again, as the effort suffix does for `effort`.

- **Tally form.** When an eligible prompt's Jev request completes (answered, missed or held, not cancelled) while the session tally counts a number of prompts one short of a multiple of 10 (so this prompt is the 10th, 20th, ...), the line MUST read `Jev · <mode> · <P> prompts · <W> workers · <F> fallbacks` instead, with `P` the tally's prompts plus one and `W`, `F` the tally's workers and fallbacks, whether or not the result changed the suffixes. It replaces both the level and the advice suffix and is shown whatever the `effort` switch says. An eligible prompt is any prompt Jev decides, that is, one with `effort` or `strategy` on. The tally form MUST last only until the next eligible prompt's Jev request completes (not cancelled), which then shows the suffixes as the rules above set them; a cancelled prompt leaves the line as it was. Prompts with `effort` and `strategy` both off are not eligible, so they never show the tally form.

A session start MUST clear all suffixes and the tally form. Drawing the line MUST make no network call.

#### Scenario: Ready with the default mode
- **WHEN** the config is valid, the key is set, no switch is changed and no mode is set
- **THEN** the status line reads `Jev · standard`

#### Scenario: Mode from state
- **WHEN** the key is set and `state.json` sets the mode to `premium`
- **THEN** the status line reads `Jev · premium`

#### Scenario: No key
- **WHEN** the config is valid and the environment variable named by `classifier.apiKeyEnv` is unset or empty
- **THEN** the status line reads `Jev · no key`

#### Scenario: Config error wins over no key
- **WHEN** `config.json` is invalid and the key is unset
- **THEN** the status line reads `Jev · config error`

#### Scenario: Everything off
- **WHEN** the config is valid, the key is set and all six decision features are off
- **THEN** the status line reads `Jev · off`

#### Scenario: One feature off is not off
- **WHEN** the key is set and only `skills` is off
- **THEN** the status line reads `Jev · standard`

#### Scenario: No executor is not shown
- **WHEN** the config is valid, the key is set and no installed extension registers a `subagent` tool
- **THEN** the status line reads `Jev · standard`

#### Scenario: Malformed state uses defaults
- **WHEN** the key is set and `state.json` is malformed
- **THEN** the status line reads `Jev · standard`

#### Scenario: After a decision
- **WHEN** a main decision applied `high` and attached no advice
- **THEN** the status line reads `Jev · standard · high`

#### Scenario: After a decision with advice
- **WHEN** a main decision applied `high` and attached advice for `delegate`
- **THEN** the status line reads `Jev · standard · high · delegate`

#### Scenario: Advice with effort off
- **WHEN** `effort` is off and a main decision attached advice for `parallel`
- **THEN** the status line reads `Jev · standard · parallel`

#### Scenario: Advice cleared by the next turn
- **WHEN** the previous decision showed `high · delegate` and the next decision applied `medium` and attached no advice
- **THEN** the status line reads `Jev · standard · medium`

#### Scenario: Strategy switched off
- **WHEN** a decision showed `high · delegate` and the operator runs `/jev strategy off`
- **THEN** the redrawn status line reads `Jev · standard · high`

#### Scenario: Discarded effort with advice
- **WHEN** the previous decision showed `high`, and the next result is discarded on a manual change and attached advice for `delegate`
- **THEN** the status line reads `Jev · standard · high · delegate`

#### Scenario: Strategy switched back on
- **WHEN** a decision showed `high · delegate`, and the operator runs `/jev strategy off` then `/jev strategy on`
- **THEN** the redrawn status line reads `Jev · standard · high · delegate`

#### Scenario: After a miss
- **WHEN** the latest main request was not held and timed out
- **THEN** the status line reads `Jev · standard · no answer`

#### Scenario: Discarded keeps the previous suffix
- **WHEN** the previous decision showed `high` and the next result is discarded and attached no advice
- **THEN** the status line still reads `Jev · standard · high`

#### Scenario: Miss on a non-reasoning model
- **WHEN** the model is not a reasoning model, `strategy` is off, and the request asking only `corrects` times out
- **THEN** the status line reads `Jev · standard · no answer`

#### Scenario: Answered without effort keeps the suffix
- **WHEN** the previous decision showed `high`, `strategy` is off, and an answered request on a non-reasoning model asked only `corrects`
- **THEN** the status line still reads `Jev · standard · high`

#### Scenario: Held turn shows the level in force
- **WHEN** a session resumed on a listed provider with an anchor at `high`, with no suffix yet, and the next prompt is held
- **THEN** the status line reads `Jev · standard · high`

#### Scenario: Held turn with advice
- **WHEN** a prompt is held at `high` and Jev answers `strategy` `delegate` with probability 0.9
- **THEN** the status line reads `Jev · standard · high · delegate`

#### Scenario: Held miss shows the level
- **WHEN** a prompt is held at `high` and its Jev request times out
- **THEN** the status line reads `Jev · standard · high`

#### Scenario: Kept across /jev
- **WHEN** a decision applied `high` and the operator runs `/jev skills off`
- **THEN** the redrawn status line reads `Jev · standard · high`

#### Scenario: Effort switched off
- **WHEN** a decision applied `high`, attached no advice, and the operator runs `/jev effort off`
- **THEN** the redrawn status line reads `Jev · standard`

#### Scenario: Session start clears the suffix
- **WHEN** a decision showed `high · delegate` and the operator starts a new session
- **THEN** the status line reads `Jev · standard`

#### Scenario: Base state wins
- **WHEN** a decision applied `high` and the operator then runs `/jev all off`
- **THEN** the status line reads `Jev · off`

#### Scenario: Tally on the 10th prompt
- **WHEN** nine decided prompts have settled, two workers were recorded, one of them a fallback, and the 10th prompt's decision applies `high`
- **THEN** the status line reads `Jev · standard · 10 prompts · 2 workers · 1 fallbacks`

#### Scenario: Ninth prompt shows the level
- **WHEN** eight decided prompts have settled and the 9th prompt's decision applies `high`
- **THEN** the status line reads `Jev · standard · high`

#### Scenario: Eleventh prompt shows the level again
- **WHEN** the 10th prompt showed the tally and the 11th prompt's decision applies `medium`
- **THEN** the status line reads `Jev · standard · medium`

#### Scenario: Tally kept across /jev
- **WHEN** the 10th prompt showed the tally and the operator runs `/jev skills off`
- **THEN** the redrawn status line still shows the tally form

#### Scenario: Tally on a miss
- **WHEN** nine decided prompts have settled and the 10th prompt's Jev request times out
- **THEN** the status line reads `Jev · standard · 10 prompts · 0 workers · 0 fallbacks`

#### Scenario: Tally on a discarded 10th prompt
- **WHEN** nine decided prompts have settled with the last applying `high`, and the 10th prompt's result is discarded
- **THEN** the status line reads `Jev · standard · 10 prompts · 0 workers · 0 fallbacks`, and when the 11th prompt is answered without `effort` it reads `Jev · standard · high`

#### Scenario: Nothing decided never shows the tally
- **WHEN** `effort` and `strategy` are off, another decision feature is on, and the operator sends ten prompts
- **THEN** the status line reads `Jev · standard` throughout

#### Scenario: Strategy-only session shows the tally
- **WHEN** `effort` is off, `strategy` is on, and nine decided prompts have settled and the 10th prompt's request completes
- **THEN** the status line reads `Jev · standard · 10 prompts · 0 workers · 0 fallbacks`

#### Scenario: Tally replaces both suffixes
- **WHEN** the previous line read `Jev · standard · high · delegate`, and the 10th prompt's request completes with two workers and one fallback recorded
- **THEN** the status line reads `Jev · standard · 10 prompts · 2 workers · 1 fallbacks`, and when the 11th prompt is answered `medium` with advice `delegate` it reads `Jev · standard · medium · delegate`

#### Scenario: Cancelled 11th prompt keeps the tally
- **WHEN** the 10th prompt showed the tally form and the 11th prompt's Jev request is cancelled
- **THEN** the status line still shows the tally form

#### Scenario: Cancelled keeps both suffixes
- **WHEN** the previous decision showed `high · delegate` and the operator aborts the next prompt before any provider request
- **THEN** the status line reads `Jev · standard · high · delegate`

### Requirement: Status line placement and refresh
The status line SHALL be a widget with key `jev` placed above the editor. It MUST be drawn when a main session starts, for every start reason, again after every `/jev` run, and again after every main decision that changes its text. In the terminal UI the text MUST be right-aligned to the widget width; in RPC mode it MUST be sent as a single-line string list.

#### Scenario: Drawn at session start in RPC mode
- **WHEN** a main session starts in RPC mode with the key set
- **THEN** an `extension_ui_request` with `method` `setWidget`, `widgetKey` `jev`, `widgetLines` `["Jev · standard"]` and `widgetPlacement` `aboveEditor` is emitted

#### Scenario: Right-aligned in the terminal UI
- **WHEN** the line `Jev · standard` is rendered by the terminal component at width 40
- **THEN** it renders one line of 40 columns ending in `Jev · standard`, padded with spaces on the left

#### Scenario: Narrow terminal
- **WHEN** the terminal component renders at a width smaller than the text
- **THEN** it renders the text unpadded, cut to the width

#### Scenario: Refreshed after a switch change
- **WHEN** the key is set, every decision feature but `expert` is off, and the operator runs `/jev expert off`
- **THEN** the widget is set again with `Jev · off`

#### Scenario: Refreshed after a decision
- **WHEN** a main decision applies `xhigh` in RPC mode
- **THEN** a `setWidget` request for `jev` with `widgetLines` `["Jev · standard · xhigh"]` is emitted before the turn's first provider request


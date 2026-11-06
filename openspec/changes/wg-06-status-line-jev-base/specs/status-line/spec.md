## ADDED Requirements

### Requirement: Status line text
In a main session, the status line SHALL show the first that applies of: `Jev · config error` (config invalid), `Jev · no key` (key not set), `Jev · off` (all seven decision features `effort`, `subagents`, `skills`, `strategy`, `tools`, `expert`, `review` off), and `Jev · <mode>` with the effective mode. Drawing the line MUST make no network call.

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
- **WHEN** the config is valid, the key is set and all seven decision features are off
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

### Requirement: Status line placement and refresh
The status line SHALL be a widget with key `jev` placed above the editor. It MUST be drawn when a main session starts, for every start reason, and again after every `/jev` run. In the terminal UI the text MUST be right-aligned to the widget width; in RPC mode it MUST be sent as a single-line string list.

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
- **WHEN** the key is set, every decision feature but `review` is off, and the operator runs `/jev review off`
- **THEN** the widget is set again with `Jev · off`

### Requirement: Status switch clears the line
When the `status` feature is off, the status line SHALL be cleared instead of drawn, and turning it back on MUST draw it again at the next refresh. The `status` switch MUST NOT affect `/jev`.

#### Scenario: Status off
- **WHEN** the operator runs `/jev status off`
- **THEN** the widget `jev` is set to no content, and `/jev` still reports the status

#### Scenario: Status off at start
- **WHEN** a main session starts with `status` off in `state.json`
- **THEN** no `setWidget` request for `jev` carries `widgetLines`; a request that clears it is allowed

### Requirement: Refresh failures stay inside the package
An unexpected error while building or drawing the status line (for example `getAllTools` or `setWidget` throwing) MUST be caught inside the package. It MUST NOT propagate to Pi, stop the session from starting, or produce output in print or JSON mode. The status line is then left as it was.

#### Scenario: Throwing widget call
- **WHEN** `setWidget` throws during the `session_start` refresh
- **THEN** the handler returns normally and the session starts

### Requirement: No drawing without a UI or in a child
The status line MUST NOT be drawn, set or cleared when `ctx.hasUI` is false (print and JSON modes), or in a child session.

#### Scenario: Print mode
- **WHEN** Pi runs one prompt with `-p` and the package installed
- **THEN** stdout holds no status line text and the run behaves as without the package

#### Scenario: JSON mode
- **WHEN** Pi runs one prompt with `--mode json` and the package installed
- **THEN** the event stream holds no record that carries the `jev` widget or the text `Jev ·`

#### Scenario: Child session
- **WHEN** the executor starts a child session in the same process
- **THEN** the child's `session_start` draws nothing, and the only `jev` widget requests come from the main session

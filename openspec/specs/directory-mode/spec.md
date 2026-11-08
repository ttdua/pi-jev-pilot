# directory-mode Specification

## Purpose
The per-directory worker mode set with `/jev mode <m>` and cleared with `/jev mode clear`: kept in `<cwd>/.pi/jev-mode.json`, read on every snapshot, winning over the global mode in every main session in that directory, ignored and reported when damaged, and inert in a child session.

## Requirements

### Requirement: Set the directory mode
`/jev mode <m>`, where `<m>` is `budget`, `standard` or `premium`, SHALL write `<m>` to `<cwd>/.pi/jev-mode.json`, with `<cwd>` the session's working directory, then report the status and refresh the status line. It MUST NOT write `state.json` or `config.json`, and MUST NOT call Jev. The mode SHALL apply from the next worker launch in every main session whose working directory is `<cwd>`.

#### Scenario: Set a directory mode
- **WHEN** `state.json` sets the mode to `standard` and the operator runs `/jev mode premium`
- **THEN** `<cwd>/.pi/jev-mode.json` holds `premium`, `state.json` is unchanged, the report contains `mode: premium (this directory; global standard)`, and, with the key set and the config valid, the status line reads `Jev · premium (local)`

#### Scenario: Next launch uses the directory mode
- **WHEN** the directory mode is `budget`, `state.json` sets the mode to `premium`, and a worker launch is classified
- **THEN** the launch is routed with the `budget` cut points, and its ledger line holds `mode` `budget`

#### Scenario: Set while state is unreadable
- **WHEN** `state.json` has mode `0000` and the operator runs `/jev mode budget`
- **THEN** `<cwd>/.pi/jev-mode.json` holds `budget`, `state.json` is unchanged, and the report shows `budget` for this directory with the state problem listed

#### Scenario: Directory not writable
- **WHEN** `<cwd>/.pi` cannot be created or written and the operator runs `/jev mode premium`
- **THEN** an error naming the error code and `.pi/jev-mode.json` is reported, nothing else changes, and the status line is not redrawn

### Requirement: Clear the directory mode
`/jev mode clear` SHALL remove `<cwd>/.pi/jev-mode.json`, then report the status and refresh the status line, so the global mode applies again from the next worker launch. With no such file, it SHALL report `no directory mode set` as info and change nothing. It MUST NOT write `state.json` and MUST NOT call Jev.

#### Scenario: Clear back to the global mode
- **WHEN** the directory mode is `premium`, `state.json` sets the mode to `budget`, and the operator runs `/jev mode clear`
- **THEN** `<cwd>/.pi/jev-mode.json` no longer exists, the report contains `mode: budget` with no `(this directory` text, and, with the key set and the config valid, the status line reads `Jev · budget`

#### Scenario: Nothing to clear
- **WHEN** there is no `<cwd>/.pi/jev-mode.json` and the operator runs `/jev mode clear`
- **THEN** `no directory mode set` is reported as info, and no file is created

#### Scenario: Clear removes a damaged file
- **WHEN** `<cwd>/.pi/jev-mode.json` is not valid JSON and the operator runs `/jev mode clear`
- **THEN** the file no longer exists and the report lists no `local mode` problem

### Requirement: Directory mode file
`<cwd>/.pi/jev-mode.json` SHALL hold exactly `{"version":1,"mode":"<m>"}` with `<m>` a mode name, and nothing else: no prompt text, no session id, no time. It SHALL be written atomically, creating `<cwd>/.pi/` when missing. The package MUST NOT create or change any other file in `<cwd>`, including `.gitignore`.

#### Scenario: File content
- **WHEN** the operator runs `/jev mode budget`
- **THEN** `<cwd>/.pi/jev-mode.json` parses to exactly `{"version":1,"mode":"budget"}`

#### Scenario: No other project file touched
- **WHEN** `<cwd>` holds a `.gitignore` and the operator runs `/jev mode premium` then `/jev mode clear`
- **THEN** `.gitignore` is unchanged and no file other than `.pi/jev-mode.json` was created in `<cwd>`

### Requirement: Directory mode applies to every session in the directory
The directory mode SHALL be read from `<cwd>/.pi/jev-mode.json` each time settings are built, with `<cwd>` the working directory of the command's session, or of the newest main session when no session context is at hand. It SHALL apply to every main session with that working directory, whether new, resumed, forked or reloaded, and to every Pi process in it. A main session in another directory MUST NOT use it. Reading it MUST make no network call.

#### Scenario: New session uses it
- **WHEN** the operator sets the directory mode `premium`, quits Pi, and starts a new session in the same directory
- **THEN** `/jev` reports `mode: premium (this directory; global standard)` before any prompt

#### Scenario: Set before the first message
- **WHEN** a fresh session sets the directory mode `budget` with no prompt sent, Pi exits, and Pi starts again in the same directory
- **THEN** `/jev` reports `budget` for this directory

#### Scenario: Other directory keeps the global mode
- **WHEN** directory A has the directory mode `premium` and a Pi process with the same agent directory runs `/jev` in directory B
- **THEN** B's report contains `mode: standard`, with no `(this directory` text

#### Scenario: Second process sees a change
- **WHEN** two Pi processes run in the same directory and one runs `/jev mode budget`
- **THEN** `/jev` in the other reports `budget` for this directory

#### Scenario: Subdirectory is separate
- **WHEN** `<cwd>` has the directory mode `premium` and a session runs in `<cwd>/sub` with no file of its own
- **THEN** that session uses the global mode

### Requirement: Damaged directory mode file
A `<cwd>/.pi/jev-mode.json` that cannot be read, is not valid JSON, or does not match the file rule SHALL count as no directory mode, so the global mode applies. `/jev` SHALL list it as a `local mode (malformed)` or `local mode (unreadable)` problem, with its field path. It MUST NOT stop Pi or the package. `/jev mode <m>` SHALL overwrite it.

#### Scenario: Unknown mode name
- **WHEN** the file holds `{"version":1,"mode":"ultra"}` and `/jev` runs
- **THEN** the report contains `mode: standard` and a `local mode (malformed)` problem at `mode`

#### Scenario: Overwrite a damaged file
- **WHEN** the file is not valid JSON and the operator runs `/jev mode premium`
- **THEN** the file holds `premium` and the report lists no `local mode` problem

### Requirement: Inert in a child session
A child session SHALL read and write no directory mode file of its own, and its `session_start` MUST NOT change which directory the main session reads. Worker launches SHALL be classified with the parent session's effective mode.

#### Scenario: Command in a child
- **WHEN** `/jev mode premium` runs with a session id that the child registry holds
- **THEN** no file is written, no notification is shown and the parent's mode is unchanged

#### Scenario: Child start in another directory
- **WHEN** the main session runs in `<cwd>` with the directory mode `budget`, and a child session starts with a different working directory
- **THEN** the parent's next worker launch is still routed with `budget`

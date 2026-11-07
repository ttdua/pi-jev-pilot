## ADDED Requirements

### Requirement: Set a session mode
`/jev mode <m> session`, where `<m>` is `budget`, `standard` or `premium`, SHALL set the session mode of the current main session to `<m>` by appending a `jev-mode` session entry, then report the status and refresh the status line. It MUST NOT read or write `state.json` or `config.json`, and MUST NOT call Jev or any other network service. The new session mode SHALL apply from the next worker launch in this session; launches already classified keep their mode.

#### Scenario: Set a session mode
- **WHEN** `state.json` sets the mode to `standard` and the operator runs `/jev mode premium session`
- **THEN** one `jev-mode` entry with `mode` `premium` is appended, `state.json` is unchanged, the report contains `mode: premium (session; saved standard)`, and, with the key set and the config valid, the status line reads `Jev · premium (session)`

#### Scenario: Next launch uses the session mode
- **WHEN** the session mode is `budget`, `state.json` sets the mode to `premium`, and a worker launch is classified
- **THEN** the launch is routed with the `budget` cut points, and its ledger line holds `mode` `budget`

#### Scenario: Set while state is unreadable
- **WHEN** `state.json` has mode `0000` and the operator runs `/jev mode budget session`
- **THEN** the `jev-mode` entry is appended, `state.json` is unchanged, and the report shows `budget` as the session mode with the state problem listed

#### Scenario: Other sessions keep the saved mode
- **WHEN** `state.json` sets no mode, session A sets the session mode `premium`, and session B in another Pi process with the same agent directory runs `/jev`
- **THEN** B's report contains `mode: standard`, with no `(session` text

### Requirement: Clear the session mode
`/jev mode session off` SHALL clear the session mode of the current main session by appending a `jev-mode` entry that clears it, then report the status and refresh the status line, so the saved mode applies again from the next worker launch. With no session mode set, it SHALL report `no session mode set` as info, write no entry and change nothing. It MUST NOT read or write `state.json` and MUST NOT call Jev.

#### Scenario: Clear back to the saved mode
- **WHEN** the session mode is `premium`, `state.json` sets the mode to `budget`, and the operator runs `/jev mode session off`
- **THEN** a clearing `jev-mode` entry is appended, the report contains `mode: budget` with no `(session` text, and, with the key set and the config valid, the status line reads `Jev · budget`

#### Scenario: Nothing to clear
- **WHEN** no session mode is set and the operator runs `/jev mode session off`
- **THEN** `no session mode set` is reported as info, and no entry is appended

### Requirement: Session mode entry
A `jev-mode` entry SHALL be a custom session entry written with `pi.appendEntry`, so it never reaches the model. Its data MUST be exactly `{"mode":"<m>"}` with `<m>` a mode name to set, or `{"mode":null}` to clear. It MUST hold nothing else: no prompt text, no session id, no time. The in-memory session mode SHALL change only after the append succeeds. When the append throws, the error SHALL be reported as an `/jev` failure and the session mode MUST stay as it was.

#### Scenario: Entry content
- **WHEN** the operator runs `/jev mode budget session`
- **THEN** the appended entry has custom type `jev-mode` and data `{"mode":"budget"}`

#### Scenario: Append fails
- **WHEN** `pi.appendEntry` throws while the operator runs `/jev mode premium session`
- **THEN** one error notification is shown, the handler returns normally, and the effective mode is unchanged

### Requirement: Session mode from the branch
The session mode SHALL be the `mode` of the newest valid `jev-mode` entry on the current session branch, or none when that entry clears it or none exists. An entry is valid when its data is an object whose `mode` is a mode name or `null`; others MUST be skipped. It SHALL be rebuilt from `ctx.sessionManager.getBranch()` at every main `session_start`, for every reason, and after every `session_tree`, with no network call. The status line SHALL be redrawn after the `session_tree` rebuild.

#### Scenario: Survives resume
- **WHEN** `state.json` sets no mode, the operator sets the session mode `premium`, quits Pi, and resumes that session
- **THEN** `/jev` reports `mode: premium (session; saved standard)` before any new prompt

#### Scenario: Survives reload
- **WHEN** the session mode is `budget` and the operator runs `/reload`
- **THEN** `/jev` reports `budget` as the session mode

#### Scenario: Fork carries the session mode
- **WHEN** the session mode is `premium` and the operator forks the session from an entry after the `jev-mode` entry
- **THEN** in the forked session `/jev` reports `premium` as the session mode

#### Scenario: Tree navigation before the entry
- **WHEN** the session mode `premium` was set after entry E, and the operator navigates with `/tree` to E
- **THEN** `/jev` reports no session mode, and the status line shows the saved mode without `(session)`

#### Scenario: New session starts without one
- **WHEN** the session mode is `premium` and the operator starts a new session
- **THEN** the new session has no session mode

#### Scenario: Damaged entry skipped
- **WHEN** the branch holds a `jev-mode` entry with `mode` `budget`, then a newer one with `mode` `ultra`
- **THEN** the session mode is `budget`

#### Scenario: Clear is the newest
- **WHEN** the branch holds `{"mode":"premium"}`, then a newer `{"mode":null}`
- **THEN** there is no session mode

### Requirement: Session mode belongs to its session
A session mode SHALL apply only to the main session whose branch holds it. Settings built for any other session id, and settings built before the first rebuild of a new session, MUST use no session mode.

#### Scenario: Worker in a new session
- **WHEN** session A has the session mode `premium`, the operator starts session B, and a worker launch is classified in B
- **THEN** the launch is routed with B's saved mode

### Requirement: Inert in a child session
A child session SHALL keep no session mode and write no `jev-mode` entry. Worker launches SHALL be classified with the parent session's effective mode.

#### Scenario: Command in a child
- **WHEN** `/jev mode premium session` runs with a session id that the child registry holds
- **THEN** no entry is appended, no notification is shown and the parent's session mode is unchanged

#### Scenario: Child start does not rebuild
- **WHEN** a child session starts while the parent has the session mode `budget`
- **THEN** the parent's next worker launch is still routed with `budget`

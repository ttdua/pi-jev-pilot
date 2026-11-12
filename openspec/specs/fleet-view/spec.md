# fleet-view Specification

## Purpose
TBD

## Requirements

### Requirement: Fleet list placement and visibility
In a main session with a UI, the vendored executor SHALL draw a list under the widget key `fleet` with placement `belowEditor` while the `fleetView` setting is on and at least one agent row exists. When no row exists, or `fleetView` is off, it MUST clear that widget. Every rendered line MUST be at most the render width.

#### Scenario: Shown while an agent runs
- **WHEN** `fleetView` is on and one subagent is running with its session ready
- **THEN** the `fleet` widget is set below the editor with a hint line, a `main` row and one agent row

#### Scenario: Cleared when nothing remains
- **WHEN** the last listed agent finished more than 4 seconds ago and no other row exists
- **THEN** the `fleet` widget is cleared

#### Scenario: Off by setting
- **WHEN** `fleetView` is off and agents are running
- **THEN** no `fleet` widget is set

#### Scenario: Narrow terminal
- **WHEN** the list renders at width 20 with a long description
- **THEN** no rendered line is wider than 20 columns

### Requirement: Fleet list layout
The list SHALL render, in order: a hint line, an empty line, the `main` row, the agent rows, and an empty line. The hint SHALL read `esc to interrupt · ← for agents · ↓ to manage` while the list is inactive and `↑↓ select · enter view · esc back` while it is active. Each row SHALL start with `●` when selected and `○` otherwise.

#### Scenario: Inactive layout
- **WHEN** the list is inactive with one agent row
- **THEN** the lines are the inactive hint, an empty line, `○ main`, the agent row and an empty line

#### Scenario: Active hint
- **WHEN** the list is active
- **THEN** the first line reads `↑↓ select · enter view · esc back` and the selected row starts with `●`

### Requirement: Fleet list rows
The list SHALL show one row per subagent record for which both hold: it has a transcript to open (`isSessionReady()` is true or `outputFile` is set); and it is running, or queued, or finished less than 4 seconds ago, or is the agent whose pane, opened from the list, is still open. A finished record outside those 4 seconds MUST NOT be listed, even with its session still held. Foreground and background records MUST both be listed. Rows SHALL be ordered by `startedAt`, earliest first.

#### Scenario: Foreground run listed
- **WHEN** a foreground subagent is running with its session ready
- **THEN** it has a row in the list

#### Scenario: Queued agent without a session is not listed
- **WHEN** a subagent is queued and has neither a session nor an `outputFile`
- **THEN** it has no row

#### Scenario: Earliest first
- **WHEN** agent A started at 1000 and agent B at 500, both running
- **THEN** B's row is above A's

#### Scenario: Settled agent with a held session drops out
- **WHEN** an agent completed 10 seconds ago, its session is still held, and no pane is open on it
- **THEN** it has no row

#### Scenario: Finished agent lingers
- **WHEN** an agent completed 3 seconds ago
- **THEN** its row is shown with its elapsed time frozen at completion

### Requirement: Fleet list row content
Each agent row SHALL show the agent's display name, its description, and right-aligned `<s>s · ↓ <tokens> tokens`, where `<s>` is whole elapsed seconds frozen at `completedAt` and `<tokens>` is the lifetime token total in compact form (`950`, `13.1k`, `1.2M`). The description MUST be truncated before the right-aligned stats.

#### Scenario: Row text
- **WHEN** an agent with display name `Explore` and description `audit auth` has run 12 seconds and used 13100 tokens
- **THEN** its row contains `Explore`, `audit auth` and ends with `12s · ↓ 13.1k tokens`

### Requirement: Fleet list overflow
At most 5 agent rows SHALL be shown at once, windowed so the selected row stays visible, with `↑ N more` above and `↓ N more` below when rows are hidden.

#### Scenario: Overflow
- **WHEN** 7 agents are listed and the first is selected
- **THEN** 5 agent rows are shown followed by `↓ 2 more`

### Requirement: Fleet list activation
The executor SHALL read keys for the list through `ui.onTerminalInput` and act on key presses only, never on a key release. While the list is inactive, `↓` or `←` SHALL activate it with the first agent row selected and be consumed, only when the list is shown, the prompt text is empty and the prompt editor has focus. Every other key MUST pass through.

#### Scenario: Activate at an empty prompt
- **WHEN** the list is shown, the prompt is empty and the editor has focus, and the operator presses `↓`
- **THEN** the list becomes active with the first agent row selected and the key is consumed

#### Scenario: Typing is untouched
- **WHEN** the prompt holds `fix` and the operator presses `↓`
- **THEN** the key passes through and the list stays inactive

### Requirement: Fleet list navigation
While the list is active, `↓` SHALL move the selection down, stopping at the last row; `↑` SHALL move it up, and on `main` SHALL deactivate the list; `Esc` and `Enter` on `main` SHALL deactivate it; `Enter` on an agent row SHALL open its session pane. Each of these keys MUST be consumed. Any other key SHALL deactivate the list and pass through to the editor.

#### Scenario: Down stops at the last row
- **WHEN** the list is active with its last row selected and the operator presses `↓`
- **THEN** the selection stays on the last row and the key is consumed

#### Scenario: Up above main leaves
- **WHEN** the list is active with `main` selected and the operator presses `↑`
- **THEN** the list becomes inactive and the key is consumed

#### Scenario: Other key leaves and passes through
- **WHEN** the list is active and the operator types `a`
- **THEN** the list becomes inactive and `a` reaches the editor

#### Scenario: Key release ignored
- **WHEN** the terminal reports the release of `↓`
- **THEN** the selection does not move

### Requirement: Fleet list focus guard
The list MUST NOT act on any key while a component other than the prompt editor has focus, such as a dialog, a selector or the session pane, and MUST NOT consume any key before it holds the TUI from its widget factory. The prompt editor SHALL be recognized through the TUI's public `getFocusedComponent()` as a component with both `getText` and `setText` functions. When another component takes focus while the list is active, the list SHALL deactivate.

#### Scenario: Dialog keeps its keys
- **WHEN** agents are running, the prompt is empty, a selector dialog has focus and the operator presses `↓`
- **THEN** the key passes through and the list stays inactive

#### Scenario: Custom editor still works
- **WHEN** the focused component is a custom editor with `getText` and `setText` that does not extend Pi's `Editor`
- **THEN** `↓` at an empty prompt activates the list

#### Scenario: No TUI yet
- **WHEN** the list has not yet received the TUI from its widget factory and the operator presses `↓` at an empty prompt
- **THEN** the key passes through

#### Scenario: Pane keeps its keys
- **WHEN** a pane opened from the list is up and the operator presses `↓`
- **THEN** the key passes through to the pane and the list selection does not change

### Requirement: Fleet list opens the session pane
`Enter` on an agent row SHALL open the same read-only session pane `/subagents:sessions` opens for that agent, mounted the same way in the current TUI mode: the live transcript when its session is ready, otherwise the transcript read from its `outputFile`. It MUST NOT open any other viewer. When reading the file fails, the executor SHALL notify `Could not read the session transcript file.` as an error. `/subagents:sessions` MUST keep its current behavior.

#### Scenario: Enter opens the live pane
- **WHEN** the list is active, a running agent is selected and the operator presses `Enter`
- **THEN** the session pane opens on that agent's live transcript

#### Scenario: Released session opens from file
- **WHEN** the selected agent has finished, its session was released, and its `outputFile` is set
- **THEN** the session pane opens on the transcript read from that file

#### Scenario: Unreadable file
- **WHEN** the selected agent's `outputFile` cannot be read
- **THEN** an error notification reads `Could not read the session transcript file.` and no pane opens

#### Scenario: Command unchanged
- **WHEN** the operator runs `/subagents:sessions` and picks an agent
- **THEN** the same pane opens as before this change

### Requirement: Fleet list selection after the pane closes
When a pane opened from the list closes, the list SHALL select the row of the agent that was viewed if it is still listed, and otherwise keep the selection within the rows that remain.

#### Scenario: Selection kept after close
- **WHEN** the operator closes a pane opened on agent B, and an agent listed above B has since dropped out
- **THEN** B's row is selected

#### Scenario: Viewed agent gone
- **WHEN** the pane on agent B closes and B is no longer listed
- **THEN** the selected row is one that is still listed

### Requirement: Fleet view setting
The executor SHALL have a persisted boolean setting `fleetView`, default `true`, loaded from `subagents.json` like the other settings and always written by a settings save. `/subagents:settings` SHALL list a toggle `Fleet view` showing `on` or `off`; flipping it SHALL persist the value and apply to the list immediately. A non-boolean `fleetView` in a settings file MUST be ignored, keeping the default.

#### Scenario: Default on
- **WHEN** no settings file sets `fleetView`
- **THEN** the setting is `true`

#### Scenario: Toggle off applies now
- **WHEN** the list is shown and the operator flips `Fleet view` to `off`
- **THEN** the setting is saved as `false` and the `fleet` widget is cleared

#### Scenario: Invalid value ignored
- **WHEN** `subagents.json` sets `fleetView` to `"no"`
- **THEN** the setting is `true`

### Requirement: Fleet list lifecycle
The list SHALL get its UI context at each `session_start`, replacing any input listener it registered before, and refresh when a run starts or finishes. At `session_shutdown` it SHALL clear its widget, stop its timer and remove its input listener. In print and JSON modes it MUST NOT change Pi's output. The list MUST make no network call.

#### Scenario: Shutdown releases everything
- **WHEN** the session shuts down while the list is shown
- **THEN** the `fleet` widget is cleared, the timer is stopped and the input listener is removed

#### Scenario: Reload keeps one listener
- **WHEN** the session reloads twice while agents run
- **THEN** exactly one input listener from the list is registered

#### Scenario: Print mode
- **WHEN** Pi runs in print mode and a subagent runs
- **THEN** Pi's output is the same as with `fleetView` off

### Requirement: Fleet list refresh timer
The list SHALL refresh once per second while it is shown or any subagent is running or queued, so an agent whose session becomes ready after its run started appears without another event. It MUST run no timer otherwise.

#### Scenario: No timer while idle
- **WHEN** no row exists and no subagent is running or queued
- **THEN** no refresh timer is running

#### Scenario: Session ready after the run started
- **WHEN** the first subagent's run starts before its session exists, and its session becomes ready one second later with no other run event
- **THEN** its row appears within the next refresh

## Design Summary

The operator can set a temporary worker mode for the directory they work in, to raise or lower routing for one piece of work, without changing the saved default in `state.json` that every other directory uses.

Today the mode lives only in `state.json`, which every session and every Pi process shares (`state-file` "State file content", `jev-command` "Mode": "A mode set this way MUST still apply after Pi restarts"). The resolver applies `tuning > state > config > default` (`settings-resolution` "One resolver for effective settings", "State overrides"). Running `/jev mode premium` for one heavy task therefore also raises the mode of every other project. The only way back is to remember to undo it.

The change adds a temporary mode on top of the saved mode, kept in a file in the current directory:

- `/jev mode <m> session` sets the temporary mode for the current directory. `/jev mode session off` removes it.
- The temporary mode is stored in `<cwd>/.pi/jev-session-mode.json`. Every Pi session opened in that directory uses it until it is removed: a new session, a resumed session, a fork, a reload and `/tree` navigation all see the same value. Pi processes in other directories keep the saved mode.
- While a temporary mode is set, it wins over the saved mode for everything the mode selects: the worker target table and cut points (`worker-modes` "Mode selects a target table"), the `mode` on ledger lines, the status line and the `/jev` report.
- `/jev mode <m>` still saves `m` to `state.json`. If a temporary mode is set, it keeps winning in this directory, and the report says so.
- `/jev` reports the temporary mode, the saved mode and which one is in effect. The status line marks a temporary mode.
- Only the mode gets a temporary layer. Feature switches, the CLI review default and slots stay global.

This revision replaces the session-scoped design approved earlier, in which the mode was a `jev-mode` entry in the session file that followed the session's branch. Pi writes no session file until the first message, so a mode set in a session with no message could not outlive it (operator decision, thread "Session-scoped mode override"). The operator chose a per-directory file instead, accepting that the mode is shared by every session in that directory.

Existing requirements this change alters:

- `settings-resolution` "One resolver for effective settings": the precedence gains a temporary layer for the mode.
- `jev-command` "Mode", "Usage text for other input" (the `session` forms are no longer extra words), "Status report" (temporary and saved mode) and "Reset".
- `status-line` "Status line text": the `Jev · <mode>` form gains a marker.

Unchanged: `worker-modes` and `mode-cutpoints`, because they take the effective mode as input; the mode recorded on each worker launch at classification (`jev-command` "Mode": "launches already classified keep the mode they were classified with"); child sessions, which stay inert and inherit nothing to decide.

## Alternatives Considered

### Alternative A: Session entry in the session file (previous design)
- **Approach**: Record the mode as a `jev-mode` custom entry and rebuild it from the session branch.
- **Pros**: Truly per session; follows forks and `/tree`; nothing written in the user's project.
- **Cons**: Pi writes no session file before the first message, so a mode set first in an empty session cannot be resumed.
- **Why not chosen**: The operator wants the temporary mode to hold across Pi restarts in a directory, regardless of whether the session had a message.

### Alternative B: In-memory mode
- **Approach**: Hold the mode in memory and reset it at every `session_start`.
- **Pros**: Smallest change; writes nothing.
- **Cons**: Lost on resume, reload and restart.
- **Why not chosen**: Same need as above: the mode must outlive the process.

### Alternative C: Temporary file in the OS temp directory, keyed by a hash of the cwd
- **Approach**: Same behaviour, with the file outside the project.
- **Pros**: Never shows up in the user's `git status`.
- **Cons**: Hidden from the operator, and the OS may clean it up at any time.
- **Why not chosen**: The operator chose `<cwd>/.pi/`, following Pi's per-project `.pi/` convention, where the file is visible and easy to delete.

## Agreed Approach

A temporary mode stored in `<cwd>/.pi/jev-session-mode.json`, set and cleared with `/jev mode <m> session` and `/jev mode session off`, winning over the saved mode for every Pi session in that directory until it is removed (operator answers, thread "Session-scoped mode override"). It beats Alternative A because it survives restarts even before the first message, beats Alternative B because it outlives the process, and beats Alternative C because the operator can see and remove it.

## Key Decisions

1. **Command form**: `/jev mode <m> session` and `/jev mode session off`, unchanged. `/jev mode <m>` keeps its current meaning and scenarios.
2. **Storage**: `<cwd>/.pi/jev-session-mode.json`, holding only the mode name. No session entry is written.
3. **Scope and lifetime**: per directory, not per session. It applies to every Pi session in that directory, including new ones, until `/jev mode session off`, `/jev reset`, or the operator deletes the file.
4. **Precedence**: the temporary mode wins over `state.json`, the config and the default for the mode only. Tuning has no mode value, so it does not interact.
5. **Saving while a temporary mode is set**: `/jev mode <m>` saves `m` and keeps the temporary mode. The report states that the temporary mode still wins here.
6. **`/jev reset`**: resets the saved state as today and also removes the temporary mode of the current directory.
7. **Visibility**: `/jev` shows the effective mode with its source and the saved mode. The status line marks a temporary mode.
8. **Scope of settings**: mode only; switches, the CLI review default and slots stay global.
9. **Child sessions**: unchanged and inert. Worker routing is decided in the parent with the parent's effective mode.
10. **No network call**: setting, clearing and reading the temporary mode never calls Jev.
11. **A damaged or unreadable file** never breaks Pi: it is treated as no temporary mode and reported by `/jev` (fail open).

## Open Questions

- The word `session` in the command, the `(session)` status marker and the name "session mode" now describe a per-directory mode. Keep them as approved, or rename (for example `/jev mode <m> here` and `(here)`)? Proposed: keep them, since the operator already chose the command form; the docs explain the per-directory scope.
- Whether the package should add `.pi/jev-session-mode.json` to the project's `.gitignore`. Proposed: no, never touch the user's repository files beyond the temporary file; the docs warn that the file may show up in `git status`.

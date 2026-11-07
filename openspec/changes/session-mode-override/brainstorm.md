## Design Summary

The operator can set a worker mode for the current session only, to raise or lower routing for one piece of work, without changing the saved default that every other session and Pi process uses.

Today the mode lives only in `state.json`, which every session and every Pi process shares (`state-file` "State file content", `jev-command` "Mode": "A mode set this way MUST still apply after Pi restarts"). The resolver applies `tuning > state > config > default` (`settings-resolution` "One resolver for effective settings", "State overrides"). Running `/jev mode premium` for one heavy task therefore also raises the mode of every other open session. The only way back is to remember to undo it.

The change adds a session mode on top of the saved mode:

- `/jev mode <m> session` sets the session mode for the current session. `/jev mode session off` removes it.
- The session mode is recorded in the session itself. It survives resume and reload, and it follows the session's branch: a fork carries it, and moving back in the tree to a point before it was set drops it.
- While a session mode is set, it wins over the saved mode for everything the mode selects: the worker target table and cut points (`worker-modes` "Mode selects a target table"), the `mode` on ledger lines, the status line and the `/jev` report.
- `/jev mode <m>` still saves `m` to `state.json`. If a session mode is set, the session mode keeps winning in this session, and the report says so.
- `/jev` reports the session mode, the saved mode and which one is in effect. The status line marks a session mode, so the operator can see at a glance that this session differs from the default.
- Only the mode gets a session layer. Feature switches, the CLI review default and slots stay global.

Existing requirements this change alters:

- `settings-resolution` "One resolver for effective settings": the precedence gains a session layer for the mode.
- `jev-command` "Mode", "Usage text for other input" (the `session` forms are no longer extra words), "Status report" (session and saved mode) and "Reset".
- `status-line` "Status line text": the `Jev · <mode>` form gains a session marker.

Unchanged: `worker-modes` and `mode-cutpoints`, because they take the effective mode as input; the mode recorded on each worker launch at classification (`jev-command` "Mode": "launches already classified keep the mode they were classified with"); child sessions, which stay inert and inherit nothing to decide.

## Alternatives Considered

### Alternative A: In-memory session mode
- **Approach**: Hold the session mode in memory per session id, and reset it at every `session_start`, as `session-tally` does.
- **Pros**: Smallest change; nothing new in the session file; no replay of entries.
- **Cons**: Lost on resume, reload and restart. A long task spread over several sittings silently falls back to the saved mode.
- **Why not chosen**: The operator chose a session mode that lasts as long as the session does, including resume and reload.

### Alternative B: Make `/jev mode <m>` temporary by default
- **Approach**: `/jev mode <m>` sets the session mode, and `/jev mode <m> save` writes `state.json`.
- **Pros**: The safer behaviour becomes the default.
- **Cons**: Breaks the specified meaning of `/jev mode` and the operator's habit. Existing docs and scenarios would all change.
- **Why not chosen**: Keeping `/jev mode <m>` as is and adding a `session` word is additive and keeps every current scenario valid.

### Alternative C: Session layer for every setting
- **Approach**: Allow `session` on feature switches, `all`, the CLI review default and the mode.
- **Pros**: One general mechanism.
- **Cons**: More command forms, reset rules and report lines. No use case beyond the mode yet (YAGNI).
- **Why not chosen**: The need is raising or lowering one session's mode. The layer can extend later if a real need shows up.

## Agreed Approach

A session mode recorded in the session file, set and cleared with `/jev mode <m> session` and `/jev mode session off`, winning over the saved mode only in that session (operator answers, thread "Session-scoped mode override"). It beats Alternative A because it lasts as long as the session, beats Alternative B because it is purely additive, and stays smaller than Alternative C.

## Key Decisions

1. **Command form**: `/jev mode <m> session` and `/jev mode session off`. `/jev mode <m>` keeps its current meaning and scenarios.
2. **Lifetime**: the session mode is kept in the session file. It survives resume and reload, follows forks, and follows tree navigation on the branch.
3. **Precedence**: the session mode wins over `state.json`, the config and the default for the mode only. Tuning has no mode value, so it does not interact.
4. **Saving while a session mode is set**: `/jev mode <m>` saves `m` and keeps the session mode. The report states that the session mode still wins here.
5. **`/jev reset`**: resets the saved state as today and also clears the session mode of the current session, so "reset" always leaves the session on defaults.
6. **Visibility**: `/jev` shows the effective mode with its source (session or saved) and the saved mode. The status line marks a session mode.
7. **Scope**: mode only; switches, the CLI review default and slots stay global.
8. **Child sessions**: unchanged and inert. Worker routing is decided in the parent with the parent's effective mode.
9. **No new network call**: setting, clearing and reading the session mode never calls Jev.

## Open Questions

- Exact wording of the status line marker (for example `Jev · premium*` or `Jev · premium (session)`) and of the `/jev` report lines. design.md settles them.
- Whether `/jev mode session off` with no session mode set reports info ("no session mode") or usage. Proposed: info, change nothing.

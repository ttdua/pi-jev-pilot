## Design Summary

The operator can set the worker mode for the directory they work in, to raise or lower routing for one project, without changing the global default that every other directory uses.

Today the mode lives only in `state.json`, which every session and every Pi process shares (`state-file` "State file content", `jev-command` "Mode": "A mode set this way MUST still apply after Pi restarts"). The resolver applies `tuning > state > config > default` (`settings-resolution` "One resolver for effective settings", "State overrides"). Running `/jev mode premium` for one heavy project therefore also raises the mode of every other project. The only way back is to remember to undo it.

The change makes the mode a per-directory setting by default, with the global mode as the fallback:

- `/jev mode <m>` sets the mode for the current directory. It is stored in `<cwd>/.pi/jev-mode.json`.
- `/jev mode <m> global` sets the global default in `state.json`. This is what `/jev mode <m>` did before.
- `/jev mode clear` removes the directory mode, so the directory follows the global mode again.
- Every Pi session opened in that directory uses the directory mode: a new session, a resumed session, a fork, a reload and `/tree` navigation all see the same value. Directories without the file use the global mode.
- While a directory mode is set, it wins over the global mode for everything the mode selects: the worker target table and cut points (`worker-modes` "Mode selects a target table"), the `mode` on ledger lines, the status line and the `/jev` report.
- `/jev` reports the effective mode, where it comes from, and the global mode. The status line marks a directory mode.
- Only the mode gets a directory layer. Feature switches, the CLI review default and slots stay global.

This revision replaces two earlier versions. The first recorded the mode as a `jev-mode` entry in the session file. Pi writes no session file before the first message, so that mode could not outlive an empty session. The second stored a temporary file per directory, but kept `/jev mode <m> session` as the command. The operator then chose to make the directory the default target of `/jev mode <m>` and to name the global form explicitly (thread "Session-scoped mode override").

**Breaking change:** `/jev mode <m>` used to write `state.json` and change every directory. It now writes only the current directory. Operators who want the old behaviour add `global`. A mode already saved in `state.json` keeps working as the global mode; nothing is migrated.

Existing requirements this change alters:

- `settings-resolution` "One resolver for effective settings" and "State overrides": the precedence gains a directory layer for the mode.
- `jev-command` "Mode" (the default target and the `global` form), "Usage text for other input" (the new forms), "Status report" (source of the mode) and "Reset".
- `status-line` "Status line text": the `Jev · <mode>` form gains a directory marker.
- `state-file`: unchanged in shape. `mode` in `state.json` is now written only by the `global` form.

Unchanged: `worker-modes` and `mode-cutpoints`, because they take the effective mode as input; the mode recorded on each worker launch at classification (`jev-command` "Mode": "launches already classified keep the mode they were classified with"); child sessions, which stay inert and inherit nothing to decide.

## Alternatives Considered

### Alternative A: Session entry in the session file (first version)
- **Approach**: Record the mode as a `jev-mode` custom entry and rebuild it from the session branch.
- **Pros**: Truly per session; follows forks and `/tree`; nothing written in the user's project.
- **Cons**: Pi writes no session file before the first message, so a mode set first in an empty session cannot be resumed.
- **Why not chosen**: The operator wants the mode to hold across Pi restarts in a directory, whether or not the session had a message.

### Alternative B: Per-directory file behind an opt-in `session` word (second version)
- **Approach**: Keep `/jev mode <m>` global and add `/jev mode <m> session` for the directory file.
- **Pros**: No breaking change.
- **Cons**: The word "session" is misleading when every session in the directory shares the mode. The common case needs the extra word.
- **Why not chosen**: The operator chose the directory as the default target and `global` as the explicit form.

### Alternative C: Mode file in the OS temp directory, keyed by a hash of the cwd
- **Approach**: Same behaviour, with the file outside the project.
- **Pros**: Never shows up in the user's `git status`.
- **Cons**: Hidden from the operator, and the OS may clean it up at any time.
- **Why not chosen**: The operator chose `<cwd>/.pi/`, following Pi's per-project `.pi/` convention, where the file is visible and easy to delete.

## Agreed Approach

`/jev mode <m>` writes the directory mode to `<cwd>/.pi/jev-mode.json`, `/jev mode <m> global` writes the global mode to `state.json`, and `/jev mode clear` removes the directory mode. The directory mode wins over the global mode for every Pi session in that directory (operator answers, thread "Session-scoped mode override"). It beats Alternative A because it survives restarts even before the first message, beats Alternative B because the common case is the short command and the naming is honest, and beats Alternative C because the operator can see and remove the file.

## Key Decisions

1. **Commands**: `/jev mode <m>` for the directory, `/jev mode <m> global` for the global default, and `/jev mode clear` to remove the directory mode. `clear` is not a mode name, so it cannot collide.
2. **Storage**: `<cwd>/.pi/jev-mode.json`, holding only the mode name. No session entry is written. The package never edits `.gitignore` or any other file in the user's project; the docs warn that the file may show up in `git status`.
3. **Directory**: the session's working directory (`ctx.cwd`) as Pi reports it, not the git root. A subdirectory has its own mode.
4. **Lifetime**: the directory mode lasts until `/jev mode clear`, `/jev reset`, or the operator deletes the file.
5. **Precedence**: the directory mode wins over `state.json`, the config and the default for the mode only. Tuning has no mode value, so it does not interact.
6. **Setting the global mode while a directory mode is set**: `/jev mode <m> global` saves `m` and keeps the directory mode. The report states that the directory mode still wins here.
7. **`/jev reset`**: resets the global state as today and also removes the current directory's mode, so a reset always leaves this directory on the defaults.
8. **Visibility**: `/jev` shows the effective mode with its source (directory or global) and the global mode. The status line marks a directory mode.
9. **Scope of settings**: mode only; switches, the CLI review default and slots stay global.
10. **Child sessions**: unchanged and inert. Worker routing is decided in the parent with the parent's effective mode.
11. **No network call**: setting, clearing and reading the directory mode never calls Jev.
12. **A damaged or unreadable file** never breaks Pi: it is treated as no directory mode and reported by `/jev` (fail open).
13. **Breaking change** is documented in the usage guide and the README, with `global` as the way to keep the old behaviour.

## Open Questions

- Exact status marker and report wording. Proposed: status `Jev · premium (local)`; report `mode: premium (this directory; global standard)`; global set while a directory mode is set adds `directory mode <d> still applies here; global mode is now <m>`. design.md settles them.

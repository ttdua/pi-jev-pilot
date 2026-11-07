## Why

The worker mode lives only in `state.json`, which every session and every Pi process shares. Running `/jev mode premium` for one heavy project, or `/jev mode budget` for a cheap one, also changes routing in every other project until the operator remembers to switch back. Operators need the mode to follow the directory they work in, with the global mode as the fallback.

## What Changes

**Directory mode (new)**
- `/jev mode <m>` sets the mode for the current directory, stored in `<cwd>/.pi/jev-mode.json`.
- `/jev mode clear` removes it, so the directory follows the global mode again.
- Every Pi session in that directory uses the directory mode: new, resumed, forked, reloaded, and after `/tree` navigation.
- Only the mode gets a directory layer. Switches, the CLI review default and slots stay global.
- The package never edits `.gitignore` or any other project file besides `.pi/jev-mode.json`.

**`/jev mode <m>` (breaking)**
- From: saves `m` to `state.json`, changing every directory.
- To: saves `m` for the current directory only. `/jev mode <m> global` saves to `state.json`, as before.
- Reason: the common case is changing one project's mode; the global change is the deliberate one.
- Impact: breaking for operators who expect `/jev mode <m>` to change every directory. A mode already in `state.json` stays the global mode; nothing is migrated.

**Settings precedence**
- From: `tuning > state > config > default` for every value.
- To: for the mode only, `directory > state > config > default`; everything else unchanged.
- Impact: with no directory file the result is identical.

**`/jev mode <m> global` while a directory mode is set**
- Saves `m` globally; the directory mode stays in effect here, and the report says so.

**`/jev reset`**
- From: resets `state.json`.
- To: also removes the current directory's mode.

**Visibility**
- `/jev` reports the effective mode, its source and the global mode.
- The status line marks a directory mode.

## Capabilities

### New Capabilities
- `directory-mode`: setting, clearing, reading and validating the per-directory mode file, its precedence over the global mode in every session of that directory, and its inertness in child sessions.

### Modified Capabilities
- `settings-resolution`: "One resolver for effective settings" and "State overrides" gain a directory layer for the mode.
- `jev-command`: "Mode" changes its default target and gains the `global` and `clear` forms; "Usage text for other input" lists them; "Status report" shows the source of the mode; "Reset" removes the directory mode.
- `status-line`: "Status line text" marks a directory mode in the `Jev · <mode>` form.

## Impact

- Code: `src/store/settings.ts` (resolver input), a new store module for `<cwd>/.pi/jev-mode.json`, `src/host/commands.ts` (parse, run, report, usage), `src/host/readiness.ts` (snapshot input), `src/host/status.ts` (marker). The session-entry code written in the first apply iteration (`src/jev/session-mode.ts`, `src/host/session-mode.ts`, the `session_tree` handler and its tests) is replaced or removed.
- Files: a new per-directory `.pi/jev-mode.json` in the user's project, holding only the mode name.
- No new dependency, no change to the shape of `state.json`, `config.json`, the ledger schema or the Jev request.
- Docs updated: `docs/usage-guide.md` (commands, breaking change, `git status` warning), `README.md` (mode section), `docs/architecture.md` (precedence and the new file), `docs/glossary.md` (directory mode), `docs/configuration.md` (the file list, if it lists files under `.pi/`).
- The change keeps its name `session-mode-override` and its worktree branch, since renaming would break the recorded worktree.

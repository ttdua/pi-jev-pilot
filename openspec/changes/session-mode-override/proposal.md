## Why

The worker mode lives only in `state.json`, which every session and every Pi process shares. Running `/jev mode premium` for one heavy task, or `/jev mode budget` for a cheap one, also changes routing in every other open session until the operator remembers to switch back. Operators need to raise or lower the mode for one session without changing the saved default.

## What Changes

**Session mode (new)**
- `/jev mode <m> session` sets a session mode for the current session; `/jev mode session off` removes it.
- The session mode is recorded as a custom entry in the session file, so it survives resume and reload, follows forks and follows tree navigation on the branch.
- Only the mode gets a session layer. Switches, the CLI review default and slots stay global.

**Settings precedence**
- From: `tuning > state > config > default` for every value.
- To: for the mode only, `session > state > config > default`; everything else unchanged.
- Reason: the session mode must win only in its own session.
- Impact: non-breaking; with no session mode set the result is identical.

**`/jev mode <m>` while a session mode is set**
- From: saves `m`, which becomes the effective mode from the next worker launch.
- To: saves `m`; the session mode stays in effect in this session, and the report says so.
- Reason: a saved default must not silently cancel a deliberate session choice.
- Impact: non-breaking for sessions without a session mode.

**`/jev reset`**
- From: resets `state.json`.
- To: also clears the current session's session mode.
- Impact: non-breaking; reset still leaves the session on defaults.

**Visibility**
- `/jev` reports the effective mode with its source and the saved mode.
- The status line marks a session mode.

## Capabilities

### New Capabilities
- `session-mode`: setting, clearing, recording and restoring the per-session mode from the session's branch, and its inertness in child sessions.

### Modified Capabilities
- `settings-resolution`: "One resolver for effective settings" and "State overrides" gain a session layer for the mode.
- `jev-command`: "Mode" gains the `session` forms and keeps a session mode when saving; "Usage text for other input" lists them; "Status report" shows the source of the mode; "Reset" clears the session mode.
- `status-line`: "Status line text" marks a session mode in the `Jev · <mode>` form.

## Impact

- Code: `src/store/settings.ts` (resolver input), `src/host/commands.ts` (parse, run, report, usage), `src/host/readiness.ts` (snapshot input), `src/host/status.ts` (marker), `src/host/setup.ts` and a new host module that reads the session entry from the branch; worker classification picks up the effective mode with no change of its own.
- Session file: a new `jev-mode` custom entry holding only the mode or its removal, with no prompt text.
- No new dependency, no change to `state.json`, `config.json`, the ledger schema or the Jev request.
- Docs updated: `docs/usage-guide.md` (command and behaviour), `README.md` (mode section), `docs/architecture.md` (settings precedence and session entry), `docs/glossary.md` (session mode).

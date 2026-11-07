## Why

Operators cannot see what Jev did in a session without reading `ledger.jsonl` by hand. `/jev` has no session counts, and the `verbose` switch exists and is documented ("try `/jev verbose on`") but does nothing. WG-17 (roadmap G4, G7) closes both gaps now that main effort (WG-07) and worker routing (WG-11) write their ledger lines. The operator gets per-session counts and readable decision lines that never reach the model.

## What Changes

**`/jev` status report**
- From: status, switches, key, executor and problems.
- To: the same, followed by a session tally: decided prompts, workers by model, tokens on workers and fallbacks. Counts only, no dollars, and no `tools flagged` until WG-14.
- Reason: G4 session tally.
- Impact: non-breaking; the report gains lines at the end.

**Status line**
- From: `Jev · <mode>` followed by the latest level or `no answer`.
- To: the same, except that after every 10th decided prompt of the session the compact tally takes the place of the level suffix until the next decision redraws the line.
- Reason: G4 "status line every 10th prompt".
- Impact: non-breaking; the base states (`config error`, `no key`, `off`) still win.

**`verbose` switch**
- From: stored and shown, but read by nothing.
- To: while on, each ledger line the main session writes (main, worker, correction) is also appended to the session as a `jev-log` custom entry. A registered renderer draws it as one line with raw probabilities and the skip or miss reason. Custom entries are never sent to the model.
- Reason: G7 optional log and verbose mode.
- Impact: non-breaking. There is no new switch, command, config key or `state.json` field.

- The tally lives in memory, belongs to the main session and resets at every `session_start`.
- Child sessions keep no tally and append no log entries.

## Capabilities

### New Capabilities
- `session-tally`: in-memory per-session counts fed by the ledger lines, reset at session start, shown by `/jev` and on the status line every 10th decided prompt.
- `verbose-log`: `jev-log` custom entries and their renderer, written from ledger lines while `verbose` is on, never part of the model context, with the host test that proves it.

### Modified Capabilities
- `status-line`: the status line text gains the tally form on every 10th decided prompt.
- `jev-command`: the status report ends with the session tally.

## Impact

- Code: `src/host/status.ts` (tally text, log line text), a new `src/host/tally.ts` for the in-memory tally and log observer, and the wiring in `src/host/setup.ts`, `src/host/main.ts` and `src/host/worker.ts` (ledger append routed through the observer), plus `src/host/commands.ts` (tally in the report).
- Tests: unit tests under `tests/host/`, and a host test that turns `verbose` on and checks that the provider request holds no `jev-log` content.
- No dependency, schema or file-format change. `ledger.jsonl` and `state.json` are unchanged.
- Docs updated: `docs/architecture.md` (display surfaces: log gated by `verbose`, tally definition), `docs/usage-guide.md` (`/jev` tally and `verbose` description, drop the "WG-17" markers), `docs/privacy.md` (log entries are stored in Pi session files), `docs/glossary.md` (tally and log line), `docs/roadmap.md` (WG-17 status).

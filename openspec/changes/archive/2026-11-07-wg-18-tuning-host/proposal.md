## Why

`wg-18-tuning-policy` built the tuning rules and `tuning.json`, but nothing calls them: a tuned `timeoutMs` never takes effect, and `/jev tune` prints usage text. ADR 0005 wants tuning that applies itself, with a visible line and undo, so the operator has nothing to remember. This change wires the rules into the host and finishes WG-18.

## What Changes

- **Tuning at `agent_settled`.** After a main-session run settles and its ledger line is written, the package runs the tuning step once against the ledger and stores the result in `tuning.json`. It skips this in worker sessions, with an invalid config, or when `tuning.json` is unreadable. A failure never affects the run.
- **The tuned value takes effect.** The settings snapshot reads `tuning.json`, so the main decision, worker routing and tool assessment use the tuned `timeoutMs` while its base matches the config. Problems in `tuning.json` appear in `/jev`.
- **Change lines.** Each `applied`, `reverted` and `superseded` event shows one info notification, such as `Jev tune: timeoutMs 1500→1700 · /jev tune undo`. A `kept` event shows nothing.
- **Session-start line.** When tuning changed something since the last line the operator saw, one line at session start summarises it.
- **`/jev tune`** reports the tuned state, the recent history and the signals per mode. `/jev tune undo | reset | on | off` apply the matching pure transitions.
- **Signals per mode.** Four observed signals are counted over the latest 200 decisions of each mode. They are only shown, never applied.

**Seen marker in `tuning.json`**
- From: `tuning.json` holds `off`, `timeoutMs`, `pending`, `block` and `history`.
- To: it may also hold `seenAt`, the time of the latest change the operator was shown.
- Reason: operator decision 2026-11-07. Without it, every session start would repeat old changes.
- Impact: non-breaking. The field is optional and `version` stays `1`.

**`/jev tune`**
- From: `/jev tune` prints usage text, which lists no `tune` form.
- To: `/jev tune`, `/jev tune undo`, `/jev tune reset`, `/jev tune on` and `/jev tune off` exist and are listed in the usage text.
- Reason: WG-18 scope. `on` is the inverse of `off`, which ADR 0005 implies.
- Impact: non-breaking. `tune` is already a reserved slot name.

**Snapshot**
- From: each refresh reads `config.json` and `state.json`.
- To: it also reads `tuning.json` and keeps its problems for the report.
- Reason: a tuned value must reach every reader of `classifier.timeoutMs`.
- Impact: non-breaking.

No Jev call is added. Tuning reads only earlier outcomes from the ledger.

Docs updated:
- `docs/usage-guide.md`: lines, `/jev tune on`, the signals, and the removal of the "until WG-18" note.
- `docs/domain-model.md`: signal definitions, the 200-decision window, `seenAt`.
- `docs/configuration.md`: `seenAt`.
- `docs/workflow.md`: §5 notes when the step is skipped; §8 covers the session-start line.
- `docs/architecture.md`: the new modules.
- `docs/roadmap.md`: WG-18 done.

## Capabilities

### New Capabilities
- `tuning-host`: the tuning step at `agent_settled`, when it is skipped, the change lines, the session-start line, `seenAt` handling and failure isolation.
- `tuning-signals`: the four observed signals per mode, counted over the latest 200 decisions of each mode, as a pure function of ledger lines.
- `tune-command`: the `/jev tune` report and the `undo`, `reset`, `on` and `off` subcommands.

### Modified Capabilities
- `tuning-file`: adds the optional `seenAt` field.
- `readiness-checks`: the snapshot also reads `tuning.json` and resolves settings with it.
- `jev-command`: the status report lists `tuning.json` problems, the usage text lists the `tune` forms, and `/jev tune` no longer prints usage text.

## Impact

- New code:
  - `src/host/tuning-step.ts` (step at settle and change lines), `src/host/tuning-seen.ts` (session-start line), `src/host/tune-command.ts` (`/jev tune`) and `src/host/tuning-text.ts` (texts);
  - `src/policy/tuning-signals.ts` (pure signals);
  - unit and host tests for both.
- Changed code:
  - `src/host/readiness.ts` (snapshot reads `tuning.json`);
  - `src/host/setup.ts` (calls the tuning module at `agent_settled` and `session_start`);
  - `src/host/commands.ts` (`tune` parsing, usage text, `tuning.json` problems);
  - `src/store/tuning-file.ts` and `src/policy/tuning.ts` (`seenAt` in both types).
- No new dependency, no change to `config.json`, `state.json` or the ledger schema, and no new Pi event handler.

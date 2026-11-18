## Context

Tool assessment lives in its own modules (`src/policy/tools/`, `src/host/tools/`) and touches shared code at a few seams: the launch policy (`src/host/worker/policy.ts` joins it with routing and builds the adjustment), the outcome handlers (`outcomes.ts`, `launches.ts` keep `grantedTools` from `subagents:child:bound`), the worker line (`worker-line.ts` writes the counts), the Jev wire layer (`questions.ts`, `rubrics.ts`, the tool part of `state.ts`), and the store (`defaults.ts`, `config.ts`, `settings*.ts`, `state-file.ts`). The precedent for retiring a switch is `switches.review` in `state-file.ts`: accepted on read, dropped from the returned state.

## Goals / Non-Goals

**Goals:**
- Delete every tool-assessment code path; no dead branches or unused exports remain.
- Keep existing `config.json`, `state.json` and ledger files valid.

**Non-Goals:**
- Any change under `packages/pi-subagents/`.
- Rewriting historical docs (`docs/evidence/`, `docs/decisions/`).

## Decisions

**Launch policy keeps only routing.** `decideLaunch` drops `planTools` / `assessTools`; the gate reduces to the `subagents` switch, and the adjustment is the route's write alone. `Decided` keeps its `{ launch }` wrapper and loses the tool decision; `LaunchBook` stops tracking `grantedTools` and the `subagents:child:bound` handler for it goes. Alternative kept out: leaving `addTools` / `removeTools` plumbing for a future feature (YAGNI).

**Config `tools` is an opaque ignored key.** `configValidator` replaces the `tools` object validator with one that accepts any JSON value and returns nothing, so `Config` has no `tools` field and `tools.mode: "remove"` no longer makes the config invalid. Accepting any shape (rather than still validating the old fields) is chosen because a field nobody reads should never be a reason to turn the package off. Detecting the deprecation needs the raw object: `load` already keeps `raw`, so `readConfig` reports `deprecated: ["tools"]` when the key is present, and the snapshot carries it to the status report. Alternative rejected: a new generic "unknown keys are ignored" rule, which would hide typos in live keys.

**Deprecation is reported only in `/jev` status**, as one line `deprecated: config tools is ignored` under `problems:`. It is not a problem that changes the status line, and no toast is shown, so a stale key costs the user nothing.

**State `switches.tools` follows the `review` precedent.** The state validator accepts `tools` as a legacy key next to `review` (boolean only) and `dropLegacyReview` becomes a drop of both legacy keys. `FEATURES` loses `tools`; `DECISION_FEATURES` becomes five; `RESERVED_SLOT_NAMES` keeps `tools`, so an old command word can never become a slot by accident.

**`/jev tools on|off` is unknown input.** With `tools` gone from `FEATURES`, the parser routes it to usage text; no special message (user choice). Because `tools` stays reserved, it is not handled as a slot either.

**Ledger: write nothing, read old lines.** `WorkerLineInput.toolCounts` and the three writes go; the schema keeps `toolsScored`, `toolsFlagged`, `toolsGranted` as optional counts so old lines pass the tolerant read. The decision-ledger spec states they are no longer written.

**Wire layer.** `TOOL_QUESTION`, `GRANT_QUESTION`, the tool-question builder and `buildToolState` are removed. `RUBRIC_VERSION` stays `2`: the tool questions were never part of the worker rubric.

## Risks / Trade-offs

- [A user on `enforce` silently loses removals and grants] → The `/jev` status deprecation line and the CHANGELOG entry say tool assessment was removed.
- [Accepting any `tools` value hides a malformed leftover] → Harmless: nothing reads it, and status names it.
- [Wide diff across store, host and docs] → Tasks are split by layer (store, host, wire, docs), each with its own tests; the import-graph test and typecheck catch any leftover reference to the removed modules.

## Migration Plan

No user action. Old `config.json` and `state.json` keep loading; `switches.tools` disappears on the next state write; ledger history stays readable. Rollback is a revert of the change.

## Open Questions

None.

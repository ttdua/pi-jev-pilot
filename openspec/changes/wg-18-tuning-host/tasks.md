## 1. Seen marker in the store and the policy

- [x] 1.1 Add optional `seenAt` to `TuningDocument` and its validator in `src/store/tuning-file.ts`, and to `TuningRecord` in `src/policy/tuning.ts`; extend `tests/store/tuning-file.test.ts` (Seen marker read, Bad seen marker) and keep the mutual-assignability test passing
- [x] 1.2 Add a pure `markSeen(record, at)` in `src/policy/tuning.ts` that never lowers `seenAt`, and `unseenEntries(record)`; table-test both in `tests/policy/tuning.test.ts`

## 2. Pure signals

- [x] 2.1 Create `src/policy/tuning-signals.ts` with `SignalLine`, `ModeSignals` and `signalsByMode(lines)` (latest 200 decisions per mode, deterministic order); add the `LedgerEntry` to `SignalLine` seam test in `tests/policy/tuning-seam.test.ts`
- [x] 2.2 Cover every `tuning-signals` scenario in `tests/policy/tuning-signals.test.ts`

## 3. Snapshot reads tuning.json

- [x] 3.1 Export a pure `untunedTimeout(config)` from `src/store/settings.ts` and use it inside `resolveSettings`
- [x] 3.2 Extend `Snapshot`, `buildSnapshot` and `loadSnapshot` in `src/host/readiness.ts` with `tuningRead`, `tuning: { kind, issues, record }` and `untunedTimeoutMs`, ignoring tuning while the config is invalid; switch the `Snapshot` literals in `tests/host/worker-fakes.ts` and `tests/host/tools.test.ts` to `buildSnapshot`; extend `tests/host/readiness.test.ts`
- [x] 3.3 List `tuning (<kind>)` problems in `formatStatus` (`src/host/commands.ts`), using `issueLines` from `src/host/tuning-text.ts` (task 4.1); unit test "Malformed tuning reported"

## 4. Tuning texts

- [x] 4.1 Create `src/host/tuning-text.ts` with `issueLines` (moved from `commands.ts`), the change lines, the session-start line, the subcommand messages and the `/jev tune` report formatter; unit-test exact strings in `tests/host/tuning-text.test.ts`

## 5. Host tuning modules

- [ ] 5.1 Create `src/host/tuning-deps.ts` (`UiCtx`, `TuningDeps`), `src/host/tuning-step.ts` with `settleTuning(deps, ctx)`, and shared fakes in `tests/host/tuning-fakes.ts`: skip rules, two-pass step inside `updateTuning`, `seenAt` with UI only, lines after a successful write, failures swallowed; tests in `tests/host/tuning-step.test.ts`
- [ ] 5.2 Create `src/host/tuning-seen.ts` with `showUnseenTuning(deps, ctx)`: write `seenAt` first, then show the summary line; tests in `tests/host/tuning-seen.test.ts`
- [ ] 5.3 Create `src/host/tune-command.ts` with `buildTuneView` and `runTune(deps, sub, ctx)` for the report, `undo`, `reset`, `on` and `off`, with the invalid-config refusal, stale-base "nothing to undo", and refused writes; tests in `tests/host/tune-command.test.ts`

## 6. Wiring

- [ ] 6.1 Parse `/jev tune [undo|reset|on|off]` in `parseJevArgs`, add the form to `usageText`, and delegate to `runTune` in `runJev` (usage warning when no `tune` dep is given); update `tests/host/commands.test.ts` (Command from a later work group, Usage lists the tune form, Unknown subcommand) and the three existing tests that expect `tune` to be usage (`commands.test.ts` usage-has-no-tune and later-work-group cases, `tests/host/jev-base.test.ts` "unknown command notifies a warning")
- [ ] 6.2 In `src/host/setup.ts`, build one `TuningDeps`, call `settleTuning` after `main.agentSettled(event)` and `showUnseenTuning` in `session_start`, each in its own `try`, main sessions only; pass `runTune` to `runJev`

## 7. Host tests

- [ ] 7.1 Extract the private `command`, `uiRequests` and `notifies` helpers of `tests/host/jev-base.test.ts` into `tests/host/rpc-helpers.ts`, and add `writeConfigFile`, `seedLedger` and `seedCorrections`; add `tests/host/tuning-host.test.ts` (RPC, loopback Jev fixture): rule fires at settle with the applied line and `seenAt`; tuned value used by the next request; print mode writes the change silently; session-start line shown once; `/jev tune off` survives a restart and stops tuning; `config.json` and `state.json` untouched; no extra Jev request
- [ ] 7.2 Cover the worker-routing reader of the tuned value in an existing worker host test or a new case

## 8. Docs

- [ ] 8.1 Update `docs/usage-guide.md`, `docs/domain-model.md`, `docs/configuration.md`, `docs/workflow.md` (§5, §8), `docs/architecture.md` (new modules) and `docs/roadmap.md` (WG-18 done)
- [ ] 8.2 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test`; all pass

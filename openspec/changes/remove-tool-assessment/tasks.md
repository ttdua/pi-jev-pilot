## 1. Store: retire the tools settings and switch

Blocked by: none

- [x] 1.1 `src/store/config.ts`: replace the `tools` object validator with an accept-anything key that contributes nothing; drop `tools` from `Config`; report `deprecated: ["tools"]` from `readConfig` when the raw object has a `tools` key (specs `config-file` "Deprecated tools section", "Optional field rules"). Tests in `tests/store/config-read.test.ts`, `config-write.test.ts`, `validate.test.ts`.
- [x] 1.2 `src/store/settings.ts`, `settings-sections.ts`: remove `resolveTools` and `tools` from `Settings` (spec `settings-resolution` "Effective settings resolver"). Tests in `tests/store/settings*.test.ts`.
- [x] 1.3 `src/store/defaults.ts`: drop `tools` from `FEATURES`, `DECISION_FEATURES`, `DEFAULTS.tools` and `DEFAULTS.switches`; keep it in `RESERVED_SLOT_NAMES`.
- [x] 1.4 `src/store/state-file.ts`: accept a boolean `switches.tools` as a legacy key next to `review` and drop both from the returned state (spec `state-file` "State file content"). Tests in `tests/store/state-file.test.ts`.
- [x] 1.5 `src/store/ledger-schema.ts`: keep `toolsScored`, `toolsFlagged`, `toolsGranted` allowed for reading old lines (spec `decision-ledger`); confirm `tests/store/ledger-schema.test.ts` and `ledger-pin.test.ts` still pass.

## 2. Host and wire: remove tool assessment

Blocked by: 1

- [x] 2.1 `src/host/worker/policy.ts`: drop `planTools` / `assessTools`, the `tools` gate and `addTools` / `removeTools` from the adjustment; `Decided` holds only the launch entry (spec `worker-routing` "When routing runs").
- [x] 2.2 `src/host/worker/outcomes.ts`, `launches.ts`, `routing.ts`: remove `grantedTools` tracking, the `subagents:child:bound` grant handler, `launchToolCounts` and the `assess` deps; drop the `ToolCounts` re-export in `src/policy/worker/index.ts`.
- [x] 2.3 `src/policy/worker/worker-line.ts`: remove `toolCounts` and the three `tools*` writes (spec `worker-ledger` "Retired worker fields not written").
- [x] 2.4 Delete `src/host/tools/` and `src/policy/tools/`; remove `TOOL_QUESTION`, `GRANT_QUESTION` (`src/jev/rubrics.ts`), the tool-question builder (`src/jev/questions.ts`) and `buildToolState` with its types (`src/jev/state.ts`); `RUBRIC_VERSION` stays `2`.
- [x] 2.5 Tests: delete `tests/host/tool-assessment.test.ts`, `tests/host/tools/`, `tests/policy/tools/`; update `tests/host/worker/policy.test.ts`, `worker-routing.test.ts`, `worker-ledger.test.ts`, `worker-fakes.ts`, `tests/jev/questions.test.ts`, `tests/jev/state.test.ts`, `tests/policy/worker/worker-line.test.ts`. Add a `worker-routing` test: legacy `tools.mode: enforce` config, routed launch → no `tool::`/`grant::` question, one request, no `addTools`/`removeTools`.
- [x] 2.6 `tests/host/launch-policy-evidence.test.ts`: remove the jev-pilot assessment cases ("Enforce removes", "Enforce grants", "Ordering control…", "Resumed worker is not reassessed", "Jev down in enforce…") and the enforce grant step of the e2e case; keep the executor seam cases ("Grant reaches the child", "disallowed_tools wins over a grant") and `tests/host/probes/policy/` as they test the vendored seam.

## 3. Command and status surface

Blocked by: 1, 2

- [x] 3.1 `src/host/commands/status-format.ts`: drop "and tool assessment" from both executor lines; add `deprecated: config tools is ignored` under `problems:` when the snapshot's config read reports it; carry the deprecation through `buildSnapshot` in `src/host/platform/readiness.ts` (spec `jev-command` "Status report"). No toast anywhere.
- [x] 3.2 `src/host/commands/jev.ts`: `tools` is no longer a feature; `/jev tools on|off` prints usage; `/jev all` sets five features; usage text lists seven feature names (spec `jev-command` "Feature switch commands", "All features", "Usage text for other input").
- [x] 3.3 Tests: `tests/host/commands/jev.test.ts`, `tests/host/status/line.test.ts`, `tests/host/jev-base.test.ts`, `tests/host/main/rich.test.ts`, `tests/host/platform/readiness.test.ts` and the `ConfigRead` fixtures (`tests/host/main.test.ts`, `tuning-fakes.ts`, `commands/status-reply.test.ts`, `tuning/step.test.ts`, `main/gate.test.ts`, `main/timing.test.ts`, `commands/jev-order.test.ts`, `tests/replay/inputs.test.ts`) for seven features, five decision features, the deprecated line, no notification on session start with a legacy `tools` section, and `/jev tools off` → usage.

## 4. Docs and changelog

Blocked by: 2, 3

- [ ] 4.1 Remove tool assessment from `README.md` (feature list, off switches: five decision features), `docs/configuration.md` (drop `tools` rows, note the deprecated key), `docs/usage-guide.md` (seven features), `docs/jev-questions.md` (`tool::`/`grant::` wording), `docs/jev-contract.md`, `docs/architecture.md`, `docs/domain-model.md`, `docs/glossary.md`, `docs/privacy.md`, `docs/workflow.md`, `docs/roadmap.md`, `docs/project-brief.md`. Leave `docs/evidence/` and `docs/decisions/` unchanged.
- [ ] 4.2 `CHANGELOG.md` `[Unreleased]`: "Removed: tool assessment (#81)", with the compatibility notes for `config.json`, `state.json` and the ledger.
- [ ] 4.3 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun test`; `rg -n "tool::|grant::|toolsScored|grantAt|tool assessment" src tests docs README.md CHANGELOG.md`: every hit is the ledger read path (`ledger-schema`, `ledger-pin`, the legacy-line window test), a compatibility test feeding a legacy `tools` section, an executor seam case, `docs/evidence/`, `docs/decisions/`, or the CHANGELOG / configuration deprecation note. Version bump is left to the release commit.

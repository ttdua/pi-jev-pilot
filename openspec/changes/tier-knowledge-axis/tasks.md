## 1. Tier vocabulary rename and legacy read path

Blocked by: none

- [x] 1.1 Rename the tier vocabulary everywhere in one green commit: `TierName`/`TIER_LADDER`, `TIERS`, `FEATURES`, `DECISION_FEATURES`, `RESERVED_SLOT_NAMES`, `DEFAULTS.switches`, `CutPoints`/`ModeTarget` field names, `expertOffered`→`frontierOffered`, `expertOn`→`frontierOn`, reason `expert`→`frontier`, switch/command `expert`→`frontier`, in `src/`, `scripts/replay/` and every test and test helper; behaviour, wording and numbers unchanged; add `LEGACY_TIER`
- [x] 1.2 Config read: deprecated `tiers.fast|balanced|expert` aliases with notices, alias + new key conflict, existing `frontier` slot read with a notice; slot writer refuses `frontier` (`src/store/config.ts`)
- [x] 1.3 State read: legacy `switches.expert` moved or dropped (`src/store/state-file.ts`)
- [x] 1.4 Ledger schema accepts legacy targets, reasons and `expertOffered` alongside the new ones (`src/store/ledger-schema.ts`)
- [x] 1.5 Replay config reader normalizes legacy tier keys and the legacy switch (`scripts/replay/config.ts`)
- [x] 1.6 Tuning upgrade path: `tuning-signals` counts legacy `fast` as low, and a `tuning.json` written by the previous version (with history and a pending change) reads unchanged; `/jev expert` alias with notice; `tests/release-check.ts` expects `/jev frontier off`
- [x] 1.7 Start-up migration: pure `migrateTierKeys` (`src/store/config.ts`), state migration through `updateState`, host step at main `session_start` before the status draw with one info notification (`src/host/wiring/session.ts`, new `src/host/platform/migrate.ts`)

## 2. Knowledge-axis decision rules

Blocked by: 1

- [x] 2.1 Tier-only `difficultyScore` (`src/policy/worker/score.ts`)
- [x] 2.2 Frontier cut over all entries, `WindowEntry` without effort, window reasons `frontier`/`cut` (`src/policy/worker/{cutpoints,cut-window}.ts`)
- [x] 2.3 Mode targets 20/53/26/1 and 0/50/47/3 (`src/policy/worker/modes.ts`)
- [x] 2.4 Decision order `frontier`, `slot`, `cut`; risk rule removed; frontier rule without effort (`src/policy/worker/tier.ts`)
- [x] 2.5 `workerEffort` without the tier cap (`src/policy/effort.ts`, `src/policy/worker/route.ts`)
- [x] 2.6 Provisional seed from the new rules over a committed synthetic score fixture, marked provisional (`src/policy/worker/seed.ts`)

## 3. Rubric wording and worker request

Blocked by: 2

- [x] 3.1 Write the knowledge tier rubric, the work/care effort instruction and criteria, and the main effort instruction in `docs/jev-questions.md`
- [x] 3.2 Copy them verbatim into `src/jev/rubrics.ts` (`WORKER_TIER_CRITERIA`, `TIER_INSTRUCTION`, effort question and main instruction); `RUBRIC_VERSION` 3; keep `MAIN_TIER_*` until task 4

## 4. Main request, strategy gate and status

Blocked by: 2, 3

- [x] 4.1 `mainQuestions({ applyEffort, askStrategy, skills })`; delete `MAIN_TIER_CRITERIA`/`MAIN_TIER_QUESTION` (`src/jev/{questions,rubrics}.ts`, `src/host/main/gate.ts`)
- [x] 4.2 `adviseStrategy` reads the raw effort choice (`src/policy/main/strategy.ts`)
- [x] 4.3 `OutcomeFlags.applyEffort`: effort plan, status `no answer`, ledger effort fields only when effort-eligible (`src/policy/main/outcome.ts`)
- [x] 4.4 Host checks: held + strategy, compaction with strategy on, gate-only on a non-reasoning model, status suffix

## 5. Commands, slots and status report

Blocked by: 4

- [ ] 5.1 Mix line and targets text with the new caps (`src/host/commands/status-format.ts`)
- [ ] 5.2 Slot forms refused while a legacy `frontier` slot exists, checked first (`src/host/commands/slots.ts`)

## 6. Replay seed candidate

Blocked by: 2, 4

- [ ] 6.1 Report pass computes and writes the seed candidate per variant and mode, routes the first 100 launches on it, and drops the main tier comparison key (`scripts/replay/{report,report-route,report-compare,compare}.ts`)

## 7. Seed from replay and evidence

Blocked by: 6

- [ ] 7.1 Dry-run the report pass and hand the operator the packet (corpus, snapshot, flags, estimate); run `--send` only after approval
- [ ] 7.2 Check each mode's mix within ±10 points (frontier at most cap + 10); if scores clump, stop and ask about the effort tiebreak (design D3)
- [ ] 7.3 Write `SEED_CUTPOINTS` from the `report` candidates and `docs/evidence/<date>-knowledge-tier-mix.md`; seed/evidence equality test

## 8. Docs, ADR and release notes

Blocked by: 5, 7

- [ ] 8.1 `docs/decisions/0010-knowledge-tiers.md`; mark the superseded parts of ADR 0008
- [ ] 8.2 Update `docs/configuration.md`, `docs/usage-guide.md`, `docs/glossary.md`, `docs/domain-model.md`, `docs/architecture.md`, `docs/jev-contract.md`, `docs/testing.md`, `docs/scenarios.md`, `README.md`
- [ ] 8.3 `CHANGELOG.md` entry naming the renames and deprecated keys
- [ ] 8.4 Full gate: `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun test`

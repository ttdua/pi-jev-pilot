# WG-19 Release Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Ship 0.1: pinned git install, release metadata kept consistent by a test, a replay report pass that measures what 0.1 decides on real sessions, and a rewritten README with scenario docs backed by that evidence.

**Architecture:** No change under `src/`. The report pass is a sibling of pass 1 in `scripts/replay`. It reuses the corpus, inputs, `runPlan` and `writeOutputs`, and adds one pure module, `report.ts`, for planning, routing and aggregation. That module imports only `src/jev/`, `src/policy/` and `src/shared/` (existing lint boundary). Release metadata is checked by a pure checker in a test file. Documentation is written after the real run, from its aggregates.

**Tech Stack:** TypeScript, Bun test, oxlint/oxfmt, the package's own `src/policy` and `src/jev` builders.

## Global Constraints

- Tests need no secrets, paid calls or network beyond loopback (`tests/jev/fixture.ts`).
- `scripts/` never imports `src/host/`, `src/store/` or `@earendil-works/*`.
- Report outputs only under `<agentDir>/jev/replay/<run-id>/`, owner-only (0700 dir, 0600 files). `aggregates.json` counts only.
- No `--send` without operator approval of the dry-run counts and cost. No push, tag push or PR without explicit go-ahead.
- Everything committed is English. No prompt, brief, case text or account detail in the repository.
- No new dependency. `typebox` is already in `bun.lock` through the host package.

## Review Focus

- **Corpus with no worker samples or no snapshot:** the report must still write main aggregates and say workers were skipped. Covered in Task 4 (`no snapshot skips workers`).
- **Every request misses (Jev down, bad key):** the run completes with empty distributions, not a crash or division by zero. Covered in Task 6 (`all misses`).
- **Config with no slot:** both routings give the same targets and the reviewer table is empty, not an error. Covered in Task 5 (`no slot configured`).
- **Fewer than `WINDOW_MIN` worker samples:** routing stays on the seed for the whole stream. Covered in Task 5 (`seed then window`, with 150 and with 20 answers).
- **Main sample without a start effort:** counted in the distribution only, never in lowered, same or raised. Covered in Task 6 (`no start effort`).

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `--pass` CLI argument of `scripts/replay/cli.ts` | modified | `--pass 1 \| report`. Any other value is a usage error (exit 2) naming `1` and `report`. `--only` with `report` is a usage error | yes (operator CLI) |
| `Args.pass` (`scripts/replay/config.ts`) | modified | `pass: 1 \| "report"` | no |
| `USAGE` (`scripts/replay/config.ts`) | modified | `usage: bun scripts/replay/cli.ts --pass 1\|report [--seed N] [--main N] [--workers N] [--sessions DIR] [--capabilities FILE] [--models FILE] [--url URL] [--only VARIANTS] [--send]` | no |
| `planReport(input: ReportPlanInput): Plan` (`scripts/replay/report.ts`) | new | `ReportPlanInput = { main: RebuiltMain[]; workers: RebuiltWorker[]; config: PlainConfig; hasSnapshot: boolean }`. Variants `report` and `rerun`, base `report`, kinds `main` and `worker` | no |
| `REPORT_MODES` (`report.ts`) | new | `["budget", "standard", "premium"] as const` | no |
| `Routing` (`report.ts`) | new | `"slots" \| "tiers"` | no |
| `routeStream(answers: readonly (Extract<WorkerAnswers, { kind: "read" }> \| undefined)[], o: { config: PlainConfig; mode: ModeName; routing: Routing; background: readonly boolean[] }): (string \| undefined)[]` (`report.ts`) | new | One target per answer (`fast`, `balanced`, `deep`, `expert`, `slot::<name>`, `none`), or `undefined` for a miss. In sample order. Each non-slot routed launch is added to the window as a `WindowLine` `{ kind: "worker", at: i, rubric: RUBRIC_VERSION, score, expertOffered, reason, tier, fallback, effortP }` | no |
| `ReportAggregates` (`report.ts`, file format `aggregates.json`) | new | see below | yes (evidence input) |
| `compareReport(plan: Plan, results: readonly Result[], meta: ReportMeta): ReportAggregates` | new | `ReportMeta = { runId: string; samples: { main: number; workers: number }; config: PlainConfig; startEffort: readonly (string \| undefined)[]; workerKind: readonly ("review" \| "scout" \| "implementation")[] }` | no |
| `reportCases(plan, results, config, sampleText): DiffCase[]` | new | The existing `DiffCase` type. `variant` is `"rerun"`, `key` is `effort` or `<mode>/<routing>` | no |
| `package.json` `peerDependencies` | modified | `{ "@earendil-works/pi-coding-agent": "*", "typebox": "*" }` | yes |
| `package.json` `version` | modified | `"0.1.0"` | yes |
| `CHANGELOG.md` | new | Keep a Changelog style. `## [0.1.0] - YYYY-MM-DD`, first line `Tag: v0.1.0`, then `### Added` | yes |
| `checkRelease(files: { pkg: string; changelog: string; docs: Record<string, string> }): string[]` (`tests/release-check.ts`) | new | Returns problem messages, empty when consistent | no |

`ReportAggregates`:

```ts
type Counts = Record<string, number>;
type ReportAggregates = {
  v: 1;
  pass: "report";
  runId: string;
  samples: { main: number; workers: number };
  skipped: string[];
  excluded: Record<string, number>;          // by variantKey, as in pass 1
  misses: Record<string, number>;            // by variantKey
  main: Record<"report" | "rerun", {
    effort: Counts;                          // level -> count
    vsStart: { lowered: number; same: number; raised: number };
    vsFixed: { level: string | null; lowered: number; same: number; raised: number };
  }>;
  workers: Record<"report" | "rerun", Record<ModeName, Record<Routing, {
    targets: Counts;                         // target -> count
    reasons: Counts;                         // route reason -> count
    byKind?: Record<"review" | "scout" | "implementation", Counts>; // slots routing only
  }>>>;
  noise: { mainEffort: number; workers: Record<ModeName, Record<Routing, number>> };
};
```

---

## Task 1: Manifest peers — implements 1.1

**Files:**
- Modify: `package.json`, `tests/manifest.test.ts`

**Interfaces:** Produces the `peerDependencies` contract.

- [ ] **Step 1: Write the failing tests** in `tests/manifest.test.ts`:
  - Rename `host package is a peer, not bundled` (scenario name kept): `expect(pkg.peerDependencies).toEqual({ "@earendil-works/pi-coding-agent": "*", typebox: "*" })`, and `dependencies` empty.
  - Add `every imported host package is declared`: walk `src/**/*.ts`, collect `from "<x>"` specifiers that are not relative and not `node:`, map `@scope/name/sub` to `@scope/name` and `name/sub` to `name`, then `expect(Object.keys(pkg.peerDependencies)).toEqual(expect.arrayContaining(names))`.
- [ ] **Step 2:** Run `bun test tests/manifest.test.ts`. Expected: FAIL on the peer set.
- [ ] **Step 3:** Add `"typebox": "*"` to `peerDependencies` in `package.json`. Run `bun install` and check `bun.lock` changes only the root workspace entry.
- [ ] **Step 4:** Run `bun test tests/manifest.test.ts tests/load.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `chore(package): declare typebox as a host peer`.

## Task 2: Release checker — implements 1.2

**Files:**
- Create: `tests/release-check.ts`, `tests/release.test.ts`

**Interfaces:** Produces `checkRelease`, consumed by Task 3 and Task 11.

- [ ] **Step 1: Write the failing fixture tests** in `tests/release.test.ts`. They use inline strings and no repository files:
  - `missing entry fails`: pkg `{"version":"0.2.0"}`, changelog with only `## [0.1.0] - 2026-11-07\n\nTag: v0.1.0` → result contains `CHANGELOG.md has no entry for 0.2.0`.
  - `unpinned install fails`: docs `{ "README.md": "pi install git:github.com/ttdua/pi-jev-pilot\n" }` → result contains `README.md: install command not pinned to @v0.1.0`.
  - `banner fails`: docs `{ "docs/x.md": "Status: design phase." }` → result names `docs/x.md` and `design phase`.
  - `consistent passes`: version 0.1.0, matching entry, pinned line in `README.md` and `docs/usage-guide.md`, no banner → `[]`.
- [ ] **Step 2:** Run `bun test tests/release.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `checkRelease`** in `tests/release-check.ts`:
  - **Entry:** regex `^## \[<version>\]` (multiline); the section up to the next `## [` must contain `v<version>`.
  - **Install lines:** every match of `pi install git:github\.com/ttdua/pi-jev-pilot(\S*)` must have suffix exactly `@v<version>`. `README.md` and `docs/usage-guide.md` must each have at least one.
  - **Banners:** case-insensitive phrases `design phase`, `no code yet`, `Nothing is installable`, `describes the planned behavior`.
- [ ] **Step 4:** Run `bun test tests/release.test.ts`. Expected: fixture tests PASS.
- [ ] **Step 5: Add the repository test** `repository release metadata is consistent`. It reads `package.json`, `CHANGELOG.md`, `README.md` and every `docs/**/*.md` except `docs/evidence/` and `docs/decisions/`, and expects `checkRelease(...)` to equal `[]`. Mark it `test.todo` until Task 11 makes it pass, so CI stays green between commits.
- [ ] **Step 6: Commit** `test(release): add release metadata checker`.

## Task 3: Version and changelog — implements 1.3

**Files:**
- Modify: `package.json`
- Create: `CHANGELOG.md`

- [ ] **Step 1:** Set `"version": "0.1.0"`. Keep `"private": true`: it only blocks an accidental npm publish and has no effect on a git install.
- [ ] **Step 2:** Write `CHANGELOG.md`:
  - A one-line intro.
  - `## [0.1.0] - <release date>`, then `Tag: v0.1.0`.
  - `### Added`: one bullet per user-facing feature (main effort and hold; skill pick; strategy advice; worker routing by mode with the expert tier; slots and fallback; tool assessment, observe only; `jev_review` CLI review; tally and verbose log; bounded auto-tuning; `/jev` commands and status line).
  - `### Notes`: replaces `naicoi92/pi-jev-pilot` and cannot run beside it.
- [ ] **Step 3: Commit** `docs(changelog): add 0.1.0 entry`.

## Task 4: Report pass argument and plan — implements 2.1, 2.2

**Files:**
- Modify: `scripts/replay/config.ts`
- Create: `scripts/replay/report.ts` (plan part)
- Test: `tests/replay/cli.test.ts`, `tests/replay/report.test.ts`

**Interfaces:**
- Consumes: `RebuiltMain`, `RebuiltWorker` (`inputs.ts`); `PlainConfig`, `Plan`, `PlannedRequest`, `variantKey` (`variants.ts`); `mainState`, `pickRich`, `SHIPPED_MAIN_GROUPS`, `buildWorkerState` (`src/jev/state.ts`); `mainQuestions`, `buildWorkerQuestions`, `offeredTiers` (`src/jev/questions.ts`).
- Produces: `Args.pass`, `USAGE`, `planReport`, `ReportPlanInput`.

- [ ] **Step 1: Write the failing tests:**
  - `cli.test.ts`, `parses --pass report`: `parseArgs(["--pass","report"]).pass === "report"`.
  - `cli.test.ts`, `unknown pass`: replace the existing `--pass 2 exits 2 with a message` test. It now expects exit 2 and `err` containing `1` and `report`.
  - `cli.test.ts`, `--only refused with report`: `parseArgs(["--pass","report","--only","full"])` throws `UsageError`.
  - `report.test.ts`, `shipped main state`: for a rebuilt sample with `last_decision` and a snapshot, the `report` request state `toEqual(mainState({ prompt, items, platforms, rich: pickRich(rich, SHIPPED_MAIN_GROUPS) }))`, and the `rerun` request is deep-equal.
  - `report.test.ts`, `one worker request per variant`: 10 worker samples with agents → 10 `report` and 10 `rerun` worker requests.
  - `report.test.ts`, `configured worker targets`: config with four tiers and slot `reviewer` → the tier question options include `fast`, `balanced`, `deep`, `expert` and `slot::reviewer`.
  - `report.test.ts`, `no snapshot skips workers`: `hasSnapshot: false` → no worker request, `skipped` contains `workers`, main requests still planned.
  - `report.test.ts`, `missing group excluded`: a main sample with `missing: ["last_decision"]` is excluded and counted under `report` and `rerun`.
- [ ] **Step 2:** Run `bun test tests/replay`. Expected: the new tests FAIL.
- [ ] **Step 3:** In `config.ts`, accept `--pass report`. The error message is `--pass accepts 1 or report`. Throw `UsageError("--only applies to pass 1")` when both are given, and update `USAGE`.
- [ ] **Step 4: Implement `planReport`** in `report.ts`:
  - Main requests use `mainQuestions({ askEffort: true, askStrategy: true })` and `pickRich(m.rich, SHIPPED_MAIN_GROUPS)`. A sample missing any shipped group is excluded.
  - Worker requests use the pass 1 `initialState` rules with no parent request, and questions from `buildWorkerQuestions(offeredTiers(config.tiers, config.expertOn), {}, config.slots)`.
  - Each request has `base: "report"`.
  - Export `initialState` and `workerQuestions` from `variants.ts` instead of copying them.
- [ ] **Step 5:** Run `bun test tests/replay` and `bun run lint`. Expected: PASS, no boundary error.
- [ ] **Step 6: Commit** `feat(replay): plan the report pass`.

## Task 5: Per-mode routing with a rolling window — implements 2.3

**Files:**
- Modify: `scripts/replay/report.ts`
- Test: `tests/replay/report.test.ts`

**Interfaces:**
- Consumes: `routeLaunch`, `RouteInput` (`src/policy/route.ts`); `cutPointsFor`, `SEED_CUTPOINTS`; `windowEntries`, `WINDOW_MAX`, `WindowLine` (`src/policy/cut-window.ts`); `difficultyScore` (`src/policy/score.ts`); `RUBRIC_VERSION` (`src/jev/rubrics.ts`); `isSlot`, `slotName`.
- Produces: `REPORT_MODES`, `Routing`, `routeStream`.

- [ ] **Step 1: Write the failing tests.** Build worker answers with a helper `workerAnswers({ tier, tierP, effort, risky })` added to `tests/replay/helpers.ts`.
  - `three modes, two routings`: one answer → `routeStream` called for each of 3 modes × 2 routings returns one target each (six targets).
  - `seed then window`: 150 answers with spread scores in `standard`. Targets of the first 100 equal routing with `cuts: SEED_CUTPOINTS.standard`. Target 101 equals routing with `cutPointsFor(windowOf(first 100), "standard")`. Repeat with 20 answers: all on the seed.
  - `slot launch skips the window`: answer 0 routes to `slot::reviewer` (p .9). The window seen by answer 1 has 0 entries. Assert through an exported `windowAfter(...)` test hook or by comparing with a stream that has no answer 0.
  - `no-slot routing`: the same answer with `routing: "tiers"` gives a tier, not `slot::reviewer`.
  - `no slot configured`: config without slots → `slots` and `tiers` routings give identical targets.
  - `miss stays undefined`: an `undefined` answer gives `undefined` and adds nothing to the window.
- [ ] **Step 2:** Run `bun test tests/replay/report.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `routeStream`:**
  - **Per answer:** `routeLaunch({ answers, launch: { resume: false, inheritContext: false, runInBackground, modelLocked: false, thinkingLocked: false }, offered, cuts: cutPointsFor(windowEntries(lines.slice(-WINDOW_MAX), RUBRIC_VERSION), mode), forkedLaunch: "untouched", canRun: () => true, thinkingOf: () => ({ reasoning: true }), modelOf, slots })`.
  - **Slots per routing:** `slots` is `config.slots` names for `"slots"` and `[]` for `"tiers"`.
  - **Target:** `record.tier ?? "none"`.
  - **Window:** when the target is not a slot, push the `WindowLine` from the contract. `effortP` is the effort answer's probabilities, so that `modalEffort` matches the host.
- [ ] **Step 4:** Run `bun test tests/replay/report.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(replay): route report workers per mode with a rolling window`.

## Task 6: Report aggregates and cases — implements 2.4

**Files:**
- Modify: `scripts/replay/report.ts`
- Test: `tests/replay/report.test.ts`

**Interfaces:**
- Consumes: `routeStream`, `Result`, `DiffCase` (`compare.ts`), `readAnswers`, `readWorkerOutcome`, `decideEffort`, `EFFORT_LEVELS`.
- Produces: `ReportAggregates`, `ReportMeta`, `compareReport`, `reportCases`.

- [ ] **Step 1: Write the failing tests:**
  - `effort against start`: three main samples with start `high`, decided `medium`, `high`, `xhigh` → `vsStart` `{ lowered: 1, same: 1, raised: 1 }`; `vsFixed.level === "high"` with the same counts.
  - `no start effort`: a sample without a start effort counts in `effort` only.
  - `reviewer share by kind`: 4 review and 6 implementation briefs, with 3 review and 1 implementation answered `slot::reviewer` at .9 → `workers.report.standard.slots.byKind.review["slot::reviewer"] === 3` and `implementation["slot::reviewer"] === 1`.
  - `miss excluded from noise`: one `rerun` worker result is a miss → that sample counts in no `noise.workers` value, and `misses["worker:rerun"] === 1`.
  - `all misses`: every result a miss → `effort` `{}`, `targets` `{}`, `noise` all 0, no throw.
  - `cases list only differing samples`: one main sample decided `low` in `report` and `high` in `rerun` → one case with `key: "effort"`, text cut to 300 code points.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement `compareReport` and `reportCases`:**
  - **Main effort:** decided as in pass 1 `mainKeys` (`decideEffort` over `EFFORT_LEVELS`).
  - **Lowered, same, raised:** compare `EFFORT_LEVELS` indices. Start levels outside `EFFORT_LEVELS` count as no start.
  - **Fixed level:** the most common start level; ties go to the higher level; `null` when there is none.
  - **Workers:** per variant, call `routeStream` for each mode × routing over the variant's answers in sample order. `byKind` comes only for `"slots"`.
  - **Noise:** compares `report` and `rerun` per sample where both are defined.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(replay): aggregate the report pass`.

## Task 7: Wire the report pass into the CLI — implements 2.5

**Files:**
- Modify: `scripts/replay/cli.ts`, `scripts/replay/outputs.ts` (widen the aggregates type to `Aggregates | ReportAggregates`)
- Test: `tests/replay/cli.test.ts`

- [ ] **Step 1: Write the failing tests** against the loopback fixture with `tests/fixtures/replay/sessions`:
  - `report dry run`: `--pass report` without `--send` → exit 0, fixture records 0 requests, `out` matches `/requests: \d+/` and `/cost: \$/`.
  - `report send`: `--pass report --send` with a key and a capabilities snapshot fixture → fixture request count equals the dry-run count. `aggregates.json` has `pass: "report"` and does not contain `JEV-MARKER-PROMPT`, while `cases.md` does. Use a fixture answering the rerun differently for one prompt.
  - `report with Jev down`: fixture answers HTTP 500 → exit 0, `aggregates.json` written, misses equal requests.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Branch `replay()` on `args.pass`:**
  - **Report:** build `planReport`, then reuse `printDryRun`, `runPlan` and `writeOutputs` with `compareReport` and `reportCases`. Pass `startEffort` and `workerKind` arrays built from the sampled items.
  - **Run id:** `runIdOf("report")` gives `...-report`.
  - **Worker sample size:** keep `--workers` default 46 for pass 1. Use 200 for the report when `--workers` is not given; record this in `USAGE`.
- [ ] **Step 4:** Run `bun test tests/replay` and `bun run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(replay): run the report pass from the CLI`.

## Task 8: Testing docs — implements 2.6

**Files:**
- Modify: `docs/testing.md`

- [ ] **Step 1:** Add a `### Release report` subsection under *Replay rules*. It covers:
  - the purpose;
  - the commands (snapshot, dry run, `--send`);
  - the outputs;
  - the read-with-care note: routing, not quality;
  - the slot-ignored approximation for the `tiers` routing (design D3).
- [ ] **Step 2:** Run `bun run fmt:check`. Expected: PASS.
- [ ] **Step 3: Commit** `docs(testing): document the replay report pass`.

## Task 9: Real run — implements 3.1, 3.2 (operator gate)

- [ ] **Step 1:** Run `bun tests/host/manual/capabilities-snapshot.ts <scratch>/capabilities.json`.
- [ ] **Step 2:** Run `bun scripts/replay/cli.ts --pass report --capabilities <scratch>/capabilities.json` (dry run). Record samples, exclusions, request count and cost.
- [ ] **Step 3: Stop.** Send the printed counts and cost to the operator through the Inbox with an approve or decline question. Do not send until approved.
- [ ] **Step 4:** After approval, run the same command plus `--send`. Keep the output directory outside the repository and never commit `cases.md`.

## Task 10: Evidence file — implements 3.3

**Files:**
- Create: `docs/evidence/<run date>-release.md`

- [ ] **Step 1:** Write it in the existing evidence style: title, scope line, **Read with care**, a *Data* table (source, sample, request, model, requests and misses), then *Main effort*, *Worker tier mix by mode* (both routings), *Reviewer slot*, *Rerun noise* and *Method notes*.
  - *Main effort* has the distribution, vs start, and vs fixed level.
  - *Method notes* cover sample order, the snapshot exclusions, the `tiers` approximation, and that the start effort comes from the earlier port.
  - Include a placeholder section *Install acceptance* to be filled in Task 13.
- [ ] **Step 2:** Check that no number appears that is not in `aggregates.json`.
- [ ] **Step 3: Commit** `docs(evidence): add the 0.1 release report`.

## Task 11: Scenarios and README — implements 4.1, 4.2, 4.3

**Files:**
- Create: `docs/scenarios.md`
- Modify: `README.md`, `docs/README.md`, `docs/usage-guide.md`, `tests/release.test.ts`

- [ ] **Step 1: Write `docs/scenarios.md`** with four `##` sections. Each has *When it applies*, *What you do*, *What the package decides*, and *Measured* (with a link to the evidence anchor). The fourth, *Which rule wins*, has three ordered lists:
  - **Worker:** `resume` or fork `untouched` → agent `locked` → `expert` → `risky` → slot ≥ .6 → cut → availability fallback; then effort: Jev → `high` on risk → cap `xhigh` → cap `medium` on `fast` → clamp.
  - **Main:** manual level change discards the pending result → hold providers → Jev choice → `high` on risk → cap `xhigh` → `max` left alone.
  - **Config:** `tuning.json` → `state.json` → `config.json` → default.

  Each list links `docs/domain-model.md#workerdecision`, `#maindecision` and `docs/configuration.md`.
- [ ] **Step 2: Rewrite `README.md`**, at most about 80 lines, in this order:
  - a one-paragraph pitch;
  - a "What changes for you" table with the four scenarios: one line of benefit and the headline number each, linking `docs/scenarios.md`;
  - *Install*: three commands, executor, pinned package, key; then the config pointer;
  - *Check it works*: `/jev` and the status line;
  - *Documentation* links;
  - *Relationship to other projects*, kept.
- [ ] **Step 3:** In `docs/README.md`, remove the banner and add *Scenarios* under *Using the package* and the release evidence under *Evidence*. In `docs/usage-guide.md`, remove the banner and change the install line to `pi install git:github.com/ttdua/pi-jev-pilot@v0.1.0`.
- [ ] **Step 4:** Turn the `test.todo` from Task 2 into `test`, and add `scenario documentation links its evidence`: `docs/scenarios.md` has the four headings, and each of the first three sections contains `](evidence/`; `README.md` contains `](docs/scenarios.md)`.
- [ ] **Step 5:** Run `bun test tests/release.test.ts` and `bun run fmt:check`. Expected: PASS.
- [ ] **Step 6: Commit** `docs: rewrite README and add usage scenarios for 0.1`.

## Task 12: Roadmap and full check — implements 4.4, 4.5

**Files:**
- Modify: `docs/roadmap.md`

- [ ] **Step 1:** Change WG-19 *Done when* to: "the `v0.1.0` tag installs with `pi install git:github.com/ttdua/pi-jev-pilot@v0.1.0` into a clean `PI_CODING_AGENT_DIR` and passes the acceptance checklist in the release evidence. Pushing the tag needs the operator's explicit go-ahead." Status stays *Planned* until Task 13.
- [ ] **Step 2:** Run `bun run typecheck && bun run lint && bun run fmt:check && bun run test`. Expected: all PASS.
- [ ] **Step 3: Commit** `docs(roadmap): reword WG-19 acceptance to a git-tag install`.

## Task 13: Tag acceptance — implements 5.1, 5.2 (operator gate)

- [ ] **Step 1: Stop.** Ask the operator for the go-ahead to push the branch, open the PR and, after merge, push tag `v0.1.0` on the merge commit.
- [ ] **Step 2:** After the tag exists, the operator runs `PI_CODING_AGENT_DIR=$(mktemp -d) pi install git:github.com/ttdua/pi-jev-pilot@v0.1.0` plus the executor, then checks four points:
  - install exits 0 with no load error;
  - `/jev` shows the mode with no warning;
  - one prompt writes a `main` ledger line;
  - one `subagent` launch writes a `worker` line.
- [ ] **Step 3:** Fill *Install acceptance* in the evidence file with the Pi, executor and tag versions and pass or fail per point. Set WG-19 to *Done* in `docs/roadmap.md`. Commit `docs(evidence): record 0.1 install acceptance`.

---

## Scenario → test

**package-loading**
- Manifest names one entry point → `tests/manifest.test.ts` `manifest names one entry point` (existing)
- Host package is a peer, not bundled → `tests/manifest.test.ts` `host package is a peer, not bundled` (updated, Task 1)
- Every imported host package is declared → `tests/manifest.test.ts` `every imported host package is declared` (Task 1)

**release-metadata**
- Current version is in the changelog → `tests/release.test.ts` `repository release metadata is consistent` (Tasks 2, 11)
- Missing entry fails → `tests/release.test.ts` `missing entry fails` (Task 2)
- Pinned install → `tests/release.test.ts` `repository release metadata is consistent`
- Unpinned install fails → `tests/release.test.ts` `unpinned install fails` (Task 2)
- Banners removed → `tests/release.test.ts` `repository release metadata is consistent`, and `banner fails`
- Links present → `tests/release.test.ts` `scenario documentation links its evidence` (Task 11)

**state-replay**
- Add-one variant, Reversed options, Reruns present → `tests/replay/variants.test.ts` existing `add-one`, `reversed options`, `reruns present`
- Within noise, Beyond noise → `tests/replay/compare.test.ts` existing tests
- Report accepted → `tests/replay/cli.test.ts` `report dry run` (Task 7)
- Unknown pass → `tests/replay/cli.test.ts` `unknown pass` (Task 4)
- Only refused → `tests/replay/cli.test.ts` `--only refused with report` (Task 4)
- One worker request per variant → `tests/replay/report.test.ts` `one worker request per variant` (Task 4)
- No snapshot → `tests/replay/report.test.ts` `no snapshot skips workers` (Task 4)
- Shipped main state → `tests/replay/report.test.ts` `shipped main state` (Task 4)
- Configured worker targets → `tests/replay/report.test.ts` `configured worker targets` (Task 4)
- Three modes, two routings → `tests/replay/report.test.ts` `three modes, two routings` (Task 5)
- No-slot routing → `tests/replay/report.test.ts` `no-slot routing` (Task 5)
- Seed then window → `tests/replay/report.test.ts` `seed then window` (Task 5)
- Slot launch skips the window → `tests/replay/report.test.ts` `slot launch skips the window` (Task 5)
- Effort against start → `tests/replay/report.test.ts` `effort against start` (Task 6)
- Aggregates hold no text → `tests/replay/cli.test.ts` `report send` (Task 7)
- Reviewer share by kind → `tests/replay/report.test.ts` `reviewer share by kind` (Task 6)
- Miss excluded from noise → `tests/replay/report.test.ts` `miss excluded from noise` (Task 6)
- Jev unavailable → `tests/replay/cli.test.ts` `report with Jev down` (Task 7) and `report.test.ts` `all misses` (Task 6)

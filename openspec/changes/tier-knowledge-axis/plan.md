# Knowledge Tiers and Independent Effort Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Rename the worker tiers to knowledge tiers (`basic`, `broad`, `deep`, `frontier`), decide tier and effort independently, gate strategy advice on effort, and re-derive the seed.

**Architecture:** Task 1 is a behaviour-neutral rename across every consumer, plus the legacy read path, so every later commit stays green. Tasks 2–4 change behaviour in pure policy, rubric wording and the main request. Task 5 finishes the command layer, Task 6 makes the replay emit a seed candidate, Task 7 is the operator replay, Task 8 docs.

**Tech Stack:** TypeScript on Bun (`bun test`, `bun check`, `oxlint`, `oxfmt`), Pi extension API, TypeSafe Jev.

## Global Constraints

- Tier ladder exactly `basic`, `broad`, `deep`, `frontier`; feature list exactly `effort`, `subagents`, `skills`, `strategy`, `frontier`, `status`, `verbose`.
- Legacy names (`fast`, `balanced`, `expert`, `expertOffered`, `switches.expert`, `/jev expert`) only on read/parse; writers never emit them. Mark alias code `// DEPRECATED(remove next minor)`.
- `RUBRIC_VERSION` = 3. Wording in `src/jev/rubrics.ts` is copied verbatim from `docs/jev-questions.md`.
- Mode targets: `budget` 50/40/10/0, `standard` 20/53/26/1, `premium` 0/50/47/3.
- `policy/` stays pure (no Pi import); fail open on any Jev failure; decide on probabilities only; no prompt text stored.
- Tests need no secrets, paid calls or network beyond loopback. Task 7's `--send` is an operator step with explicit approval.
- **Every commit is green:** `bun run typecheck && bun run lint && bun test` passes at the end of every task. A task that changes a signature or field fixes every caller and test in the same task.

## Review Focus

- Upgrading with an old `config.json` (`tiers.fast` etc.) or `state.json` (`switches.expert`) is rewritten at the first start and keeps routing working even when the write fails → Task 1 tests "Config migrated at start", "Write failure", "Every deprecated tier key", "Legacy expert switch moved".
- A ledger written by the previous version still loads and simply stays out of the window → Task 1 "Legacy expert line accepted", Task 2 "Miss and untouched left out".
- `strategy` on with a non-reasoning or held model: `effort` asked for the gate never moves the level or the suffix → Task 4 "Gate-only effort on a non-reasoning model", "Held gate-only effort shows the level in force".
- A slot at ≥ .6 together with a high `frontier` probability → Task 2 "Expert stands on high risk", Task 4 host check "Frontier wins over the reviewer slot".
- An operator with a slot already named `frontier` → Task 1 "Existing frontier slot still read", Task 5 "Legacy frontier slot blocks writes".
- Upgrading with auto-tuning active (`tuning.json` with a tuned `timeoutMs`, history and a pending change) → Task 1 "Tuning file from the previous version reads unchanged" and "Legacy fast counts as low".

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `TierName`, `TIER_LADDER` (`src/policy/launch.ts`) | modified | `"basic" \| "broad" \| "deep" \| "frontier"`, ladder in that order | no |
| `LEGACY_TIER` (`src/policy/launch.ts`) | new | `Readonly<Record<"fast" \| "balanced" \| "expert", TierName>>` = `{ fast: "basic", balanced: "broad", expert: "frontier" }` | no |
| `TIERS`, `FEATURES`, `DECISION_FEATURES`, `RESERVED_SLOT_NAMES`, `DEFAULTS.switches` (`src/store/defaults.ts`) | modified | tier names as `TierName`; feature `frontier` replaces `expert`; reserved adds `frontier` and keeps `expert` | no |
| `config.json` `tiers` | modified | `{ basic?, broad?, deep?, frontier?: "provider/id" }`; aliases `fast`, `balanced`, `expert` read-only; notice `tiers.<old> is deprecated; rename it to tiers.<new>`; alias + new key = problem at alias | **yes** |
| `migrateTierKeys`, `migrateConfigFile` (`src/store/config.ts`), `migrateLegacyNames` (`src/host/platform/migrate.ts`) | new | see Task 1 Step 5 | no |
| `config.json` / `state.json` on disk | modified | rewritten once at main `session_start` to the new names (config: in-place key rename, mode kept; state: `switches.expert` → `switches.frontier`) | **yes** |
| `config.json` `crew.slots[].name` | modified | `frontier` reserved for writes; an existing `frontier` slot is read with notice `crew.slots "frontier" uses a reserved name; rename it` | **yes** |
| `state.json` `switches` | modified | key `frontier`; legacy boolean `expert` moved to `frontier` when absent, else dropped | **yes** |
| `/jev` command | modified | `/jev frontier on\|off`; `/jev expert on\|off` alias + report line `notice: /jev expert is deprecated; use /jev frontier`; mix line `mix (last <n>, <mode>): basic <a>% / broad <b>% / deep <c>% / frontier <d>% · target <f>/<b>/<d>/≤<cap>` | **yes** |
| `JevArgs` `set` branch (`src/host/commands/args.ts`) | modified | `{ kind: "set"; feature: Feature; on: boolean; deprecatedName?: "expert" }` | no |
| Ledger worker line (file format) | modified | writes `frontierOffered`, targets `basic\|broad\|deep\|frontier\|slot::<name>`, reasons `frontier\|cut\|slot\|untouched\|miss`; schema also accepts `expertOffered`, targets `fast\|balanced\|expert`, reasons `expert\|risky\|expert-admitted\|expert-denied\|fast-unsure\|choice` | **yes** |
| `DecisionFields` (`src/policy/worker/ledger-line.ts`) | modified | `frontierOffered?: boolean` replaces `expertOffered` | no |
| `WindowLine` (`src/policy/worker/cut-window.ts`) | modified | `frontierOffered?: boolean` replaces `expertOffered`; `effortP` kept (ignored) | no |
| `WindowEntry` | modified | Task 1: `{ score; effort; decided: TierName }`; Task 2: `{ score: number; decided: TierName }` | no |
| `RecentMix.shares` | modified | `Readonly<Record<TierName, number>>` (new keys) | no |
| `CutPoints` (`src/policy/worker/cutpoints.ts`) | modified | `{ basicMax: number; broadMax: number; frontierMin: number }` | no |
| `ModeTarget` (`src/policy/worker/modes.ts`) | modified | `{ basic: number; broad: number; deep: number; frontierCap: number }` | no |
| `SEED_CUTPOINTS` (`src/policy/worker/seed.ts`) | modified | `Record<ModeName, CutPoints>`; Task 2 provisional, Task 7 final | no |
| `difficultyScore(answers)` (`src/policy/worker/score.ts`) | modified | `(answers: Record<string, Answer>) => number \| undefined`; rounded `Σ rank·P̂` over tier keys; ignores `effort` | no |
| `TierDecision` decided branch (`src/policy/worker/tier.ts`) | modified | `{ kind: "decided"; tier: Target; reason: "frontier" \| "slot" \| "cut" }`; the `none` branch is unchanged | no |
| `EffortInput` (`src/policy/effort.ts`) | modified | `{ effort?: ChoiceAnswer; risky?: number; movedByFallback: boolean }` (no `tier`) | no |
| `offeredTiers` (`src/jev/questions.ts`) | modified | `(tiers: Partial<Record<TierName, string>>, frontierOn: boolean) => TierName[]` | no |
| `mainQuestions(o)` (`src/jev/questions.ts`) | modified | `o: { applyEffort: boolean; askStrategy?: boolean; skills?: readonly SkillEntry[] }`; asks `effort` if `applyEffort \|\| askStrategy`, `risky` iff `applyEffort`, then `strategy`, `corrects`, skills; never `tier` | no |
| `AdviceInput` (`src/policy/main/strategy.ts`) | modified | `{ strategy?: { choice: string; probabilities: Record<string, number> }; effort?: EffortLevel }` (raw choice) | no |
| `OutcomeFlags`, `TurnPlan` | modified | `askEffort` renamed `applyEffort` (effort-eligible) | no |
| `PlainConfig` (`scripts/replay/variants.ts`) | modified | `frontierOn: boolean` replaces `expertOn`; `tiers` keyed by `TierName` | no |
| `aggregates.json` `seedCandidates` (report pass; type `ReportAggregates` in `scripts/replay/report-compare.ts`) | new | `Record<"report" \| "rerun", Record<ModeName, { basicMax: SerializedCut; broadMax: SerializedCut; frontierMin: SerializedCut }>>` with `type SerializedCut = number \| "Infinity" \| "-Infinity"` | **yes** (operator file) |
| `RouteOptions` (`scripts/replay/report-route.ts`) | modified | adds `seed: CutPoints`, used while the window holds fewer than 100 entries; `routeStream(answers, o)` and `routeStreamRecords(answers, o)` keep their signatures | no |
| Replay CLI flags | unchanged | `--pass report --main N --workers N --sessions DIR --capabilities FILE --send`; `--models` is parsed but unused (no display-name prefix in replay requests) | **yes** (operator CLI) |
| Main ledger line | modified | `effortP`, `risky`, `requested` only when effort-eligible | **yes** (file format) |
| `RUBRIC_VERSION` | modified | `3` | no |
| `MAIN_TIER_INSTRUCTION` (`src/jev/rubrics.ts`) | new (Task 3, internal) | v2 main `tier` instruction, kept as separate data until Task 4 removes the main tier | no |

---
## Task 1: Tier vocabulary rename and legacy read path — implements 1

**Covers:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
**Difficulty:** Hard
**Blocked by:** none

**Files** (every file that names a tier, the switch or the renamed fields; the list from `rg -l -w -e '"fast"' -e '"balanced"' -e '"expert"' -e expertOffered -e expertOn -e fastMax -e balancedMax -e expertMin -e expertCap src scripts tests`, rerun before starting):
- Modify `src/`: `policy/launch.ts`, `policy/effort.ts`, `policy/tuning/signals.ts`, `policy/worker/{cut-window,cutpoints,ledger-line,modes,seed,tier,score,route}.ts`, `policy/main/{strategy,outcome}.ts` (tier literals only), `store/{defaults,config,state-file,ledger-schema,settings-sections}.ts`, `jev/{questions,rubrics}.ts` (keys only, wording unchanged), `host/status/line.ts`, `host/commands/{args,apply,jev,status-format}.ts`, `host/worker/request.ts`
- Modify `scripts/replay/`: `config.ts`, `variants.ts`, `compare.ts`, `report.ts`, `report-route.ts`
- Modify tests: `tests/policy/{launch,effort}.test.ts`, `tests/policy/tuning/signals.test.ts`, `tests/policy/worker/{answers,cut-window,cutpoints,ledger-line,modes,route,route-pin,score,tier,worker-line}.test.ts`, `tests/policy/main/{outcome,strategy,ledger-line}.test.ts`, `tests/store/{config-read,config-write,ledger,ledger-pin,ledger-schema,settings,settings-pin,settings-sections,state-file,tuning-file,validate}.test.ts`, `tests/jev/questions.test.ts`, `tests/host/{worker-ledger,worker-routing,main,fixture,jev-base,launch-policy-evidence,directory-mode-e2e,effort-hold,strategy-advice,verbose-log}.test.ts`, `tests/host/worker-fakes.ts`, `tests/host/worker/{cutpoint-window,policy,warnings}.test.ts`, `tests/host/main/{gate,session}.test.ts`, `tests/host/status/{line,tally,worker-line}.test.ts`, `tests/host/commands/{jev,slots,apply,args}.test.ts`, `tests/replay/{cli,compare,pin-report,report,report-compare,report-route,variants}.test.ts`, `tests/replay/helpers.ts`, `tests/release-check.ts`, `tests/release.test.ts`
- Create: `src/host/platform/migrate.ts`, `tests/host/platform/migrate.test.ts`
- Modify (migration wiring): `src/host/wiring/session.ts`, `tests/host/setup-wiring.test.ts`
- Modify docs (key names only): `docs/jev-questions.md` (tier table keys, read by `tests/jev/questions.test.ts`), `README.md` (`/jev frontier off`, read by `tests/release-check.ts`)
- Evidence fixture: `tests/policy/worker/cutpoints.test.ts` "seed evidence" reads `docs/evidence/2026-11-07-tier-mix.md`; parse its table into the renamed fields (the note itself is history and stays unchanged)

**Interfaces:**
- Produces: every Contracts row marked "modified" by name only (`TierName`, `CutPoints` field names, `ModeTarget`, `frontierOffered`, `frontierOn`, `Feature` `frontier`, reason `frontier`), `LEGACY_TIER`, config/state/ledger/command legacy paths. Behaviour, rubric text and numbers are unchanged in this task (old score, old rules, `RUBRIC_VERSION` 2, old seed values under new field names).

- [ ] **Step 1: Rename** with the map `fast→basic`, `balanced→broad`, `expert→frontier`, `fastMax→basicMax`, `balancedMax→broadMax`, `expertMin→frontierMin`, `expertCap→frontierCap`, `expertOffered→frontierOffered`, `expertOn→frontierOn`, reason `expert→frontier`, switch/command `expert→frontier`, in code, tests, the `docs/jev-questions.md` tier table keys and the README off-switch line (with `tests/release-check.ts` `OFF_SWITCHES`). Rename test names that only name a tier. Replace host test assertions that pin the current rubric as a literal `2` with `RUBRIC_VERSION`; compatibility tests that pin historical rubric values keep their literals. `bun run typecheck && bun run lint && bun test` → PASS with behaviour unchanged.
- [ ] **Step 2: Commit** `refactor(tiers): rename tiers to knowledge names`.
- [ ] **Step 3: Failing tests** for the legacy path. `tests/store/config-read.test.ts`: "Deprecated tier key accepted" (`tiers.fast` → `tiers.basic`, notice names `tiers.basic`), "Every deprecated tier key" (3 notices), "Alias and new key both present" (problem at `tiers.expert`), "Invalid alias value" (problem at `tiers.balanced`), "Existing frontier slot still read". `tests/store/config-write.test.ts`: "New frontier slot refused". `tests/store/state-file.test.ts`: "Legacy expert switch moved", "Frontier wins over the legacy switch", "Legacy expert switch gone after a write", "Non-boolean legacy expert switch". `tests/store/ledger-schema.test.ts`: "Legacy expert line accepted", "Legacy risky line accepted", "Expert admitted accepted" (tier `expert`). `tests/store/ledger-pin.test.ts`: field set includes `frontierOffered` and `expertOffered`. `tests/policy/tuning/signals.test.ts`: "Legacy fast counts as low". `tests/store/tuning-file.test.ts`: "Tuning file from the previous version reads unchanged" (the valid-file fixture of `tuning-file` with history and a pending change, read and compared deep-equal; guards that no tier rename touches `tuning.json`). `tests/host/commands/apply.test.ts`: "Deprecated expert command". `tests/replay/cli.test.ts` (config reading): legacy tier keys normalized, `switches.expert: false` → `frontierOn` false, `frontier` wins when both. `tests/release.test.ts`: README off switch `/jev frontier off`. Migration (`tests/store/config-write.test.ts` for the pure `migrateTierKeys` and the write; `tests/host/platform/migrate.test.ts` for the host step): "Config migrated at start" (key order and file mode kept, one notification), "State migrated at start", "Legacy frontier slot kept", "Nothing to migrate" (bytes and mtime unchanged), "Conflicting keys left alone", "Migration refuses an invalid file", "Write failure" (read-only dir, session starts, alias still routes), "Child session".
- [ ] **Step 4:** `bun test tests/store tests/policy/tuning tests/host/commands tests/replay tests/release.test.ts` → new tests FAIL.
- [ ] **Step 5: Implement.** Config: extend the `applyDeprecatedAlias` pattern per alias; report alias + new key before validation like `reportBothForkKeys`; the slot-name validator accepts an existing `frontier` on read with the notice, `writeSlots` rejects it. State: `parseState` moves `switches.expert`. Ledger: `target()` accepts `TIERS` ∪ legacy names, reasons add `frontier`, fields add `frontierOffered`. Signals: legacy `fast` counts low. Args: head `expert` parses as `{ kind: "set", feature: "frontier", on, deprecatedName: "expert" }` and the report adds the notice. Migration: `migrateTierKeys(raw: Record<string, unknown>): { raw: Record<string, unknown>; renamed: [string, string][] } | undefined` in `src/store/config.ts` (pure; undefined when invalid, conflicting or clean) and `migrateConfigFile(dir): { renamed: [string, string][] } | { error: string } | undefined` that writes with `writeFileAtomic` keeping the mode; `src/host/platform/migrate.ts` `migrateLegacyNames(dir, notify)` runs both migrations, swallows failures and notifies once; `startMain` in `src/host/wiring/session.ts` calls it after `captureMainService()` and before `drawStatus`, never for a child. Replay config: `tiersOf` maps `LEGACY_TIER` keys when the new key is absent; `frontierOn = (switches.frontier ?? switches.expert) !== false`.
- [ ] **Step 6:** `bun run typecheck && bun run lint && bun test` → PASS.
- [ ] **Step 7: Commit** `feat(config): deprecated aliases for the old tier names`.

---

## Task 2: Knowledge-axis decision rules — implements 2

**Covers:** 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
**Difficulty:** Hard
**Blocked by:** Task 1

**Files:**
- Modify: `src/policy/worker/{score,cutpoints,cut-window,modes,tier,route,seed}.ts`, `src/policy/effort.ts`, `scripts/replay/report-route.ts` (window entry shape only)
- Create: `tests/fixtures/seed/provisional-scores.json` (synthetic, documented as such)
- Test: `tests/policy/worker/{score,cutpoints,cut-window,modes,tier,route,route-pin,ledger-line}.test.ts`, `tests/policy/effort.test.ts`, `tests/host/worker/cutpoint-window.test.ts`, `tests/host/worker-routing.test.ts`, `tests/host/worker-ledger.test.ts` (score values), `tests/host/commands/jev.test.ts` (existing target assertions → `20/53/26/≤1`, `0/50/47/≤3`), `tests/replay/report-route.test.ts`, `tests/replay/pin-report.test.ts` (routing characterization under the new rules)

**Interfaces:**
- Consumes: Task 1 names.
- Produces: `difficultyScore`, `CutPoints`, `WindowEntry` without effort, `ModeTarget` values, `TierDecision`, `EffortInput` (Contracts); provisional `SEED_CUTPOINTS`.

- [ ] **Step 1: Failing tests** (spec values): score "Balanced with high effort" = 1, "Mixed probabilities" = 1.4, "Effort unanswered" = 2 for `low`/`max`/unanswered, "Rounded before use" = 1; cut points "Expert cap" (premium) → `.98`, "Frontier cap in standard" → `1.00`, "Ties stay under the cap" → +∞, "Expert never below the balanced cut" → +∞; modes caps 1 and 3, sums 100; tier "Table per mode" (5 rows × 3 modes), "Effort does not move the tier", "Expert stands on high risk" (`slot::reviewer` .6, `frontier` .4 → `frontier`), "Risk wins over a slot" (slot stands), "High effort is not enough" (effort `low` reaches `frontier`); effort "Fast cap" (`xhigh` on `basic`), "Risk floor then fast cap" (`high`); window "Miss and untouched left out" (reasons `risky`, `expert` excluded), "Effort tie"/"Effort from the distribution" (entries carry no effort); host "Frontier wins over the reviewer slot" in `tests/host/worker-routing.test.ts`; seed "Seed is a valid result".
- [ ] **Step 2:** `bun test tests/policy tests/host/worker tests/host/worker-routing.test.ts tests/replay/report-route.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Drop the effort term from the score; `frontierCut(entries, broadMax, cap)` over every `score > broadMax`; remove `modalEffort` and `WindowEntry.effort`; `WINDOW_REASONS = ["frontier", "cut"]`; `MODE_TARGETS` per Global Constraints; `decideTier` = `frontierRule ?? slotRule ?? cutRule`, delete `riskRule`; `workerEffort` without the tier cap. Provisional seed: `cutPoints` over the synthetic scores in `tests/fixtures/seed/provisional-scores.json` for each mode, with a `// PROVISIONAL: replaced in Task 7` comment. In `tests/policy/worker/cutpoints.test.ts` the "seed evidence" describe becomes `test.todo` until Task 7, and a new test recomputes the seed from the fixture. Score literals elsewhere (`tests/policy/worker/ledger-line.test.ts`, `tests/host/worker-ledger.test.ts`, e.g. 1.25 → 1) follow the new formula. Re-derive the `tests/replay/pin-report.test.ts` routing digests only after the rule tests above pass, and check each changed digest against the spec scenario it characterizes (no blind digest update).
- [ ] **Step 4:** `bun run typecheck && bun run lint && bun test` → PASS.
- [ ] **Step 5: Commit** `feat(worker-decision): decide tier on knowledge only`.

---

## Task 3: Rubric wording and worker request — implements 3

**Covers:** 3.1, 3.2
**Difficulty:** Normal
**Blocked by:** Task 2 (shares `tests/host/worker-ledger.test.ts` rubric/score assertions; run after it)

**Files:**
- Modify: `docs/jev-questions.md`, `src/jev/rubrics.ts`
- Test: `tests/jev/questions.test.ts` (worker request and rubric describes; the transitional main-tier assertion), `tests/host/worker-ledger.test.ts` (rubric 3 where pinned)

**Interfaces:**
- Produces: `WORKER_TIER_CRITERIA: Record<TierName, string>`, `TIER_INSTRUCTION`, `WORKER_EFFORT_QUESTION`, `MAIN_EFFORT_INSTRUCTION`, `RUBRIC_VERSION = 3`. `MAIN_TIER_CRITERIA`/`MAIN_TIER_QUESTION` stay until Task 4.

- [ ] **Step 1:** Write the wording in `docs/jev-questions.md`. Pinned openings: tier instruction `Which is the least knowledgeable model tier that has the knowledge this task needs?`; `basic` starts `Common, well-documented knowledge.`; `frontier` starts `Rare, frontier-level expertise.`; worker effort instruction starts `How much work and care does a subagent need to put into carrying out this brief`. Each tier criterion ends by saying length, number of steps, care and risk are effort, not tier; the effort instruction says rare knowledge is a tier matter. The main effort instruction keeps its reply-rule sentence.
- [ ] **Step 2: Failing tests:** "Wording matches the docs", "Premium wording" (instruction opening), "Standard request unchanged" (`basic` opening), "Budget expert criterion" (`frontier` opening), "Main criteria held apart" (no tier criterion names an unknown bug cause, file or step counts, security or production), "Criteria unchanged" (main and worker criteria equal, order `high`, `medium`, `xhigh`, `low`, `max`), "Worker instruction unchanged", "Role rule in the main instruction", "Version of this rubric" = 3, "Wording pinned to the version".
- [ ] **Step 3:** `bun test tests/jev/questions.test.ts` → FAIL.
- [ ] **Step 4:** Copy the wording verbatim into `src/jev/rubrics.ts`; `RUBRIC_VERSION = 3`; update the version-3 snapshot. Until Task 4 deletes it, `MAIN_TIER_CRITERIA` keeps the version-2 text as separate data: change the existing "main criteria equal the worker rubric" assertion to "main criteria are separate data and unchanged" (Task 4 removes it with the main tier).
- [ ] **Step 5:** `bun run typecheck && bun run lint && bun test` → PASS.
- [ ] **Step 6: Commit** `feat(worker-request): knowledge tier rubric and work-care effort rubric`.

---

## Task 4: Main request, strategy gate and status — implements 4

**Covers:** 4.1, 4.2, 4.3, 4.4
**Difficulty:** Hard
**Blocked by:** Task 2, Task 3

**Files:**
- Modify: `src/jev/{questions,rubrics}.ts`, `src/host/main/gate.ts`, `src/policy/main/{strategy,outcome}.ts`, every `askEffort` caller (`rg -l askEffort src tests scripts`: `src/host/main/*.ts`, `tests/host/main.test.ts`, `tests/host/main/gate.test.ts`, `tests/replay/helpers.ts`, `scripts/replay/{variants,report}.ts`)
- Test: `tests/jev/questions.test.ts` (main-request describes), `tests/host/main/gate.test.ts`, `tests/policy/main/{strategy,outcome,ledger-line}.test.ts`, `tests/host/{strategy-advice,effort-hold,main-effort,main}.test.ts`, `tests/host/status/line.test.ts`, `tests/replay/report.test.ts`

**Interfaces:**
- Consumes: Task 3 wording; Task 2 decision.
- Produces: `mainQuestions({ applyEffort, askStrategy, skills })`, `AdviceInput`, `OutcomeFlags.applyEffort`, `TurnPlan.applyEffort`.

- [ ] **Step 1: Failing tests.** Gate/questions: "Strategy on", "Strategy on with effort off" key sets; every "Main questions" scenario ("Strategy only", "Held prompt with strategy on" → `effort`, `strategy`, `corrects`; "Both features on" → `effort`, `risky`, `strategy`, `corrects`); "Main request has no tier". Strategy: every "Strategy gates" row ("Delegate at the boundary" .6 + `medium`, "Delegate on low effort", "Tier unanswered does not block delegate", "Parallel on the fast tier" → `low` blocks, "Graph off the deep tier" → `high` blocks, "Graph at the boundary" `xhigh`, "Gate reads the raw choice"). Outcome: "Gate-only effort applies nothing", "Gate-only effort on a non-reasoning model", "Held gate-only effort shows the level in force"; ledger "Gate-only effort not recorded". Host (`tests/host/effort-hold.test.ts`, `tests/host/strategy-advice.test.ts`, `tests/host/main-effort.test.ts`): "Held turn with strategy advice", "Held after a compaction with strategy on", "Effort off" advice, "Level on the first request", "Jev fails on a reply". Status line (`tests/host/status/line.test.ts`): gate-only unanswered keeps the suffix.
- [ ] **Step 2:** `bun test tests/jev tests/policy/main tests/host/main tests/host/strategy-advice.test.ts tests/host/effort-hold.test.ts tests/host/main-effort.test.ts tests/host/status` → FAIL.
- [ ] **Step 3: Implement** per design D6: `applyEffort = effortOn && !held && canAskEffort(supported)`; `mainQuestions` asks `effort` when `applyEffort || askStrategy`, `risky` only when `applyEffort`; delete `MAIN_TIER_CRITERIA`/`MAIN_TIER_QUESTION`; `planAdvice` passes the raw `effort.choice` when it is an `EffortLevel`; `planEffort` and the `no answer` flag run only when `applyEffort`, so a gate-only answer adds no `effortP`/`risky`/`requested`; the held path reads effort for advice only. Replay report request uses `{ applyEffort: true, askStrategy: true }`.
- [ ] **Step 4:** `bun run typecheck && bun run lint && bun test` → PASS.
- [ ] **Step 5: Commit** `feat(strategy-advice): gate advice on effort, drop the main tier question`.

---

## Task 5: Commands, slots and status report — implements 5

**Covers:** 5.1, 5.2
**Difficulty:** Normal
**Blocked by:** Task 4

**Files:**
- Modify: `src/host/commands/{status-format,slots,apply}.ts`
- Test: `tests/host/commands/{jev,slots}.test.ts`

**Interfaces:**
- Consumes: `recentMix`, `MODE_TARGETS` (Task 2); config notices (Task 1).

- [ ] **Step 1: Failing tests** (the existing target assertions were updated in Task 2): "Mix with a full window" → `mix (last 200, standard): basic 19% / broad 55% / deep 24% / frontier 2% · target 20/53/26/≤1`; "Budget target shown" → `target 50/40/10/≤0`; "Legacy frontier slot blocks writes", "Legacy frontier slot still shows others", "Frontier is the switch", "Legacy frontier slot reported first".
- [ ] **Step 2:** `bun test tests/host/commands` → FAIL.
- [ ] **Step 3: Implement.** Status format reads the new targets (already renamed) with the new values; slot add/replace/remove check the loaded config for a slot named `frontier` right after the invalid-config refusal and before parsing checks, error `crew.slots has a slot named "frontier", a reserved name; rename it in <path>`.
- [ ] **Step 4:** `bun run typecheck && bun run lint && bun test` → PASS.
- [ ] **Step 5: Commit** `feat(jev-command): frontier mix line and legacy slot guard`.

---

## Task 6: Replay seed candidate — implements 6

**Covers:** 6.1
**Difficulty:** Normal
**Blocked by:** Task 2, Task 4

**Files:**
- Modify: `scripts/replay/{report,report-route,report-compare,compare}.ts`
- Test: `tests/replay/{report,report-route,report-compare,compare,pin-report}.test.ts` (`pin-report` passes the candidate `seed` in its options)

**Interfaces:**
- Consumes: `cutPoints`, `difficultyScore`, `MODE_TARGETS` (Task 2).
- Produces: `ReportAggregates.seedCandidates`; `routeStream` takes `seed: CutPoints` for windows under 100.

- [ ] **Step 1: Failing tests:** "Candidate per mode" (120 scores → candidates equal `cutPoints` per mode), "Budget candidate has no frontier" (`"Infinity"`, `"-Infinity"` strings), "Misses left out" (115 of 120), "Seed then window" (first 100 launches use the candidate), "No main tier key".
- [ ] **Step 2:** `bun test tests/replay` → FAIL.
- [ ] **Step 3: Implement.** Compute the candidates per variant over scored answers before routing; route with `windowEntries` + candidate under 100 entries, `cutPoints` from 100; serialize ±∞ as strings; drop the main tier key from pass 1 compare.
- [ ] **Step 4:** `bun run typecheck && bun run lint && bun test` → PASS.
- [ ] **Step 5: Commit** `feat(state-replay): seed candidate per mode in the report pass`.

---

## Task 7: Seed from replay and evidence — implements 7

**Covers:** 7.1, 7.2, 7.3
**Difficulty:** Very Hard
**Blocked by:** Task 6

**Files:**
- Modify: `src/policy/worker/seed.ts`, `tests/policy/worker/cutpoints.test.ts` (evidence note path and table parsing)
- Create: `docs/evidence/<date>-knowledge-tier-mix.md`
- Delete: `tests/fixtures/seed/provisional-scores.json` and its test

- [ ] **Step 1: Dry run** (no network): `PI_CODING_AGENT_DIR=<operator agent dir> bun scripts/replay/cli.ts --pass report --main 0 --workers <N> --sessions <sessions dir with the 2026-11-07 corpus> --capabilities <snapshot file>`. Confirm planned workers = N, exclusions 0 (or listed), and the cost estimate. `--models` is not wired, so replay requests carry no display-name prefix; state this limitation in the evidence note.
- [ ] **Step 2: Stop and ask.** Give the operator the packet: corpus dir, snapshot, config (all four tiers, `frontier` on, `reviewer` slot), N, `--main 0`, estimate. Run the same command with `--send` only after explicit approval.
- [ ] **Step 3:** Read `aggregates.json`: misses, exclusions, `seedCandidates.report` (and `rerun` for noise), mix per mode and scope, rerun noise. If any mode misses its target by more than 10 points (frontier: above cap + 10) because many launches share one score, stop and ask the operator about the effort tiebreak (design D3); choosing it reopens `mode-cutpoints` "Difficulty score" before any code.
- [ ] **Step 4:** Write `SEED_CUTPOINTS` from `seedCandidates.report` and the evidence note (aggregates only: data, seed table `| mode | basicMax | broadMax | frontierMin |`, mix by mode and scope, rerun noise, reading); point the evidence test at the new note and turn the `test.todo` back into the equality test; remove the provisional fixture and its test.
- [ ] **Step 5:** `bun run typecheck && bun run lint && bun test` → PASS ("Seed matches the evidence note", "Seed is a valid result").
- [ ] **Step 6: Commit** `feat(mode-cutpoints): seed from the knowledge-tier replay`.

---

## Task 8: Docs, ADR and release notes — implements 8

**Covers:** 8.1, 8.2, 8.3, 8.4
**Difficulty:** Normal
**Blocked by:** Task 5, Task 7

**Files:**
- Create: `docs/decisions/0010-knowledge-tiers.md`
- Modify: `docs/decisions/0008-mode-target-cutpoints.md` (superseded note), `docs/decisions/README.md`, `docs/configuration.md`, `docs/usage-guide.md`, `docs/glossary.md`, `docs/domain-model.md`, `docs/architecture.md`, `docs/jev-contract.md`, `docs/testing.md`, `docs/scenarios.md`, `README.md`, `CHANGELOG.md`
- Test: `tests/release.test.ts`

- [ ] **Step 1: Failing test** in `tests/release.test.ts`: "Tier and effort explained" (README says a tier picks how much the model knows and effort picks how hard it works, and names `frontier`).
- [ ] **Step 2:** ADR 0010 (D1–D6; supersedes ADR 0008's rubric, expert-effort and risk-to-tier parts); docs updated (`docs/configuration.md` lists `frontier` reserved and the aliases; `docs/testing.md` replaces the expert cut with effort by the frontier cut; `docs/jev-contract.md` strategy gates read effort); CHANGELOG names every rename and deprecated key.
- [ ] **Step 3:** `bun run typecheck && bun run lint && bun run fmt:check && bun test` → PASS.
- [ ] **Step 4: Commit** `docs: knowledge tiers, ADR 0010, changelog`.

---
## Scenario → test

Tests are named after the scenario heading; headings kept from the baseline with an `Intentional change` comment are tested for the new behaviour.

### config-file

- Config is validated as a whole / Valid full example → `tests/store/config-read.test.ts` › "Valid full example"
- Config is validated as a whole / Several problems reported together → `tests/store/config-read.test.ts` › "Several problems reported together"
- Config is validated as a whole / Invalid result has no values → `tests/store/config-read.test.ts` › "Invalid result has no values"
- Config is validated as a whole / Bad JSON → `tests/store/config-read.test.ts` › "Bad JSON"
- Config is validated as a whole / Section of the wrong type → `tests/store/config-read.test.ts` › "Section of the wrong type"
- Config is validated as a whole / Top level is not an object → `tests/store/config-read.test.ts` › "Top level is not an object"
- Config is validated as a whole / Value is not echoed → `tests/store/config-read.test.ts` › "Value is not echoed"
- Config is validated as a whole / Unreadable file → `tests/store/config-read.test.ts` › "Unreadable file"
- Tier and slot field rules / Tier without provider rejected → `tests/store/config-read.test.ts` › "Tier without provider rejected"
- Tier and slot field rules / Unknown tier rejected → `tests/store/config-read.test.ts` › "Unknown tier rejected"
- Tier and slot field rules / Model too long → `tests/store/config-read.test.ts` › "Model too long"
- Tier and slot field rules / Deprecated tier key accepted → `tests/store/config-read.test.ts` › "Deprecated tier key accepted"
- Tier and slot field rules / Every deprecated tier key → `tests/store/config-read.test.ts` › "Every deprecated tier key"
- Tier and slot field rules / Alias and new key both present → `tests/store/config-read.test.ts` › "Alias and new key both present"
- Tier and slot field rules / Existing frontier slot still read → `tests/store/config-read.test.ts` › "Existing frontier slot still read"
- Tier and slot field rules / New frontier slot refused → `tests/store/config-write.test.ts` › "New frontier slot refused"
- Tier and slot field rules / Invalid alias value → `tests/store/config-read.test.ts` › "Invalid alias value"
- Tier and slot field rules / Slot when bounds → `tests/store/config-read.test.ts` › "Slot when bounds"
- Tier and slot field rules / Too many slots → `tests/store/config-read.test.ts` › "Too many slots"
- Tier and slot field rules / Reserved slot name → `tests/store/config-read.test.ts` › "Reserved slot name"
- Tier and slot field rules / Duplicate slot name → `tests/store/config-read.test.ts` › "Duplicate slot name"
- Tier and slot field rules / Slot without model → `tests/store/config-read.test.ts` › "Slot without model"
- Tier and slot field rules / Slot without when → `tests/store/config-read.test.ts` › "Slot without when"
- Tier and slot field rules / Slot writer refuses a slot without when → `tests/store/config-write.test.ts` › "Slot writer refuses a slot without when"
- Invalid config is never written / Read leaves the file untouched → `tests/store/config-read.test.ts` › "Read leaves the file untouched"
- Invalid config is never written / Slot writer refuses an invalid file → `tests/store/config-read.test.ts` › "Slot writer refuses an invalid file"
- Invalid config is never written / Migration refuses an invalid file → `tests/store/config-write.test.ts` › "Migration refuses an invalid file"
- Legacy tier migration / Config migrated at start → `tests/host/platform/migrate.test.ts` › "Config migrated at start"
- Legacy tier migration / State migrated at start → `tests/host/platform/migrate.test.ts` › "State migrated at start"
- Legacy tier migration / Legacy frontier slot kept → `tests/host/platform/migrate.test.ts` › "Legacy frontier slot kept"
- Legacy tier migration safety / Nothing to migrate → `tests/host/platform/migrate.test.ts` › "Nothing to migrate"
- Legacy tier migration safety / Conflicting keys left alone → `tests/host/platform/migrate.test.ts` › "Conflicting keys left alone"
- Legacy tier migration safety / Write failure → `tests/host/platform/migrate.test.ts` › "Write failure"
- Legacy tier migration safety / Child session → `tests/host/platform/migrate.test.ts` › "Child session"

### decision-ledger

- Ledger value domains / NaN probability rejected → `tests/store/ledger-schema.test.ts` › "NaN probability rejected"
- Ledger value domains / Slot target accepted → `tests/store/ledger-schema.test.ts` › "Slot target accepted"
- Ledger value domains / Target distribution capped at 12 → `tests/store/ledger-schema.test.ts` › "Target distribution capped at 12"
- Ledger value domains / Score out of range rejected → `tests/store/ledger-schema.test.ts` › "Score out of range rejected"
- Ledger value domains / Fractional rubric rejected → `tests/store/ledger-schema.test.ts` › "Fractional rubric rejected"
- Ledger value domains / Malformed target rejected → `tests/store/ledger-schema.test.ts` › "Malformed target rejected"
- Ledger line schema / Valid main line accepted → `tests/store/ledger-schema.test.ts` › "Valid main line accepted"
- Ledger line schema / Valid worker line accepted → `tests/store/ledger-schema.test.ts` › "Valid worker line accepted"
- Ledger line schema / Worker line with cut-point fields accepted → `tests/store/ledger-schema.test.ts` › "Worker line with cut-point fields accepted"
- Ledger line schema / Older worker line still accepted → `tests/store/ledger-schema.test.ts` › "Older worker line still accepted"
- Ledger line schema / Valid correction line accepted → `tests/store/ledger-schema.test.ts` › "Valid correction line accepted"
- Ledger line schema / Unknown kind rejected → `tests/store/ledger-schema.test.ts` › "Unknown kind rejected"
- Ledger line schema / Field from another kind rejected → `tests/store/ledger-schema.test.ts` › "Field from another kind rejected"
- Ledger line schema / Missing required field rejected → `tests/store/ledger-schema.test.ts` › "Missing required field rejected"
- Ledger line schema / Exported field sets match the table → `tests/store/ledger-schema.test.ts` › "Exported field sets match the table"
- Ledger line schema / Unknown agent value is still an identifier → `tests/store/ledger-schema.test.ts` › "Unknown agent value is still an identifier"
- Ledger line schema / Worker line with effective launch fields accepted → `tests/store/ledger-schema.test.ts` › "Worker line with effective launch fields accepted"
- Ledger line schema / Bad effective thinking rejected → `tests/store/ledger-schema.test.ts` › "Bad effective thinking rejected"
- Worker decisions record their tier / Deciding worker without a tier rejected → `tests/store/ledger-schema.test.ts` › "Deciding worker without a tier rejected"
- Worker decisions record their tier / Retired reason without a tier rejected → `tests/store/ledger-schema.test.ts` › "Retired reason without a tier rejected"
- Worker decisions record their tier / Untouched worker without a tier accepted → `tests/store/ledger-schema.test.ts` › "Untouched worker without a tier accepted"
- Worker decisions record their tier / Frontier accepted → `tests/store/ledger-schema.test.ts` › "Frontier accepted"
- Worker decisions record their tier / Expert accepted → `tests/store/ledger-schema.test.ts` › "Expert accepted"
- Worker decisions record their tier / Legacy risky line accepted → `tests/store/ledger-schema.test.ts` › "Legacy risky line accepted"
- Worker decisions record their tier / Expert admitted accepted → `tests/store/ledger-schema.test.ts` › "Expert admitted accepted"
- Worker decisions record their tier / Old reason name rejected → `tests/store/ledger-schema.test.ts` › "Old reason name rejected"

### effort-hold

- Held turn keeps the level / No thinking change while held → `tests/host/effort-hold.test.ts` › "No thinking change while held"
- Held turn keeps the level / Held turn with strategy advice → `tests/host/effort-hold.test.ts` › "Held turn with strategy advice"
- Held turn keeps the level / Held and Jev fails → `tests/host/effort-hold.test.ts` › "Held and Jev fails"
- Held turn keeps the level / Manual change while held → `tests/host/effort-hold.test.ts` › "Manual change while held"
- Held turn keeps the level / Correction while held → `tests/host/effort-hold.test.ts` › "Correction while held"
- One decision after a compaction / Exactly one decision after a compaction → `tests/host/effort-hold.test.ts` › "Exactly one decision after a compaction"
- One decision after a compaction / Held after a compaction with strategy on → `tests/host/effort-hold.test.ts` › "Held after a compaction with strategy on"
- One decision after a compaction / Miss right after a compaction → `tests/host/effort-hold.test.ts` › "Miss right after a compaction"
- One decision after a compaction / Compaction inside a decided turn → `tests/host/effort-hold.test.ts` › "Compaction inside a decided turn"

### jev-command

- Status report / Default status → `tests/host/commands/jev.test.ts` › "Default status"
- Status report / Directory mode in the report → `tests/host/commands/jev.test.ts` › "Directory mode in the report"
- Status report / Malformed directory mode reported → `tests/host/commands/jev.test.ts` › "Malformed directory mode reported"
- Status report / CLI review default shown → `tests/host/commands/jev.test.ts` › "CLI review default shown"
- Status report / No executor → `tests/host/commands/jev.test.ts` › "No executor"
- Status report / Key name, never value → `tests/host/commands/jev.test.ts` › "Key name, never value"
- Status report / Malformed state reported → `tests/host/commands/jev.test.ts` › "Malformed state reported"
- Status report / Invalid config reported → `tests/host/commands/jev.test.ts` › "Invalid config reported"
- Status report / Deprecated tools section reported → `tests/host/commands/jev.test.ts` › "Deprecated tools section reported"
- Status report / Deprecation never notified on its own → `tests/host/commands/jev.test.ts` › "Deprecation never notified on its own"
- Status report / Malformed tuning reported → `tests/host/commands/jev.test.ts` › "Malformed tuning reported"
- Status report / Empty tally → `tests/host/commands/jev.test.ts` › "Empty tally"
- Status report / Tally after work → `tests/host/commands/jev.test.ts` › "Tally after work"
- Status report / Mix with a full window → `tests/host/commands/jev.test.ts` › "Mix with a full window"
- Status report / Budget target shown → `tests/host/commands/jev.test.ts` › "Budget target shown"
- Status report / Mix while the seed applies → `tests/host/commands/jev.test.ts` › "Mix while the seed applies"
- Status report / Empty window → `tests/host/commands/jev.test.ts` › "Empty window"
- Status report / No mix without the executor → `tests/host/commands/jev.test.ts` › "No mix without the executor"
- Status report / Duplicate executor reported → `tests/host/commands/jev.test.ts` › "Duplicate executor reported"
- All features / All off → `tests/host/commands/apply.test.ts` › "All off"
- All features / All on → `tests/host/commands/apply.test.ts` › "All on"
- All features / All leaves the CLI review alone → `tests/host/commands/apply.test.ts` › "All leaves the CLI review alone"
- Feature switch commands / Turn a feature off → `tests/host/commands/apply.test.ts` › "Turn a feature off"
- Feature switch commands / Switch survives a restart → `tests/host/commands/apply.test.ts` › "Switch survives a restart"
- Feature switch commands / Turn a feature back on → `tests/host/commands/apply.test.ts` › "Turn a feature back on"
- Feature switch commands / Status lists seven features → `tests/host/commands/apply.test.ts` › "Status lists seven features"
- Feature switch commands / Deprecated expert command → `tests/host/commands/apply.test.ts` › "Deprecated expert command"
- Feature switch commands / Tools is not a feature → `tests/host/commands/apply.test.ts` › "Tools is not a feature"

### main-effort

- Main questions / Reasoning model → `tests/host/main/gate.test.ts` › "Reasoning model"
- Main questions / Non-reasoning model → `tests/host/main/gate.test.ts` › "Non-reasoning model"
- Main questions / Both features on → `tests/host/main/gate.test.ts` › "Both features on"
- Main questions / Strategy only → `tests/host/main/gate.test.ts` › "Strategy only"
- Main questions / Non-reasoning model with strategy on → `tests/host/main/gate.test.ts` › "Non-reasoning model with strategy on"
- Main questions / Effort and skills → `tests/host/main/gate.test.ts` › "Effort and skills"
- Main questions / Skills only → `tests/host/main/gate.test.ts` › "Skills only"
- Main questions / Held prompt → `tests/host/main/gate.test.ts` › "Held prompt"
- Main questions / Held prompt with strategy on → `tests/host/main/gate.test.ts` › "Held prompt with strategy on"
- Main questions / Held prompt with skills → `tests/host/main/gate.test.ts` › "Held prompt with skills"
- Main questions / Gate-only effort applies nothing → `tests/host/main-effort.test.ts` › "Gate-only effort applies nothing"
- Level applied before the first request / Level on the first request → `tests/host/main-effort.test.ts` › "Level on the first request"
- Level applied before the first request / Same level → `tests/host/main-effort.test.ts` › "Same level"
- Level applied before the first request / Model unchanged → `tests/host/main-effort.test.ts` › "Model unchanged"
- Level applied before the first request / Held gate-only effort shows the level in force → `tests/host/effort-hold.test.ts` › "Held gate-only effort shows the level in force"
- Level applied before the first request / Gate-only effort on a non-reasoning model → `tests/host/status/line.test.ts` › "Gate-only effort on a non-reasoning model"
- Reply rated by the work it approves / Role rule in the main instruction → `tests/jev/questions.test.ts` › "Role rule in the main instruction"
- Reply rule leaves the rest unchanged / Criteria unchanged → `tests/jev/questions.test.ts` › "Criteria unchanged"
- Reply rule leaves the rest unchanged / Worker instruction unchanged → `tests/jev/questions.test.ts` › "Worker instruction unchanged"
- Reply rule leaves the rest unchanged / Jev fails on a reply → `tests/host/main-effort.test.ts` › "Jev fails on a reply"

### main-ledger

- Main line fields / Required fields → `tests/policy/main/ledger-line.test.ts` › "Required fields"
- Main line fields / Effective is read back from Pi → `tests/policy/main/ledger-line.test.ts` › "Effective is read back from Pi"
- Main line fields / Advice attached → `tests/policy/main/ledger-line.test.ts` › "Advice attached"
- Main line fields / Advice not attached → `tests/policy/main/ledger-line.test.ts` › "Advice not attached"
- Main line fields / Strategy not asked or unanswered → `tests/policy/main/ledger-line.test.ts` › "Strategy not asked or unanswered"
- Main line fields / Skill picked → `tests/policy/main/ledger-line.test.ts` › "Skill picked"
- Main line fields / Skill picked again as a reference → `tests/policy/main/ledger-line.test.ts` › "Skill picked again as a reference"
- Main line fields / Below the threshold → `tests/policy/main/ledger-line.test.ts` › "Below the threshold"
- Main line fields / None leads → `tests/policy/main/ledger-line.test.ts` › "None leads"
- Main line fields / Skills not asked → `tests/policy/main/ledger-line.test.ts` › "Skills not asked"
- Main line fields / Held turn → `tests/policy/main/ledger-line.test.ts` › "Held turn"
- Main line fields / Held turn with advice → `tests/policy/main/ledger-line.test.ts` › "Held turn with advice"
- Main line fields / Held turn with a miss → `tests/policy/main/ledger-line.test.ts` › "Held turn with a miss"
- Main line fields / Gate-only effort not recorded → `tests/policy/main/ledger-line.test.ts` › "Gate-only effort not recorded"
- Main line fields / Decided turn is not held → `tests/policy/main/ledger-line.test.ts` › "Decided turn is not held"

### mode-cutpoints

- Difficulty score / Balanced with high effort → `tests/policy/worker/score.test.ts` › "Balanced with high effort"
- Difficulty score / Mixed probabilities → `tests/policy/worker/score.test.ts` › "Mixed probabilities"
- Difficulty score / Slot keys ignored → `tests/policy/worker/score.test.ts` › "Slot keys ignored"
- Difficulty score / Effort unanswered → `tests/policy/worker/score.test.ts` › "Effort unanswered"
- Difficulty score / Rounded before use → `tests/policy/worker/score.test.ts` › "Rounded before use"
- Difficulty score / Only slot probability → `tests/policy/worker/score.test.ts` › "Only slot probability"
- Difficulty score / Jev failure gives no score → `tests/policy/worker/score.test.ts` › "Jev failure gives no score"
- Cut points from a window / Standard target on ten scores → `tests/policy/worker/cutpoints.test.ts` › "Standard target on ten scores"
- Cut points from a window / Budget target on ten scores → `tests/policy/worker/cutpoints.test.ts` › "Budget target on ten scores"
- Cut points from a window / Premium has no fast cut → `tests/policy/worker/cutpoints.test.ts` › "Premium has no fast cut"
- Cut points from a window / Expert cap → `tests/policy/worker/cutpoints.test.ts` › "Expert cap"
- Cut points from a window / Frontier cap in standard → `tests/policy/worker/cutpoints.test.ts` › "Frontier cap in standard"
- Cut points from a window / Expert never below the balanced cut → `tests/policy/worker/cutpoints.test.ts` › "Expert never below the balanced cut"
- Cut points from a window / Ties stay under the cap → `tests/policy/worker/cutpoints.test.ts` › "Ties stay under the cap"
- Cut points from a window / Empty window → `tests/policy/worker/cutpoints.test.ts` › "Empty window"
- Cut points from a window / Order independent → `tests/policy/worker/cutpoints.test.ts` › "Order independent"
- Window entries / Slot launch left out → `tests/policy/worker/cut-window.test.ts` › "Slot launch left out"
- Window entries / Old rubric left out → `tests/policy/worker/cut-window.test.ts` › "Old rubric left out"
- Window entries / Setup without expert left out → `tests/policy/worker/cut-window.test.ts` › "Setup without expert left out"
- Window entries / Miss and untouched left out → `tests/policy/worker/cut-window.test.ts` › "Miss and untouched left out"
- Window entries / Latest 200 → `tests/policy/worker/cut-window.test.ts` › "Latest 200"
- Window entries / Decided tier before fallback → `tests/policy/worker/cut-window.test.ts` › "Decided tier before fallback"
- Window entries / Equal times at the boundary → `tests/policy/worker/cut-window.test.ts` › "Equal times at the boundary"
- Window entries / Effort tie → `tests/policy/worker/cut-window.test.ts` › "Effort tie"
- Window entries / Effort from the distribution → `tests/policy/worker/cut-window.test.ts` › "Effort from the distribution"
- Seed cut points / Short window uses the seed → `tests/policy/worker/cutpoints.test.ts` › "Short window uses the seed"
- Seed cut points / Full window computed → `tests/policy/worker/cutpoints.test.ts` › "Full window computed"
- Seed cut points / Seed matches the evidence note → `tests/policy/worker/cutpoints.test.ts` › "Seed matches the evidence note"
- Seed cut points / Seed is a valid result → `tests/policy/worker/cutpoints.test.ts` › "Seed is a valid result"
- Recent mix / Mix of four entries → `tests/policy/worker/cut-window.test.ts` › "Mix of four entries"
- Recent mix / Empty window → `tests/policy/worker/cut-window.test.ts` › "Empty window"

### release-metadata

- README explains each feature's effect / Tier and effort explained → `tests/release.test.ts` › "Tier and effort explained"
- README explains each feature's effect / Every feature has an off switch → `tests/release.test.ts` › "Every feature has an off switch"

### slot-commands

- Slot command forms / Reserved name → `tests/host/commands/slots.test.ts` › "Reserved name"
- Slot command forms / Remove with extra words → `tests/host/commands/slots.test.ts` › "Remove with extra words"
- Slot command forms / Legacy frontier slot blocks writes → `tests/host/commands/slots.test.ts` › "Legacy frontier slot blocks writes"
- Slot command forms / Legacy frontier slot still shows others → `tests/host/commands/slots.test.ts` › "Legacy frontier slot still shows others"
- Slot command forms / Frontier is the switch → `tests/host/commands/slots.test.ts` › "Frontier is the switch"
- Slot command forms / Name-shaped typo of a feature → `tests/host/commands/slots.test.ts` › "Name-shaped typo of a feature"
- Order of slot checks / Legacy frontier slot reported first → `tests/host/commands/slots.test.ts` › "Legacy frontier slot reported first"
- Order of slot checks / Missing when reported before an unknown model → `tests/host/commands/slots.test.ts` › "Missing when reported before an unknown model"
- Order of slot checks / Bad model shape reported before missing when → `tests/host/commands/slots.test.ts` › "Bad model shape reported before missing when"

### state-file

- State file content / Valid state read → `tests/store/state-file.test.ts` › "Valid state read"
- State file content / OpenCode model id accepted → `tests/store/state-file.test.ts` › "OpenCode model id accepted"
- State file content / Model that looks like a flag → `tests/store/state-file.test.ts` › "Model that looks like a flag"
- State file content / Every documented feature accepted → `tests/store/state-file.test.ts` › "Every documented feature accepted"
- State file content / Legacy review switch accepted and dropped → `tests/store/state-file.test.ts` › "Legacy review switch accepted and dropped"
- State file content / Legacy review switch alone → `tests/store/state-file.test.ts` › "Legacy review switch alone"
- State file content / Legacy review switch gone after a write → `tests/store/state-file.test.ts` › "Legacy review switch gone after a write"
- State file content / Non-boolean legacy review switch → `tests/store/state-file.test.ts` › "Non-boolean legacy review switch"
- State file content / Legacy tools switch accepted and dropped → `tests/store/state-file.test.ts` › "Legacy tools switch accepted and dropped"
- State file content / Legacy tools switch gone after a write → `tests/store/state-file.test.ts` › "Legacy tools switch gone after a write"
- State file content / Non-boolean legacy tools switch → `tests/store/state-file.test.ts` › "Non-boolean legacy tools switch"
- State file content / Literal default rejected → `tests/store/state-file.test.ts` › "Literal default rejected"
- State file content / CLI review switch read → `tests/store/state-file.test.ts` › "CLI review switch read"
- State file content / Non-boolean CLI review switch → `tests/store/state-file.test.ts` › "Non-boolean CLI review switch"
- State file content / Legacy expert switch moved → `tests/store/state-file.test.ts` › "Legacy expert switch moved"
- State file content / Frontier wins over the legacy switch → `tests/store/state-file.test.ts` › "Frontier wins over the legacy switch"
- State file content / Legacy expert switch gone after a write → `tests/store/state-file.test.ts` › "Legacy expert switch gone after a write"
- State file content / Non-boolean legacy expert switch → `tests/store/state-file.test.ts` › "Non-boolean legacy expert switch"
- State file content / Unknown feature → `tests/store/state-file.test.ts` › "Unknown feature"

### state-replay

- Comparison against noise / No main tier key → `tests/replay/compare.test.ts` › "No main tier key"
- Comparison against noise / Within noise → `tests/replay/compare.test.ts` › "Within noise"
- Comparison against noise / Beyond noise → `tests/replay/compare.test.ts` › "Beyond noise"
- Report pass cut-point window / Seed then window → `tests/replay/report-route.test.ts` › "Seed then window"
- Report pass cut-point window / Slot launch skips the window → `tests/replay/report-route.test.ts` › "Slot launch skips the window"
- Report pass seed candidate / Candidate per mode → `tests/replay/report-compare.test.ts` › "Candidate per mode"
- Report pass seed candidate / Budget candidate has no frontier → `tests/replay/report-compare.test.ts` › "Budget candidate has no frontier"
- Report pass seed candidate / Misses left out → `tests/replay/report-compare.test.ts` › "Misses left out"

### status-line

- Status line text / Ready with the default mode → `tests/host/status/line.test.ts` › "Ready with the default mode"
- Status line text / Mode from state → `tests/host/status/line.test.ts` › "Mode from state"
- Status line text / Directory mode marked → `tests/host/status/line.test.ts` › "Directory mode marked"
- Status line text / Directory mode with a suffix → `tests/host/status/line.test.ts` › "Directory mode with a suffix"
- Status line text / Directory mode in the tally form → `tests/host/status/line.test.ts` › "Directory mode in the tally form"
- Status line text / Base state wins over a directory mode → `tests/host/status/line.test.ts` › "Base state wins over a directory mode"
- Status line text / No key → `tests/host/status/line.test.ts` › "No key"
- Status line text / Config error wins over no key → `tests/host/status/line.test.ts` › "Config error wins over no key"
- Status line text / Everything off → `tests/host/status/line.test.ts` › "Everything off"
- Status line text / One feature off is not off → `tests/host/status/line.test.ts` › "One feature off is not off"
- Status line text / No executor is not shown → `tests/host/status/line.test.ts` › "No executor is not shown"
- Status line text / Malformed state uses defaults → `tests/host/status/line.test.ts` › "Malformed state uses defaults"
- Status line text / After a decision → `tests/host/status/line.test.ts` › "After a decision"
- Status line text / After a decision with advice → `tests/host/status/line.test.ts` › "After a decision with advice"
- Status line text / Advice with effort off → `tests/host/status/line.test.ts` › "Advice with effort off"
- Status line text / Advice cleared by the next turn → `tests/host/status/line.test.ts` › "Advice cleared by the next turn"
- Status line text / Strategy switched off → `tests/host/status/line.test.ts` › "Strategy switched off"
- Status line text / Discarded effort with advice → `tests/host/status/line.test.ts` › "Discarded effort with advice"
- Status line text / Strategy switched back on → `tests/host/status/line.test.ts` › "Strategy switched back on"
- Status line text / After a miss → `tests/host/status/line.test.ts` › "After a miss"
- Status line text / Discarded keeps the previous suffix → `tests/host/status/line.test.ts` › "Discarded keeps the previous suffix"
- Status line text / Miss on a non-reasoning model → `tests/host/status/line.test.ts` › "Miss on a non-reasoning model"
- Status line text / Answered without effort keeps the suffix → `tests/host/status/line.test.ts` › "Answered without effort keeps the suffix"
- Status line text / Held turn shows the level in force → `tests/host/status/line.test.ts` › "Held turn shows the level in force"
- Status line text / Held turn with advice → `tests/host/status/line.test.ts` › "Held turn with advice"
- Status line text / Held miss shows the level → `tests/host/status/line.test.ts` › "Held miss shows the level"
- Status line text / Kept across /jev → `tests/host/status/line.test.ts` › "Kept across /jev"
- Status line text / Effort switched off → `tests/host/status/line.test.ts` › "Effort switched off"
- Status line text / Session start clears the suffix → `tests/host/status/line.test.ts` › "Session start clears the suffix"
- Status line text / Base state wins → `tests/host/status/line.test.ts` › "Base state wins"
- Status line text / Tally on the 10th prompt → `tests/host/status/line.test.ts` › "Tally on the 10th prompt"
- Status line text / Ninth prompt shows the level → `tests/host/status/line.test.ts` › "Ninth prompt shows the level"
- Status line text / Eleventh prompt shows the level again → `tests/host/status/line.test.ts` › "Eleventh prompt shows the level again"
- Status line text / Tally kept across /jev → `tests/host/status/line.test.ts` › "Tally kept across /jev"
- Status line text / Tally on a miss → `tests/host/status/line.test.ts` › "Tally on a miss"
- Status line text / Tally on a discarded 10th prompt → `tests/host/status/line.test.ts` › "Tally on a discarded 10th prompt"
- Status line text / Nothing decided never shows the tally → `tests/host/status/line.test.ts` › "Nothing decided never shows the tally"
- Status line text / Strategy-only session shows the tally → `tests/host/status/line.test.ts` › "Strategy-only session shows the tally"
- Status line text / Tally replaces both suffixes → `tests/host/status/line.test.ts` › "Tally replaces both suffixes"
- Status line text / Cancelled 11th prompt keeps the tally → `tests/host/status/line.test.ts` › "Cancelled 11th prompt keeps the tally"
- Status line text / Cancelled keeps both suffixes → `tests/host/status/line.test.ts` › "Cancelled keeps both suffixes"
- Status line placement and refresh / Drawn at session start in RPC mode → `tests/host/status/line.test.ts` › "Drawn at session start in RPC mode"
- Status line placement and refresh / Right-aligned in the terminal UI → `tests/host/status/line.test.ts` › "Right-aligned in the terminal UI"
- Status line placement and refresh / Narrow terminal → `tests/host/status/line.test.ts` › "Narrow terminal"
- Status line placement and refresh / Refreshed after a switch change → `tests/host/status/line.test.ts` › "Refreshed after a switch change"
- Status line placement and refresh / Refreshed after a decision → `tests/host/status/line.test.ts` › "Refreshed after a decision"

### strategy-advice

- Strategy questions / Strategy on → `tests/jev/questions.test.ts` › "Strategy on"
- Strategy questions / Tier criteria without a prefix → `tests/jev/questions.test.ts` › "Tier criteria without a prefix"
- Strategy questions / Strategy off → `tests/jev/questions.test.ts` › "Strategy off"
- Strategy questions / Docs state no prefix for the main tier → `tests/jev/questions.test.ts` › "Docs state no prefix for the main tier"
- Strategy questions / Wording matches the docs → `tests/jev/questions.test.ts` › "Wording matches the docs"
- Strategy gates / Direct attaches nothing → `tests/policy/main/strategy.test.ts` › "Direct attaches nothing"
- Strategy gates / Delegate at the boundary → `tests/policy/main/strategy.test.ts` › "Delegate at the boundary"
- Strategy gates / Delegate below the boundary → `tests/policy/main/strategy.test.ts` › "Delegate below the boundary"
- Strategy gates / Delegate on low effort → `tests/policy/main/strategy.test.ts` › "Delegate on low effort"
- Strategy gates / Parallel at the boundary → `tests/policy/main/strategy.test.ts` › "Parallel at the boundary"
- Strategy gates / Parallel below the boundary → `tests/policy/main/strategy.test.ts` › "Parallel below the boundary"
- Strategy gates / Parallel on the fast tier → `tests/policy/main/strategy.test.ts` › "Parallel on the fast tier"
- Strategy gates / Graph at the boundary → `tests/policy/main/strategy.test.ts` › "Graph at the boundary"
- Strategy gates / Graph below the boundary → `tests/policy/main/strategy.test.ts` › "Graph below the boundary"
- Strategy gates / Graph off the deep tier → `tests/policy/main/strategy.test.ts` › "Graph off the deep tier"
- Strategy gates / Gate reads the raw choice → `tests/policy/main/strategy.test.ts` › "Gate reads the raw choice"
- Strategy gates / Tier unanswered → `tests/policy/main/strategy.test.ts` › "Tier unanswered"
- Strategy gates / Tier unanswered does not block delegate → `tests/policy/main/strategy.test.ts` › "Tier unanswered does not block delegate"
- Strategy gates / Strategy unanswered → `tests/policy/main/strategy.test.ts` › "Strategy unanswered"
- Strategy gates / Confidence ignored → `tests/policy/main/strategy.test.ts` › "Confidence ignored"
- Advice independent of effort / Kept on a manual change → `tests/host/strategy-advice.test.ts` › "Kept on a manual change"
- Advice independent of effort / Effort off → `tests/host/strategy-advice.test.ts` › "Effort off"
- Advice independent of effort / Effort unanswered → `tests/host/strategy-advice.test.ts` › "Effort unanswered"

### tuning-signals

- Signals per mode / Window per mode → `tests/policy/tuning/signals.test.ts` › "Window per mode"
- Signals per mode / Modes never mixed → `tests/policy/tuning/signals.test.ts` › "Modes never mixed"
- Signals per mode / Empty mode left out → `tests/policy/tuning/signals.test.ts` › "Empty mode left out"
- Signals per mode / Input order irrelevant → `tests/policy/tuning/signals.test.ts` › "Input order irrelevant"
- Low worker errors / Legacy fast counts as low → `tests/policy/tuning/signals.test.ts` › "Legacy fast counts as low"
- Low worker errors / Counted and denominator → `tests/policy/tuning/signals.test.ts` › "Counted and denominator"

### verbose-log

- Worker log line segments / Worker fallback text → `tests/host/status/worker-line.test.ts` › "Worker fallback text"
- Worker log line segments / Worker miss text → `tests/host/status/worker-line.test.ts` › "Worker miss text"
- Worker log line segments / Worker untouched text → `tests/host/status/worker-line.test.ts` › "Worker untouched text"
- Worker log line segments / Cut reason hidden → `tests/host/status/worker-line.test.ts` › "Cut reason hidden"
- Worker log line segments / Expert reason shown → `tests/host/status/worker-line.test.ts` › "Expert reason shown"

### worker-decision

- Decision order / Ordinary choice → `tests/policy/worker/tier.test.ts` › "Ordinary choice"
- Decision order / Same answers, different modes → `tests/policy/worker/tier.test.ts` › "Same answers, different modes"
- Decision order / Table per mode → `tests/policy/worker/tier.test.ts` › "Table per mode"
- Decision order / Effort does not move the tier → `tests/policy/worker/tier.test.ts` › "Effort does not move the tier"
- Decision order / Slot in every mode → `tests/policy/worker/tier.test.ts` › "Slot in every mode"
- Partial answers in the decision / Risk floor without a tier answer → `tests/policy/worker/tier.test.ts` › "Risk floor without a tier answer"
- Partial answers in the decision / Effort unanswered in premium → `tests/policy/worker/tier.test.ts` › "Effort unanswered in premium"
- Partial answers in the decision / Expert needed unanswered → `tests/policy/worker/tier.test.ts` › "Expert needed unanswered"
- Partial answers in the decision / Slot without a score → `tests/policy/worker/tier.test.ts` › "Slot without a score"
- Partial answers in the decision / No tier answer → `tests/policy/worker/tier.test.ts` › "No tier answer"
- Partial answers in the decision / No tier offered → `tests/policy/worker/tier.test.ts` › "No tier offered"
- Partial answers in the decision / Every answer unanswered → `tests/policy/worker/tier.test.ts` › "Every answer unanswered"
- Worker effort / Ceiling → `tests/policy/effort.test.ts` › "Ceiling"
- Worker effort / Risk raises effort → `tests/policy/effort.test.ts` › "Risk raises effort"
- Worker effort / Risk boundary for effort → `tests/policy/effort.test.ts` › "Risk boundary for effort"
- Worker effort / Fast cap → `tests/policy/effort.test.ts` › "Fast cap"
- Worker effort / Risk floor then fast cap → `tests/policy/effort.test.ts` › "Risk floor then fast cap"
- Worker effort / No tier decided → `tests/policy/effort.test.ts` › "No tier decided"
- Worker effort / Slot without the fast cap → `tests/policy/effort.test.ts` › "Slot without the fast cap"
- Effort after fallback / Fallback lifts effort on fast → `tests/policy/effort.test.ts` › "Fallback lifts effort on fast"
- Effort after fallback / Fallback without an effort answer → `tests/policy/effort.test.ts` › "Fallback without an effort answer"
- Effort after fallback / No effort answer → `tests/policy/effort.test.ts` › "No effort answer"
- Effort after fallback / Slot fell back to fast → `tests/policy/effort.test.ts` › "Slot fell back to fast"
- Fallback choice / Target usable → `tests/policy/worker/tier.test.ts` › "Target usable"
- Fallback choice / Usable expert kept → `tests/policy/worker/tier.test.ts` › "Usable expert kept"
- Fallback choice / Move down → `tests/policy/worker/tier.test.ts` › "Move down"
- Fallback choice / Skip an unusable lower tier → `tests/policy/worker/tier.test.ts` › "Skip an unusable lower tier"
- Fallback choice / Unoffered tier skipped → `tests/policy/worker/tier.test.ts` › "Unoffered tier skipped"
- Fallback choice / Expert never a target → `tests/policy/worker/tier.test.ts` › "Expert never a target"
- Fallback choice / Fast cannot run → `tests/policy/worker/tier.test.ts` › "Fast cannot run"
- Fallback choice / Nothing can run → `tests/policy/worker/tier.test.ts` › "Nothing can run"
- Fallback choice / Usable slot kept → `tests/policy/worker/tier.test.ts` › "Usable slot kept"
- Fallback choice / Slot falls back to balanced → `tests/policy/worker/tier.test.ts` › "Slot falls back to balanced"
- Fallback choice / Slot falls back to fast → `tests/policy/worker/tier.test.ts` › "Slot falls back to fast"
- Fallback choice / Slot never moves up → `tests/policy/worker/tier.test.ts` › "Slot never moves up"
- Route writes thinking only / Forked launch with thinking → `tests/policy/worker/route.test.ts` › "Forked launch with thinking"
- Route writes thinking only / No tier offered → `tests/policy/worker/route.test.ts` › "No tier offered"
- Route writes thinking only / No tier decided → `tests/policy/worker/route.test.ts` › "No tier decided"
- Route writes thinking only / Slot below the bar with no tier → `tests/policy/worker/route.test.ts` › "Slot below the bar with no tier"
- Route writes thinking only / No effort answer → `tests/policy/worker/route.test.ts` › "No effort answer"
- Route writes thinking only / No tier decided with thinking locked → `tests/policy/worker/route.test.ts` › "No tier decided with thinking locked"
- Route writes thinking only / Jev fails for a fork with thinking → `tests/policy/worker/route.test.ts` › "Jev fails for a fork with thinking"
- Routed launch / Chosen tier written → `tests/policy/worker/route.test.ts` › "Chosen tier written"
- Routed launch / Clamped to the model → `tests/policy/worker/route.test.ts` › "Clamped to the model"
- Routed launch / Cascade with xhigh → `tests/policy/worker/route.test.ts` › "Cascade with xhigh"
- Routed launch / Slot written → `tests/policy/worker/route.test.ts` › "Slot written"
- Routed launch / Slot falls back with xhigh → `tests/policy/worker/route.test.ts` › "Slot falls back with xhigh"
- Nothing can run / All lower tiers unusable → `tests/policy/worker/route.test.ts` › "All lower tiers unusable"
- Nothing can run / Expert never a cascade target → `tests/policy/worker/route.test.ts` › "Expert never a cascade target"
- Nothing can run / Unusable slot alone → `tests/policy/worker/route.test.ts` › "Unusable slot alone"
- Locks in the route / Model locked → `tests/policy/worker/route.test.ts` › "Model locked"
- Locks in the route / Model locked without a decided tier → `tests/policy/worker/route.test.ts` › "Model locked without a decided tier"
- Locks in the route / Thinking locked → `tests/policy/worker/route.test.ts` › "Thinking locked"
- Locks in the route / Model locked with a slot decided → `tests/policy/worker/route.test.ts` › "Model locked with a slot decided"
- Locks in the route / Service launch with a model → `tests/policy/worker/route.test.ts` › "Service launch with a model"
- Slot rule / Slot at the bar → `tests/policy/worker/tier.test.ts` › "Slot at the bar"
- Slot rule / Risk wins over a slot → `tests/policy/worker/tier.test.ts` › "Risk wins over a slot"
- Slot rule / Two slots → `tests/policy/worker/tier.test.ts` › "Two slots"
- Cut rule / Fast at the cut → `tests/policy/worker/tier.test.ts` › "Fast at the cut"
- Cut rule / Balanced → `tests/policy/worker/tier.test.ts` › "Balanced"
- Cut rule / Deep → `tests/policy/worker/tier.test.ts` › "Deep"
- Cut rule / Premium never cuts to fast → `tests/policy/worker/tier.test.ts` › "Premium never cuts to fast"
- Cut rule / Unoffered tier moves down → `tests/policy/worker/tier.test.ts` › "Unoffered tier moves down"
- Cut rule / Unoffered tier moves up → `tests/policy/worker/tier.test.ts` › "Unoffered tier moves up"
- Fallthrough without a qualifying tier / Risk floor with only a slot → `tests/policy/worker/tier.test.ts` › "Risk floor with only a slot"
- Fallthrough without a qualifying tier / Risk floor with only fast → `tests/policy/worker/tier.test.ts` › "Risk floor with only fast"
- Fallthrough without a qualifying tier / Only fast offered → `tests/policy/worker/tier.test.ts` › "Only fast offered"
- Fallthrough without a qualifying tier / Only expert offered → `tests/policy/worker/tier.test.ts` › "Only expert offered"
- Slot below the bar uses the score / Slot below the bar → `tests/policy/worker/tier.test.ts` › "Slot below the bar"
- Slot below the bar uses the score / Slot not offered → `tests/policy/worker/tier.test.ts` › "Slot not offered"
- Slot below the bar uses the score / Slot below the bar reaches expert → `tests/policy/worker/tier.test.ts` › "Slot below the bar reaches expert"
- Slot below the bar uses the score / Only a slot offered below the bar → `tests/policy/worker/tier.test.ts` › "Only a slot offered below the bar"
- Frontier rule / Expert by score and effort → `tests/policy/worker/tier.test.ts` › "Expert by score and effort"
- Frontier rule / Expert at the cut → `tests/policy/worker/tier.test.ts` › "Expert at the cut"
- Frontier rule / High effort is not enough → `tests/policy/worker/tier.test.ts` › "High effort is not enough"
- Frontier rule / Below the frontier cut → `tests/policy/worker/tier.test.ts` › "Below the frontier cut"
- Frontier rule / Expert not offered → `tests/policy/worker/tier.test.ts` › "Expert not offered"
- Frontier rule / Budget never reaches expert → `tests/policy/worker/tier.test.ts` › "Budget never reaches expert"
- Frontier rule / Expert stands on high risk → `tests/policy/worker/tier.test.ts` › "Expert stands on high risk"

### worker-ledger

- Worker decision fields / Routed fields → `tests/policy/worker/ledger-line.test.ts` › "Routed fields"
- Worker decision fields / Expert offered recorded → `tests/policy/worker/ledger-line.test.ts` › "Expert offered recorded"
- Worker decision fields / Expert switched off recorded → `tests/policy/worker/ledger-line.test.ts` › "Expert switched off recorded"
- Worker decision fields / Fallback recorded → `tests/policy/worker/ledger-line.test.ts` › "Fallback recorded"
- Worker decision fields / Nothing could run recorded → `tests/policy/worker/ledger-line.test.ts` › "Nothing could run recorded"
- Worker decision fields / Thinking-only recorded → `tests/policy/worker/ledger-line.test.ts` › "Thinking-only recorded"
- Worker decision fields / Untouched recorded → `tests/policy/worker/ledger-line.test.ts` › "Untouched recorded"
- Worker decision fields / Tier asked, nothing decided → `tests/policy/worker/ledger-line.test.ts` › "Tier asked, nothing decided"
- Worker decision fields / Locked recorded → `tests/policy/worker/ledger-line.test.ts` › "Locked recorded"
- Worker decision fields / Not locked → `tests/policy/worker/ledger-line.test.ts` › "Not locked"
- Worker decision fields / Slot decision recorded → `tests/policy/worker/ledger-line.test.ts` › "Slot decision recorded"
- Worker decision fields / Slot fallback recorded → `tests/policy/worker/ledger-line.test.ts` › "Slot fallback recorded"
- Worker request fields / Mode recorded → `tests/host/worker-ledger.test.ts` › "Mode recorded"
- Worker request fields / Miss recorded → `tests/host/worker-ledger.test.ts` › "Miss recorded"

### worker-modes

- Mode targets / Shares sum to 100 → `tests/policy/worker/modes.test.ts` › "Shares sum to 100"
- Mode targets / Budget never routes expert → `tests/policy/worker/modes.test.ts` › "Budget never routes expert"
- Mode targets / Frontier caps → `tests/policy/worker/modes.test.ts` › "Frontier caps"
- Mode selects a target table / Worker request ignores the mode → `tests/policy/worker/modes.test.ts` › "Worker request ignores the mode"
- Mode selects a target table / Same score, different tiers → `tests/policy/worker/modes.test.ts` › "Same score, different tiers"
- Mode selects a target table / Main request ignores the mode → `tests/policy/worker/modes.test.ts` › "Main request ignores the mode"

### worker-request

- Offered tiers / Partial configuration → `tests/jev/questions.test.ts` › "Partial configuration"
- Offered tiers / Expert switched off → `tests/jev/questions.test.ts` › "Expert switched off"
- Offered tiers / Slots after tiers → `tests/jev/questions.test.ts` › "Slots after tiers"
- Offered tiers / No slot, request unchanged → `tests/jev/questions.test.ts` › "No slot, request unchanged"
- Question wording / Wording matches the docs → `tests/jev/questions.test.ts` › "Wording matches the docs"
- Question wording / Premium wording → `tests/jev/questions.test.ts` › "Premium wording"
- Question wording / Standard request unchanged → `tests/jev/questions.test.ts` › "Standard request unchanged"
- Question wording / Budget expert criterion → `tests/jev/questions.test.ts` › "Budget expert criterion"
- Question wording / Effort instruction asks about work → `tests/jev/questions.test.ts` › "Effort instruction asks about work"
- Question wording / Main criteria held apart → `tests/jev/questions.test.ts` › "Main criteria held apart"
- Question wording / Display name prefix → `tests/jev/questions.test.ts` › "Display name prefix"
- Question wording / Missing display name → `tests/jev/questions.test.ts` › "Missing display name"
- Rubric version / Version of this rubric → `tests/jev/questions.test.ts` › "Version of this rubric"
- Rubric version / Wording pinned to the version → `tests/jev/questions.test.ts` › "Wording pinned to the version"
- Worker question set / No tier configured → `tests/jev/questions.test.ts` › "No tier configured"
- Worker question set / Slot alone → `tests/jev/questions.test.ts` › "Slot alone"
- Worker question set / Expert offered → `tests/jev/questions.test.ts` › "Expert offered"
- Worker question set / Asked and accepted agree → `tests/jev/questions.test.ts` › "Asked and accepted agree"
- No slot in the main request / Main request with a slot configured → `tests/jev/questions.test.ts` › "Main request with a slot configured"
- No slot in the main request / Main request has no tier → `tests/jev/questions.test.ts` › "Main request has no tier"

### worker-routing

- Worker request content / Display name prefix → `tests/host/worker-routing.test.ts` › "Display name prefix"
- Worker request content / Slot display name → `tests/host/worker-routing.test.ts` › "Slot display name"
- Worker request content / Parent request off → `tests/host/worker-routing.test.ts` › "Parent request off"
- Worker request content / Forked launch with thinking asks fewer questions → `tests/host/worker-routing.test.ts` › "Forked launch with thinking asks fewer questions"
- Worker request content / Service launch content → `tests/host/worker-routing.test.ts` › "Service launch content"
- Target check before writing / Unknown model → `tests/host/worker-routing.test.ts` › "Unknown model"
- Target check before writing / Missing credentials → `tests/host/worker-routing.test.ts` › "Missing credentials"
- Target check before writing / Unusable slot → `tests/host/worker-routing.test.ts` › "Unusable slot"
- Target check before writing / Model-locked launch not checked → `tests/host/worker-routing.test.ts` › "Model-locked launch not checked"
- Fallback warning / Warning text → `tests/host/worker-routing.test.ts` › "Warning text"
- Fallback warning / Slot warning text → `tests/host/worker-routing.test.ts` › "Slot warning text"
- Fallback warning / Once per tier → `tests/host/worker-routing.test.ts` › "Once per tier"
- Fallback warning / Once per slot → `tests/host/worker-routing.test.ts` › "Once per slot"
- Fallback warning / Nothing can run → `tests/host/worker-routing.test.ts` › "Nothing can run"
- Fallback warning / Unknown model wording → `tests/host/worker-routing.test.ts` › "Unknown model wording"
- Fallback warning / Shown again after a model change → `tests/host/worker-routing.test.ts` › "Shown again after a model change"
- Fallback warning / No UI → `tests/host/worker-routing.test.ts` › "No UI"
- Fallback warning / Slot warning with nothing to fall back to → `tests/host/worker-routing.test.ts` › "Slot warning with nothing to fall back to"
- Fallback warning / Slot warning shown again after its model changes → `tests/host/worker-routing.test.ts` › "Slot warning shown again after its model changes"
- Fallback warning / Slot warning shown again after a slot command → `tests/host/worker-routing.test.ts` › "Slot warning shown again after a slot command"
- Fallback warning / Shown again after /jev → `tests/host/worker-routing.test.ts` › "Shown again after /jev"
- Mode of a launch / Premium launch end to end → `tests/host/worker-routing.test.ts` › "Premium launch end to end"
- Mode of a launch / Mode changed between message end and launch → `tests/host/worker-routing.test.ts` › "Mode changed between message end and launch"
- Mode of a launch / Jev down in premium → `tests/host/worker-routing.test.ts` › "Jev down in premium"
- Reviewer slot routes / Review launch on the reviewer slot → `tests/host/worker-routing.test.ts` › "Review launch on the reviewer slot"
- Reviewer slot routes / Frontier wins over the reviewer slot → `tests/host/worker-routing.test.ts` › "Frontier wins over the reviewer slot"
- Reviewer slot routes / Background review launch → `tests/host/worker-routing.test.ts` › "Background review launch"
- Reviewer slot routes / Unusable reviewer slot falls back → `tests/host/worker-routing.test.ts` › "Unusable reviewer slot falls back"
- Reviewer slot routes / Jev down with a slot configured → `tests/host/worker-routing.test.ts` › "Jev down with a slot configured"
- Launches routing acts on / Launch from a worker → `tests/host/worker-routing.test.ts` › "Launch from a worker"
- Launches routing acts on / Service launch with an explicit model → `tests/host/worker-routing.test.ts` › "Service launch with an explicit model"
- Launches routing acts on / Service launch without a model → `tests/host/worker-routing.test.ts` › "Service launch without a model"

_432 scenarios._

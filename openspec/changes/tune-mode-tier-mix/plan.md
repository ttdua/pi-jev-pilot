# Mode Target Tier Mix Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Every mode routes workers at its target tier mix, using one shared worker rubric, a difficulty score, and per-mode cut points recomputed from recent ledger lines.

**Architecture:** Jev's worker answers become a difficulty score (`policy/score.ts`). Each mode's target table (`policy/modes.ts`) turns a window of recent scores into cut points. `decideTier` applies rules `expert`, `risky`, `slot`, `cut`. The host keeps the window in memory (`host/cutpoint-window.ts`), loads it from the ledger at `session_start`, feeds it from validated worker lines, and computes each launch's cut points when its request is built.

**Tech Stack:** TypeScript on Bun (`bun test`, `bun check`), oxlint, oxfmt, official Pi extension API.

## Global Constraints

- `policy/` imports only `policy/` and `shared/`; `store/` imports only `store/` and `shared/`; only `host/` imports Pi (enforced by `bun run lint`, `tests/boundaries.test.ts`).
- Fail open: a Jev failure or an unreadable ledger never blocks or changes a launch beyond the documented fallback (seed cut points).
- Tests need no secrets, paid calls or network beyond loopback.
- No prompt text, brief, tool argument or tool output is stored; the evidence note holds aggregates only.
- Public repository: code, comments, docs and commit messages in English.
- Worker tier wording is today's `standard` text, verbatim. `RUBRIC_VERSION` is `2`.
- Targets (whole percents): `budget` 50/40/10/0, `standard` 20/53/25/2, `premium` 0/50/45/5 (`fast`/`balanced`/`deep`/expert cap).
- Window: latest 200 eligible lines; fewer than 100 use the seed.
- Before each commit: `bun run typecheck && bun run lint && bun run fmt:check`, plus `bun test` for the files touched (full gate in Task 12). The only allowed red state is host tests asserting old reasons between Task 7 and Task 9.
- Seed values and the done-when replay come from data outside the repository (`/tmp/wg12-replay/`). Task 12 calls Jev about 2200 times (roughly $0.10) with the operator's key; this cost is approved at the plan gate.

## Review Focus

1. **Slot-only setup** (no tier configured, only a reviewer slot): no score exists, so a slot below .6 must decide nothing, never throw. Pinned in Task 7 by "Only a slot offered below the bar" and "Slot without a score".
2. **Expert switched off mid-session:** lines written while `expert` was not offered must not enter the window, and the expert cut must still be `+∞`-safe. Pinned in Task 5 ("Setup without expert left out") and Task 7 ("Expert not offered", plus `expert switched off gives expertMin +∞ and no expert`).
3. **Ledger rotation or a corrupt line at session start:** `readLedger` skips bad lines; the window must load from the valid ones only. Task 8 adds `loads only valid eligible lines from a ledger with one corrupt line`.
4. **Mode switched between two launches of one session:** the window is shared, the cut points differ per mode. Task 9 adds `two launches in different modes use different cut points from one window`.
5. **Old ledger lines** (`reason` `choice`, `expertNeeded`, no `rubric`) must still validate, still count in the session tally, and stay out of the window. Pinned in Task 3 ("Older worker line still accepted") and Task 5 ("Old rubric left out").

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `WORKER_TIER_CRITERIA` (`src/jev/rubrics.ts`) | new | `Readonly<Record<TierName, string>>`, today's `standard` text | no |
| `MAIN_TIER_CRITERIA` (`src/jev/rubrics.ts`) | new | `Readonly<Record<"fast" \| "balanced" \| "deep", string>>`, separate literal copy | no |
| `RUBRIC_VERSION` (`src/jev/rubrics.ts`) | new | `2` (`const`, number) | no |
| `TIER_CRITERIA`, `EXPERT_NEEDED_QUESTIONS` (`src/jev/rubrics.ts`) | removed | — | no |
| `buildWorkerQuestions` (`src/jev/questions.ts`) | modified | `(offered: readonly TierName[], displayNames: Partial<Record<TierName, string>>, slots?: readonly SlotOption[]) => { questions; specs }`; no `mode`, no `expert_needed` | no |
| `ModeTarget` (`src/policy/modes.ts`) | new | `{ readonly fast: number; readonly balanced: number; readonly deep: number; readonly expertCap: number }` (whole percents) | no |
| `MODE_TARGETS` (`src/policy/modes.ts`) | new | `Readonly<Record<ModeName, ModeTarget>>` | no |
| `expertAdmitted` (`src/policy/modes.ts`) | removed | — | no |
| `CutPoints` (`src/policy/cutpoints.ts`) | new | `{ readonly fastMax: number; readonly balancedMax: number; readonly expertMin: number }` (±`Infinity` allowed) | no |
| `WindowEntry` (`src/policy/cutpoints.ts`) | new | `{ readonly score: number; readonly effort: EffortLevel; readonly decided: TierName }`; `EffortLevel` imported from `policy/effort.ts` | no |
| `WindowLine` (`src/policy/cut-window.ts`) | new | `{ kind: string; at: number; rubric?: number; score?: number; expertOffered?: boolean; reason?: string; tier?: string; fallback?: string; effortP?: Partial<Record<EffortLevel, number>> }` (a structural subset of the ledger worker line, declared in `policy/` because `policy/` cannot import `store/`) | no |
| `RecentMix` (`src/policy/cut-window.ts`) | new | `{ n: number; shares?: Record<TierName, number> }` | no |
| `difficultyScore` (`src/policy/score.ts`) | new | `(answers: Record<string, Answer>) => number \| undefined` | no |
| `cutPoints` | new | `(entries: readonly WindowEntry[], target: ModeTarget) => CutPoints` | no |
| `windowEntries` (`src/policy/cut-window.ts`) | new | `(lines: readonly WindowLine[], rubric: number) => WindowEntry[]` (≤ 200) | no |
| `recentMix` (`src/policy/cut-window.ts`) | new | `(window: readonly WindowEntry[]) => RecentMix` | no |
| `SEED_CUTPOINTS` (`src/policy/seed.ts`) | new | `Readonly<Record<ModeName, CutPoints>>` | no |
| `cutPointsFor` | new | `(window: readonly WindowEntry[], mode: ModeName) => CutPoints` (seed below `WINDOW_MIN` = 100) | no |
| `WINDOW_MAX`, `WINDOW_MIN` (`src/policy/cut-window.ts`) | new | `200`, `100` | no |
| `decideTier` (`src/policy/tier.ts`) | modified | `(answers: WorkerAnswers, offered: readonly TierName[], cuts: CutPoints, slots?: readonly string[]) => TierDecision` | no |
| `TierDecision` reason | modified | `"expert" \| "risky" \| "slot" \| "cut"` | no |
| `RouteInput` (`src/policy/route.ts`) | modified | `mode: ModeName` replaced by `cuts: CutPoints` | no |
| Worker ledger line (`src/store/ledger-schema.ts`) | modified | adds optional `score` (0–3.5), `rubric` (int 1–99), `expertOffered` (bool); `reason` adds `expert`, `cut`; `expertNeeded` kept optional | yes (file format in `docs/`) |
| `CutpointWindow`, `createCutpointWindow` (`src/host/cutpoint-window.ts`) | new | `{ load(lines: readonly unknown[]): void; add(line: unknown): void; entries(): readonly WindowEntry[]; clear(): void }`; `createCutpointWindow(): CutpointWindow` | no |
| `WorkerDeps.window` (`src/host/worker.ts`) | new | `window?: () => readonly WindowEntry[]` (default `() => []`) | no |
| `LaunchEntry.cuts` (`src/host/worker.ts`) | new | `cuts: CutPoints`, set once at classification | no |
| `decisionFields` (`src/host/worker-line.ts`) | new | `(input: { answers: WorkerAnswers \| undefined; offered: readonly TierName[]; tierQuestion: boolean }) => { score?: number; rubric?: number; expertOffered?: boolean }` | no |
| `runJev` deps (`src/host/commands.ts`) | modified | adds `window?: () => readonly WindowEntry[]` | no |
| `setup` reader seam (`src/host/setup.ts`) | new | internal `readLines?: () => readonly unknown[]`, default reads `readLedger(jevDir())` entries | no |
| `formatStatus` (`src/host/commands.ts`) | modified | `(s: Snapshot, t?: Tally, window?: readonly WindowEntry[]) => string` | no |
| `/jev` status output | modified | adds `mix (last <n>, <mode>): fast <a>% / balanced <b>% / deep <c>% / expert <d>% · target <f>/<b>/<d>/≤<cap>`, `mix: no routed workers yet`, `cut points: seed` | yes |

---

## Task 1: One worker rubric — implements 1.1, 1.2

**Files:**
- Modify: `src/jev/rubrics.ts`, `src/jev/questions.ts`, `src/host/worker.ts` (call site only: drop the mode argument), `docs/jev-questions.md` (moved here from tasks.md 6.2, because the wording tests read it)
- Test: `tests/jev/questions.test.ts`, `tests/policy/strategy.test.ts`; drop the mode argument in `tests/policy/worker.test.ts:7` and `tests/host/commands.test.ts:450`

**Interfaces:**
- Produces: `WORKER_TIER_CRITERIA`, `MAIN_TIER_CRITERIA`, `RUBRIC_VERSION`, `buildWorkerQuestions` (Contracts).

- [ ] **Step 1:** In `tests/jev/questions.test.ts`, replace the per-mode tests with:
  - `worker questions never include expert_needed`: offering all four tiers gives question keys exactly `["tier","effort","risky"]`.
  - `worker tier criteria equal the docs worker rubric`: each criterion appears verbatim in `docs/jev-questions.md` under the worker rubric section; the `fast` one starts with `Fast and low cost, for bounded work with nothing to decide`, `deep` with `For careful judgment or long work`, `expert` with `Rare. Choose only for exceptionally difficult architectural or advisory reasoning`.
  - `rubric version 2 pins the wording`: `RUBRIC_VERSION === 2` and `TIER_INSTRUCTION` plus `WORKER_TIER_CRITERIA` equal an inline snapshot object in the test.
  - `main criteria are separate data`: `MAIN_TIER_CRITERIA !== WORKER_TIER_CRITERIA`, the texts are equal, and `MAIN_TIER_QUESTION.criteria` equals `MAIN_TIER_CRITERIA`.
  - `no slot: tier options are the four tiers`.
  - `display name prefix` and `missing display name`: unchanged expectations, without the mode argument.
  - Keep the "Slot criterion" tests; rewrite "Same in every mode" so it builds twice and compares.
- [ ] **Step 2:** Run `bun test tests/jev/questions.test.ts`. Expected: FAIL (old exports, mode argument).
- [ ] **Step 3:** Implement the Contracts entries in `src/jev/rubrics.ts`. Delete the budget/premium wordings, both expert questions and `EXPERT_NEEDED_QUESTIONS`. Point `MAIN_TIER_QUESTION` at `MAIN_TIER_CRITERIA`. In `buildWorkerQuestions`, drop `mode` and the `expert_needed` block, and update the call sites in `src/host/worker.ts`, `tests/policy/worker.test.ts` and `tests/host/commands.test.ts`.
- [ ] **Step 4:** Update `tests/policy/strategy.test.ts` wording: "equals the main tier criteria text". Edit `docs/jev-questions.md` in the same task: one worker tier rubric section, no `expert_needed` section, and a sentence stating the main `tier` uses its own `fast`, `balanced`, `deep` criteria without a display-name prefix.
- [ ] **Step 5:** Run `bun test tests/jev tests/policy tests/host/commands.test.ts && bun run typecheck`. Expected: PASS for the whole project (`bun check` includes `tests/`).
- [ ] **Step 6:** Commit `feat(worker-request): one worker tier rubric, no expert_needed`.

## Task 2: Mode targets — implements 2.1

**Files:**
- Modify: `src/policy/modes.ts`
- Test: `tests/policy/modes.test.ts`

**Interfaces:**
- Produces: `ModeTarget`, `MODE_TARGETS`.

- [ ] **Step 1:** Add to `tests/policy/modes.test.ts`, keeping the existing `expertAdmitted` tests until Task 7 removes the function:
  - `targets sum to 100`: for each mode, `fast + balanced + deep + expertCap === 100`;
  - `budget has no expert cap`;
  - `values`: an exact `toEqual` on the table in Global Constraints.
- [ ] **Step 2:** Run `bun test tests/policy/modes.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Add `MODE_TARGETS`. Leave `expertAdmitted` in place; Task 7 removes it together with its only caller, so every commit compiles.
- [ ] **Step 4:** Run `bun test tests/policy/modes.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `feat(worker-modes): target table per mode`.

## Task 3: Ledger schema — implements 4.1

**Files:**
- Modify: `src/store/ledger-schema.ts`
- Test: `tests/store/ledger-schema.test.ts`

**Interfaces:**
- Produces: the worker ledger line (Contracts). `WorkerEntry` gains `score?: number; rubric?: number; expertOffered?: boolean`.

- [ ] **Step 1:** Add tests for every `decision-ledger` scenario:
  - `score` 3.6 is rejected at `score`;
  - `rubric` 2.5 is rejected at `rubric`;
  - a cut-point line and an older line with `choice` and `expertNeeded` are both accepted;
  - `cut` without a `tier` is rejected;
  - `choice` without a `tier` is rejected;
  - `expert` and `expert-admitted` with a `tier` are accepted;
  - `fable` is rejected;
  - the exported field sets include the three new fields.
- [ ] **Step 2:** Run `bun test tests/store/ledger-schema.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Add the domains `score()` (finite, 0–3.5) and `rubricVersion()` (integer, 1–99), the three fields, and `"expert"` and `"cut"` in `DECIDING_REASONS`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(decision-ledger): score, rubric and expertOffered on worker lines`.

## Task 4: Difficulty score and cut points — implements 2.2, 2.3

**Files:**
- Create: `src/policy/score.ts` (`difficultyScore`), `src/policy/cutpoints.ts` (`CutPoints`, `cutPoints`)
- Test: `tests/policy/score.test.ts`, `tests/policy/cutpoints.test.ts`

**Interfaces:**
- Consumes: `Answer` (`policy/answers.ts`), `EffortLevel` (`policy/effort.ts`), `ModeTarget`.
- Produces: `CutPoints`, `WindowEntry`, `difficultyScore`, `cutPoints`.

- [ ] **Step 1:** Write tests named after each scenario of `mode-cutpoints` "Difficulty score" (in `score.test.ts`) and "Cut points from a window" (in `cutpoints.test.ts`), with the spec's values:
  - scores 1.25, 1.65, 1.25, 2.25, exactly 1.8, `undefined` (only a slot key), `undefined` (no `tier` answer, standing in for a miss);
  - ten scores .1–1.0 give standard (.2, .7, +∞), budget (.5, .9, +∞), premium (−∞, .5);
  - the 100-entry expert cap gives `expertMin` .96;
  - expert never below the balanced cut gives +∞;
  - ties under the cap give +∞;
  - an empty window gives all +∞;
  - a shuffled input gives `toEqual`.
- [ ] **Step 2:** Run `bun test tests/policy/score.test.ts tests/policy/cutpoints.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement `difficultyScore` with tier ranks `fast` 0, `balanced` 1, `deep` 2, `expert` 3 and effort ranks `low` 0 … `max` 4. Use the tier probability keys only, divided by their sum (sum 0 gives `undefined`), plus `rank(effort)/8`, with unanswered effort as `high`. Round with `Math.round(x * 1000) / 1000`.
- [ ] **Step 4:** Implement `cutPoints` exactly as `mode-cutpoints` "Cut points from a window" states (positions, the expert cap above `balancedMax`, empty window). Name the helpers `quantileAt(sorted, percent)` and `expertCut(entries, balancedMax, cap)` so `cutPoints` only composes them.
- [ ] **Step 5:** Run the test. Expected: PASS.
- [ ] **Step 6:** Commit `feat(mode-cutpoints): difficulty score and cut points`.

## Task 5: Window entries and recent mix — implements 2.4

**Files:**
- Create: `src/policy/cut-window.ts` (`WindowLine`, `windowEntries`, `recentMix`, `WINDOW_MAX`, `WINDOW_MIN`)
- Test: `tests/policy/cut-window.test.ts`

**Interfaces:**
- Produces: `WindowLine`, `RecentMix`, `windowEntries`, `recentMix`, `WINDOW_MAX`, `WINDOW_MIN`.

- [ ] **Step 1:** Add tests for every scenario of "Window entries" and "Recent mix":
  - slot, old rubric, `expertOffered` false, miss and untouched are each excluded;
  - 250 lines give the latest 200;
  - `tier` `balanced` with `fallback` `deep` gives decided `deep`;
  - 201 lines where the two earliest share an `at` drop the first in input order;
  - an `effortP` tie `high`/`xhigh` at .5 gives `xhigh`;
  - `xhigh` .6 gives `xhigh`;
  - the mix of `fast`, `balanced`, `balanced`, `deep` is 4 entries at 25/50/25/0;
  - an empty window gives `{ n: 0 }`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Filter the eligible lines, stable-sort by `at` (`Array.prototype.sort` is stable in Bun) and take the last 200. Effort is the argmax with ties going to the higher level; without `effortP` it is `high`. `recentMix` rounds each share with `Math.round(100 * c / n)`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(mode-cutpoints): window entries and recent mix`.

## Task 6: Seed cut points — implements 2.5

**Files:**
- Create: `src/policy/seed.ts` (`SEED_CUTPOINTS`, data only); modify `src/policy/cutpoints.ts` (`cutPointsFor`)
- Test: `tests/policy/cutpoints.test.ts`
- Outside the repository: a script in `/tmp/issue39-spike/` that imports `src/policy/score.ts` and `src/policy/cutpoints.ts` by path and reads `/tmp/wg12-replay/out.jsonl`

**Interfaces:**
- Consumes: `WINDOW_MIN` (`cut-window.ts`), which imports only `WindowEntry` as a type from `cutpoints.ts`, so there is no runtime cycle.
- Produces: `SEED_CUTPOINTS`, `cutPointsFor`.

- [ ] **Step 1:** Write `/tmp/issue39-spike/seed.ts`. For every `standard` variant record of the replay, build answers from `tierP` and `effort`, call `difficultyScore`, then call `cutPoints` per mode over all records. Print only the three numbers per mode. Run it with `bun /tmp/issue39-spike/seed.ts <repo> /tmp/wg12-replay/out.jsonl`.
- [ ] **Step 2:** Add tests:
  - `short window uses the seed` (99 entries);
  - `full window computed` (100 entries equal `cutPoints(window, target)`);
  - `seed is a valid result` (`fastMax ≤ balancedMax < expertMin`, premium `fastMax` −∞, budget `expertMin` +∞).
  
  The scenario "Seed matches the evidence note" is added in Task 12, once the note exists.
- [ ] **Step 3:** Run the tests. Expected: FAIL.
- [ ] **Step 4:** Add `SEED_CUTPOINTS` in `src/policy/seed.ts` with the printed values (a comment names the replay and the evidence note), and `cutPointsFor` in `cutpoints.ts`.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Commit `feat(mode-cutpoints): seed cut points from the 2026-11-07 replay`.

## Task 7: Tier decision and route — implements 3.1, 3.2

**Files:**
- Modify: `src/policy/tier.ts`, `src/policy/modes.ts` (remove `expertAdmitted` and the gates), `src/policy/route.ts` (`RouteInput.cuts` replaces `mode`), `src/host/worker.ts` (seed placeholder only)
- Test: `tests/policy/tier.test.ts`, `tests/policy/modes.test.ts`, `tests/policy/route.test.ts`, `tests/policy/worker.test.ts` (only if it names a removed reason)

**Interfaces:**
- Consumes: `CutPoints`, `difficultyScore`.
- Produces: `decideTier`, the `TierDecision` reasons and `RouteInput` (Contracts).

- [ ] **Step 1:** Rewrite `tests/policy/tier.test.ts` with one test per scenario of `worker-decision` ADDED and MODIFIED "Decision order", "Expert rule", "Cut rule", "Risk floor rule", "Partial answers in the decision", "Fallthrough without a qualifying tier", "Slot rule" and "Slot below the bar uses the score". Rules:
  - "Table per mode" is a `test.each` over the 7 rows × 3 modes, with the spec's cut points.
  - Build answers whose `tierP` produces the score a scenario names, for example `{deep: 0.9, balanced: 0.1}` with `xhigh` gives 2.275.
  - Where a scenario names a score directly, add a helper `answersForScore(score, effort)` in the test file. Let `x = score - effortRank / 8` and `r = Math.floor(x)` (capped at 2). Put probability `r + 1 - x` on the tier of rank `r` and `x - r` on rank `r + 1`, so the expected rank is `x`.
  - Review Focus 2: `expert switched off gives expertMin +∞ and no expert`, where offered has no `expert`, the score is 3.4 and effort is `max`, gives `deep` with reason `cut`.
  - Add the `worker-modes` scenario "Same score, different tiers" here with literal cut points: score 1.85 under (1.41, 2.13, +∞) is `balanced`, under (−∞, 1.41, 2.12) is `deep`.
  - In `tests/policy/route.test.ts`, pass `cuts`, replace the `Record<RouteReason, Route>` keys with `expert`, `risky`, `slot`, `cut`, and expect reason `cut` in "Chosen tier written", "All lower tiers unusable" and "Model locked". "Recorded results validate" passes because the schema task already accepts `cut` and `expert`.
- [ ] **Step 2:** Run `bun test tests/policy`. Expected: FAIL.
- [ ] **Step 3:** Rewrite `decideTier` with the rule order `expert`, `risky`, `slot`, `cut`, composed from named helpers `expertRule`, `riskRule`, `slotRule`, `cutTier` and `nearestOffered`:
  - Delete `decideFromTierChoice`, `substituteTier` and the `expert-admitted`, `expert-denied` and `fast-unsure` reasons.
  - Delete `expertAdmitted` and both gates from `src/policy/modes.ts`, and their tests in `tests/policy/modes.test.ts`.
  - Pass `input.cuts` to `decideTier` in `route.ts`. In `src/host/worker.ts`, pass `cuts: cutPointsFor([], entry.mode)` (seed) for now; Task 9 replaces it with the window. This commit passes `bun run typecheck`.
  - Keep `chooseFallback` unchanged.
  - The `cut` move for a tier that is not offered: pick the nearest offered tier below it, otherwise the nearest above it, excluding `expert`.
- [ ] **Step 4:** Run `bun test tests/policy && bun run typecheck`. Expected: PASS. Host tests that assert old reasons may fail until Task 9; that is the only allowed red state, and Task 9 closes it.
- [ ] **Step 5:** Commit `feat(worker-decision): decide tiers by score and cut points`.

## Task 8: Cut-point window — implements 5.1

**Files:**
- Create: `src/host/cutpoint-window.ts`
- Modify: `src/host/setup.ts`: create the window, call `load(readLedger(jevDir()).entries)` in the existing main `session_start` handler (empty on `unreadable`), and call `window.add(e)` inside the existing `append` wrapper's `finally`, next to `log.record(e)`
- Test: `tests/host/cutpoint-window.test.ts`

**Interfaces:**
- Consumes: `windowEntries`, `RUBRIC_VERSION`, `validateLedgerEntry`.
- Produces: `CutpointWindow`, `createCutpointWindow(): CutpointWindow`.

- [ ] **Step 1:** Write tests, one per `worker-routing` "Cut-point window" scenario:
  - 150 eligible lines load 150 entries;
  - 99 entries plus one `add` give 100;
  - an unreadable ledger, simulated with a directory in place of the ledger file in a temp jev dir, leaves the window empty;
  - `add` of a valid line whose write fails still counts. Drive this through `setup`'s `append` with a failing `appendLedger` stub, or through a unit on `add`;
  - the ledger is read once per session. Spy on the reader injected into `setup`, or count `readLedger` calls through a dependency.
  
  Also add the Review Focus test `loads only valid eligible lines from a ledger with one corrupt line`, against a real temp ledger written as raw text, so `readLedger`'s skip logic runs.
- [ ] **Step 2:** Run `bun test tests/host/cutpoint-window.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement:
  - `add` validates the line, ignores invalid or ineligible lines, and keeps at most `WINDOW_MAX` entries.
  - `load` replaces the entries.
  - `setup` reads through `readLedger(jevDir())`; inject only a call counter (`readLines?: () => readonly unknown[]`, default `readLedger`) for the "read once per session" test.
  - Child sessions return early, as the existing `session_start` handler already does.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(worker-routing): in-memory cut-point window`.

## Task 9: Worker routing and ledger line — implements 5.2, 5.5

**Files:**
- Modify: `src/host/worker.ts`
- Test: `tests/host/worker-routing.test.ts`, `tests/host/worker-ledger.test.ts`, and other failing host tests (`tests/host/q1-q7-worker-mutation.test.ts`, `tests/host/worker.test.ts`, `tests/host/tally.test.ts`, `tests/host/status.test.ts`)

**Interfaces:**
- Consumes: `CutpointWindow.entries()`, `cutPointsFor`, `difficultyScore`, `RUBRIC_VERSION`.
- Produces: `WorkerDeps.window` and `LaunchEntry.cuts` (Contracts). `setup` passes `() => window.entries()`.
- Create: `src/host/worker-line.ts` with `decisionFields(input: { answers, offered, tierQuestion }): { score?: number; rubric?: number; expertOffered?: boolean }`, so `write()` in `worker.ts` only merges it.

- [ ] **Step 1:** Add the routing tests:
  - "Siblings share a window state": two calls in one message; both entries carry the same `CutPoints` object, compared with `toEqual` against `cutPointsFor(snapshot, mode)`.
  - "Launch classified alone": a codemode-style call after a line was added sees the new window.
  - "Premium launch end to end": seed, `deep` .9 / `balanced` .1, `xhigh`. The ledger has `reason` `expert`, `score` 2.275 and `mode` `premium`, and the child runs on `tiers.expert`.
  - "Mode changed between message end and launch": `standard` cut points are used.
  - "Jev down in premium": no `score`.
  - The Review Focus test `two launches in different modes use different cut points from one window`.
- [ ] **Step 2:** Update `tests/host/worker-ledger.test.ts` for every "Decision fields" scenario:
  - `rubric` 2 and `expertOffered` on asked lines;
  - `score` on decided lines;
  - no `expertNeeded`;
  - "Tier asked, nothing decided";
  - "Expert switched off recorded".
- [ ] **Step 3:** Run `bun test tests/host/worker-routing.test.ts tests/host/worker-ledger.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement:
  - Add `cuts: CutPoints` to `LaunchEntry`, set in `classify` from `cutPointsFor(window(), entry.mode)`, replacing the seed placeholder from Task 7. Default `window` is `() => []`, which falls back to the seed.
  - Pass `entry.cuts` into `routeLaunch`.
  - On the line, merge `decisionFields(...)`: `rubric` and `expertOffered` (`offered.includes("expert")`) when the `tier` question was asked, `score` from `difficultyScore` when answers were read. Stop writing `expertNeeded`. Unit-test `decisionFields` in `tests/host/worker-line.test.ts`.
- [ ] **Step 5:** Run `bun test tests/host`. Fix only the assertions that name the old reasons or per-mode requests, keeping each test's intent. Expected: PASS.
- [ ] **Step 6:** Commit `feat(worker-routing): route by cut points and record score`.

## Task 10: Status report and log line — implements 5.3, 5.4

**Files:**
- Modify: `src/host/commands.ts` (`formatStatus`, `runJev` deps gain `window?: () => readonly WindowEntry[]`), `src/host/setup.ts` (pass it), `src/host/status.ts:151` (hide `cut`)
- Test: `tests/host/commands.test.ts`, `tests/host/verbose-log.test.ts`

**Interfaces:**
- Consumes: `recentMix`, `MODE_TARGETS`, `WINDOW_MIN`.

- [ ] **Step 1:** Add the command tests, with exact strings from `jev-command`:
  - the line `mix (last 200, standard): fast 19% / balanced 55% / deep 24% / expert 2% · target 20/53/25/≤2`, with no `cut points: seed` line;
  - budget, 120 entries: the line ends with `target 50/40/10/≤0`;
  - 40 entries: `mix (last 40, ` followed by `cut points: seed`;
  - empty window: `mix: no routed workers yet` and `cut points: seed`;
  - no executor: no `mix` line.
  
  Add the verbose-log tests "Cut reason hidden" (`jev · worker → balanced · high · 0.3s`) and "Expert reason shown" (contains ` · why expert`).
- [ ] **Step 2:** Run `bun test tests/host/commands.test.ts tests/host/verbose-log.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Place the mix lines after the problems and before the tally. In `status.ts:151`, add `e.reason !== "cut"`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(jev-command): show recent worker mix against the target`.

## Task 11: ADR and docs — implements 6.1, 6.2

**Files:**
- Create: `docs/decisions/0008-mode-target-cutpoints.md`
- Modify: `docs/decisions/0003-rubric-per-mode.md` (status `Superseded by 0008`), `docs/decisions/README.md`, `docs/domain-model.md`, `docs/glossary.md`, `docs/jev-contract.md`, `docs/architecture.md`, `docs/configuration.md`, `docs/workflow.md`, `docs/usage-guide.md`, `docs/roadmap.md`

- [ ] **Step 1:** Write ADR 0008 in the format of ADR 0003 (Context, Decision, Consequences). It must cover:
  - a mode is a target table;
  - cut points are recomputed from the ledger;
  - expert requires the cut plus `xhigh`/`max`;
  - the main request is unchanged;
  - this is not tuning under ADR 0005, because the targets never change automatically and nothing is stored.
- [ ] **Step 2:** Update the docs listed in tasks.md 6.2:
  - Replace per-mode rubric and expert gate text with targets, the score and cut points.
  - Replace the mode table in `usage-guide.md` with the targets and the `/jev` mix line.
  - In `jev-contract.md`, drop the `expert_needed` row.
  - Add the glossary entries *difficulty score* and *cut point*. Reword *rubric*, *mode* and *expert gate*.
- [ ] **Step 3:** Run `bun test && bun run fmt:check`. Expected: PASS (docs-only change).
- [ ] **Step 4:** Commit `docs: ADR 0008 and mode targets`.

## Task 12: Evidence and gate — implements 6.3, 6.4

**Files:**
- Create: `docs/evidence/<YYYY-MM-DD>-tier-mix.md`
- Test: `tests/policy/cutpoints.test.ts` ("Seed matches the evidence note")
- Outside the repository: `/tmp/issue39-spike/replay-check.ts`

- [ ] **Step 1:** Write `/tmp/issue39-spike/replay-check.ts`. It routes the 2026-11-07 briefs in extraction order through the new request and `decideTier`, using `/tmp/wg12-replay/briefs.jsonl` and `TYPESAFE_API_KEY` from the operator's environment, at about $0.10 for a run plus a rerun. This is the only networked step and it is not part of `bun test`. tasks.md 6.3 says "offline" in the sense of outside the package and CI; the run itself calls Jev, as the WG-12 replay did, and the operator approves its cost at the plan gate. It feeds a rolling window as the host would, and prints only aggregates:
  - per mode, the mix over all launches and over non-review launches;
  - rerun flips;
  - the worst 400-launch window deviation.
  
  If no key is available, stop and report. Do not mark 6.3 done.
- [ ] **Step 2:** Write the evidence note with the seed values (Task 6), the mixes, the rerun noise and the windowed check, in the format of `docs/evidence/2026-11-07-replay.md`, aggregates only. Then add the test "Seed matches the evidence note": parse the note's seed table and compare it with `SEED_CUTPOINTS`.
- [ ] **Step 3:** Run `bun run typecheck && bun run lint && bun run fmt:check && bun test`. Expected: all PASS.
- [ ] **Step 4:** Commit `docs(evidence): tier mix by mode`.

---

## Scenario → test

Each line is `Requirement › Scenario → test file`. The test name in the file matches the scenario name.

**decision-ledger**

- Ledger value domains › NaN probability rejected → `tests/store/ledger-schema.test.ts`
- Ledger value domains › Slot target accepted → `tests/store/ledger-schema.test.ts`
- Ledger value domains › Target distribution capped at 12 → `tests/store/ledger-schema.test.ts`
- Ledger value domains › Score out of range rejected → `tests/store/ledger-schema.test.ts`
- Ledger value domains › Fractional rubric rejected → `tests/store/ledger-schema.test.ts`
- Ledger value domains › Malformed target rejected → `tests/store/ledger-schema.test.ts`
- Ledger line schema › Valid main line accepted → `tests/store/ledger-schema.test.ts`
- Ledger line schema › Valid worker line accepted → `tests/store/ledger-schema.test.ts`
- Ledger line schema › Worker line with cut-point fields accepted → `tests/store/ledger-schema.test.ts`
- Ledger line schema › Older worker line still accepted → `tests/store/ledger-schema.test.ts`
- Ledger line schema › Valid correction line accepted → `tests/store/ledger-schema.test.ts`
- Ledger line schema › Unknown kind rejected → `tests/store/ledger-schema.test.ts`
- Ledger line schema › Field from another kind rejected → `tests/store/ledger-schema.test.ts`
- Ledger line schema › Missing required field rejected → `tests/store/ledger-schema.test.ts`
- Ledger line schema › Exported field sets match the table → `tests/store/ledger-schema.test.ts`
- Ledger line schema › Unknown agent value is still an identifier → `tests/store/ledger-schema.test.ts`
- Worker decisions record their tier › Deciding worker without a tier rejected → `tests/store/ledger-schema.test.ts`
- Worker decisions record their tier › Retired reason without a tier rejected → `tests/store/ledger-schema.test.ts`
- Worker decisions record their tier › Untouched worker without a tier accepted → `tests/store/ledger-schema.test.ts`
- Worker decisions record their tier › Expert accepted → `tests/store/ledger-schema.test.ts`
- Worker decisions record their tier › Expert admitted accepted → `tests/store/ledger-schema.test.ts`
- Worker decisions record their tier › Old reason name rejected → `tests/store/ledger-schema.test.ts`

**jev-command**

- Status report › Default status → `tests/host/commands.test.ts`
- Status report › CLI review default shown → `tests/host/commands.test.ts`
- Status report › No executor → `tests/host/commands.test.ts`
- Status report › Key name, never value → `tests/host/commands.test.ts`
- Status report › Malformed state reported → `tests/host/commands.test.ts`
- Status report › Invalid config reported → `tests/host/commands.test.ts`
- Status report › Empty tally → `tests/host/commands.test.ts`
- Status report › Tally after work → `tests/host/commands.test.ts`
- Status report › Mix with a full window → `tests/host/commands.test.ts`
- Status report › Budget target shown → `tests/host/commands.test.ts`
- Status report › Mix while the seed applies → `tests/host/commands.test.ts`
- Status report › Empty window → `tests/host/commands.test.ts`
- Status report › No mix without the executor → `tests/host/commands.test.ts`

**mode-cutpoints**

- Difficulty score › Balanced with high effort → `tests/policy/score.test.ts`
- Difficulty score › Mixed probabilities → `tests/policy/score.test.ts`
- Difficulty score › Slot keys ignored → `tests/policy/score.test.ts`
- Difficulty score › Effort unanswered → `tests/policy/score.test.ts`
- Difficulty score › Rounded before use → `tests/policy/score.test.ts`
- Difficulty score › Only slot probability → `tests/policy/score.test.ts`
- Difficulty score › Jev failure gives no score → `tests/policy/score.test.ts`
- Cut points from a window › Standard target on ten scores → `tests/policy/cutpoints.test.ts`
- Cut points from a window › Budget target on ten scores → `tests/policy/cutpoints.test.ts`
- Cut points from a window › Premium has no fast cut → `tests/policy/cutpoints.test.ts`
- Cut points from a window › Expert cap → `tests/policy/cutpoints.test.ts`
- Cut points from a window › Expert never below the balanced cut → `tests/policy/cutpoints.test.ts`
- Cut points from a window › Ties stay under the cap → `tests/policy/cutpoints.test.ts`
- Cut points from a window › Empty window → `tests/policy/cutpoints.test.ts`
- Cut points from a window › Order independent → `tests/policy/cutpoints.test.ts`
- Window entries › Slot launch left out → `tests/policy/cut-window.test.ts`
- Window entries › Old rubric left out → `tests/policy/cut-window.test.ts`
- Window entries › Setup without expert left out → `tests/policy/cut-window.test.ts`
- Window entries › Miss and untouched left out → `tests/policy/cut-window.test.ts`
- Window entries › Latest 200 → `tests/policy/cut-window.test.ts`
- Window entries › Decided tier before fallback → `tests/policy/cut-window.test.ts`
- Window entries › Equal times at the boundary → `tests/policy/cut-window.test.ts`
- Window entries › Effort tie → `tests/policy/cut-window.test.ts`
- Window entries › Effort from the distribution → `tests/policy/cut-window.test.ts`
- Seed cut points › Short window uses the seed → `tests/policy/cutpoints.test.ts`
- Seed cut points › Full window computed → `tests/policy/cutpoints.test.ts`
- Seed cut points › Seed matches the evidence note → `tests/policy/cutpoints.test.ts` (reads the seed table in `docs/evidence/<date>-tier-mix.md`)
- Seed cut points › Seed is a valid result → `tests/policy/cutpoints.test.ts`
- Recent mix › Mix of four entries → `tests/policy/cut-window.test.ts`
- Recent mix › Empty window → `tests/policy/cut-window.test.ts`

**strategy-advice**

- Strategy questions › Strategy on → `tests/policy/strategy.test.ts`
- Strategy questions › Tier criteria without a prefix → `tests/policy/strategy.test.ts`
- Strategy questions › Strategy off → `tests/policy/strategy.test.ts`
- Strategy questions › Docs state no prefix for the main tier → `tests/policy/strategy.test.ts`
- Strategy questions › Wording matches the docs → `tests/policy/strategy.test.ts`

**verbose-log**

- Worker log line segments › Worker fallback text → `tests/host/verbose-log.test.ts`
- Worker log line segments › Worker miss text → `tests/host/verbose-log.test.ts`
- Worker log line segments › Worker untouched text → `tests/host/verbose-log.test.ts`
- Worker log line segments › Cut reason hidden → `tests/host/verbose-log.test.ts`
- Worker log line segments › Expert reason shown → `tests/host/verbose-log.test.ts`

**worker-decision**

- Expert rule › Expert by score and effort → `tests/policy/tier.test.ts`
- Expert rule › Expert at the cut → `tests/policy/tier.test.ts`
- Expert rule › High effort is not enough → `tests/policy/tier.test.ts`
- Expert rule › Expert not offered → `tests/policy/tier.test.ts`
- Expert rule › Budget never reaches expert → `tests/policy/tier.test.ts`
- Expert rule › Expert stands on high risk → `tests/policy/tier.test.ts`
- Cut rule › Fast at the cut → `tests/policy/tier.test.ts`
- Cut rule › Balanced → `tests/policy/tier.test.ts`
- Cut rule › Deep → `tests/policy/tier.test.ts`
- Cut rule › Premium never cuts to fast → `tests/policy/tier.test.ts`
- Cut rule › Unoffered tier moves down → `tests/policy/tier.test.ts`
- Cut rule › Unoffered tier moves up → `tests/policy/tier.test.ts`
- Fallthrough without a qualifying tier › Risk floor with only fast → `tests/policy/tier.test.ts`
- Fallthrough without a qualifying tier › Risk floor with only a slot → `tests/policy/tier.test.ts`
- Fallthrough without a qualifying tier › Only fast offered → `tests/policy/tier.test.ts`
- Fallthrough without a qualifying tier › Only expert offered → `tests/policy/tier.test.ts`
- Slot below the bar uses the score › Slot below the bar → `tests/policy/tier.test.ts`
- Slot below the bar uses the score › Slot not offered → `tests/policy/tier.test.ts`
- Slot below the bar uses the score › Slot below the bar reaches expert → `tests/policy/tier.test.ts`
- Slot below the bar uses the score › Only a slot offered below the bar → `tests/policy/tier.test.ts`
- Decision order › Ordinary choice → `tests/policy/tier.test.ts`
- Decision order › Same answers, different modes → `tests/policy/tier.test.ts`
- Decision order › Table per mode → `tests/policy/tier.test.ts`
- Decision order › Slot in every mode → `tests/policy/tier.test.ts`
- Risk floor rule › Risk floor → `tests/policy/tier.test.ts`
- Risk floor rule › Risk boundary → `tests/policy/tier.test.ts`
- Risk floor rule › Risk floor without deep → `tests/policy/tier.test.ts`
- Partial answers in the decision › Risk floor without a tier answer → `tests/policy/tier.test.ts`
- Partial answers in the decision › Expert needed unanswered → `tests/policy/tier.test.ts`
- Partial answers in the decision › Effort unanswered in premium → `tests/policy/tier.test.ts`
- Partial answers in the decision › Slot without a score → `tests/policy/tier.test.ts`
- Partial answers in the decision › No tier answer → `tests/policy/tier.test.ts`
- Partial answers in the decision › No tier offered → `tests/policy/tier.test.ts`
- Partial answers in the decision › Every answer unanswered → `tests/policy/tier.test.ts`
- Routed launch › Chosen tier written → `tests/policy/route.test.ts`
- Routed launch › Clamped to the model → `tests/policy/route.test.ts`
- Routed launch › Cascade with xhigh → `tests/policy/route.test.ts`
- Routed launch › Slot written → `tests/policy/route.test.ts`
- Routed launch › Slot falls back with xhigh → `tests/policy/route.test.ts`
- Nothing can run › All lower tiers unusable → `tests/policy/route.test.ts`
- Nothing can run › Expert never a cascade target → `tests/policy/route.test.ts`
- Nothing can run › Unusable slot alone → `tests/policy/route.test.ts`
- Locks in the route › Model locked → `tests/policy/route.test.ts`
- Locks in the route › Model locked without a decided tier → `tests/policy/route.test.ts`
- Locks in the route › Thinking locked → `tests/policy/route.test.ts`
- Locks in the route › Model locked with a slot decided → `tests/policy/route.test.ts`
- Slot rule › Slot at the bar → `tests/policy/tier.test.ts`
- Slot rule › Risk wins over a slot → `tests/policy/tier.test.ts`
- Slot rule › Two slots → `tests/policy/tier.test.ts`

**worker-ledger**

- Decision fields › Routed fields → `tests/host/worker-ledger.test.ts`
- Decision fields › Expert offered recorded → `tests/host/worker-ledger.test.ts`
- Decision fields › Expert switched off recorded → `tests/host/worker-ledger.test.ts`
- Decision fields › Fallback recorded → `tests/host/worker-ledger.test.ts`
- Decision fields › Nothing could run recorded → `tests/host/worker-ledger.test.ts`
- Decision fields › Thinking-only recorded → `tests/host/worker-ledger.test.ts`
- Decision fields › Miss recorded → `tests/host/worker-ledger.test.ts`
- Decision fields › Untouched recorded → `tests/host/worker-ledger.test.ts`
- Decision fields › Tier asked, nothing decided → `tests/host/worker-ledger.test.ts`
- Decision fields › No expert needed field → `tests/host/worker-ledger.test.ts`
- Decision fields › Locked recorded → `tests/host/worker-ledger.test.ts`
- Decision fields › Not locked → `tests/host/worker-ledger.test.ts`
- Decision fields › No prompt text → `tests/host/worker-ledger.test.ts`
- Decision fields › Mode recorded → `tests/host/worker-ledger.test.ts`
- Decision fields › Tool counts recorded → `tests/host/worker-ledger.test.ts`
- Decision fields › No assessment, no counts → `tests/host/worker-ledger.test.ts`
- Decision fields › Resumed launch carries no counts → `tests/host/worker-ledger.test.ts`
- Decision fields › Slot decision recorded → `tests/host/worker-ledger.test.ts`
- Decision fields › Slot fallback recorded → `tests/host/worker-ledger.test.ts`

**worker-modes**

- Mode targets › Shares sum to 100 → `tests/policy/modes.test.ts`
- Mode targets › Budget never routes expert → `tests/policy/modes.test.ts`
- Mode selects a target table › Worker request ignores the mode → `tests/jev/questions.test.ts`
- Mode selects a target table › Same score, different tiers → `tests/policy/tier.test.ts`
- Mode selects a target table › Main request ignores the mode → `tests/jev/questions.test.ts`

**worker-request**

- Rubric version › Version of this rubric → `tests/jev/questions.test.ts`
- Rubric version › Wording pinned to the version → `tests/jev/questions.test.ts`
- Worker question set › No tier configured → `tests/jev/questions.test.ts`
- Worker question set › Slot alone → `tests/jev/questions.test.ts`
- Worker question set › Expert offered → `tests/jev/questions.test.ts`
- Worker question set › Asked and accepted agree → `tests/jev/questions.test.ts`
- Offered tiers › Partial configuration → `tests/jev/questions.test.ts`
- Offered tiers › Expert switched off → `tests/jev/questions.test.ts`
- Offered tiers › Slots after tiers → `tests/jev/questions.test.ts`
- Offered tiers › No slot, request unchanged → `tests/jev/questions.test.ts`
- Slot criterion › Reviewer criterion → `tests/jev/questions.test.ts`
- Slot criterion › No display name → `tests/jev/questions.test.ts`
- Slot criterion › Same in every mode → `tests/jev/questions.test.ts`
- Slot criterion › Slot answer read → `tests/jev/questions.test.ts`
- Question wording › Wording matches the docs → `tests/jev/questions.test.ts`
- Question wording › Standard request unchanged → `tests/jev/questions.test.ts`
- Question wording › Budget expert criterion → `tests/jev/questions.test.ts`
- Question wording › Premium wording → `tests/jev/questions.test.ts`
- Question wording › Main criteria held apart → `tests/jev/questions.test.ts`
- Question wording › Display name prefix → `tests/jev/questions.test.ts`
- Question wording › Missing display name → `tests/jev/questions.test.ts`

**worker-routing**

- Cut-point window › Window loaded at session start → `tests/host/cutpoint-window.test.ts`
- Cut-point window › Window grows during the session → `tests/host/cutpoint-window.test.ts`
- Cut-point window › Unreadable ledger → `tests/host/cutpoint-window.test.ts`
- Cut-point window › Write failure still counts → `tests/host/cutpoint-window.test.ts`
- Cut-point window › No ledger read per launch → `tests/host/cutpoint-window.test.ts`
- Cut points of a launch › Siblings share a window state → `tests/host/worker-routing.test.ts`
- Cut points of a launch › Launch classified alone → `tests/host/worker-routing.test.ts`
- Mode of a launch › Premium launch end to end → `tests/host/worker-routing.test.ts`
- Mode of a launch › Mode changed between message end and launch → `tests/host/worker-routing.test.ts`
- Mode of a launch › Jev down in premium → `tests/host/worker-routing.test.ts`

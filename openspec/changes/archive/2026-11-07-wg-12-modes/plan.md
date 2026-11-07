# WG-12 Modes and Expert Gate Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` (`worker-modes`, `worker-decision`, `worker-request`, `decision-ledger`, `worker-ledger`, `worker-routing`, `jev-command`) and `design.md`.

**Goal:** Make the mode select the worker tier rubric, the `expert_needed` wording and the expert gate; add `/jev mode`; rename `fable` to `expert-admitted` everywhere.

**Architecture:** The pure gate lives in a new `policy/modes.ts` and is called by `decideTier` as rule 1. Rubric text stays as data in `jev/rubrics.ts`, keyed by mode. `host/worker.ts` captures the mode once per launch and passes it to question building, `routeLaunch` and the ledger line (design D1).

**Tech Stack:** TypeScript, Bun (`bun test`), oxlint boundary rules, `@earendil-works/pi-coding-agent` 1.5.0, `@gotgenes/pi-subagents` 25.0.5 (host test only).

## Global Constraints

- `policy/` imports only itself and `shared/`; `jev/` may import `policy/`; only `host/` imports Pi (`.oxlintrc.json`).
- Mode names: exactly `budget`, `standard`, `premium`; default `standard`.
- Gate values: `budget`/`standard` `expert_needed > .9` (strict); `premium` `P(expert) ≥ .1` (inclusive), `effort.choice` in `xhigh`, `max`, `tier.choice` in `deep`, `expert`.
- Rubric and `expert_needed` text copied verbatim from `docs/jev-questions.md`; the `standard` strings do not change.
- Ledger `v` stays `1`; no state, config or schema version change; no new dependency.
- Tests need no secrets, paid calls or network beyond loopback.
- Everything in the repository is English; relative imports use the `.ts` extension.

## Review Focus

- **A launch classified at `message_end` whose `tool_call` arrives after `/jev mode`.** It must keep the classification mode for gate and ledger. Test "Mode changed between message end and launch" in Task 4.
- **`premium` with the `expert` switch off.** `expert` is not offered, so `expert_needed` is not asked and the gate cannot pass; a `deep`/`xhigh` answer stays `deep`. Test "Premium with expert switched off" in Task 4.
- **`tier` probabilities without an `expert` key** (a request that offered no `expert`). The gate must read it as absent, never as a pass. Covered by "Expert probability missing" in Task 1.
- **An old ledger line with `reason` `fable`.** Rejected by validation and skipped by the tolerant read. Test "Old reason name rejected" in Task 2.
- **`/jev mode` with a valid mode but different case** (`Premium`). Usage, no write. Test "Unknown mode" in Task 5.
- **Not covered on purpose:** `route()` still reads `tiers`, `forkedLaunch` and model checks from the tool-call snapshot while `offered` and `specs` come from classification. That pre-dates this change; D1 fixes only the mode.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `/jev mode <budget\|standard\|premium>` | new | Exactly two words; writes `state.json` `mode`; reports status; usage line `  /jev mode budget\|standard\|premium` | yes (operator-approved) |
| Ledger worker `reason` | modified | `"expert-admitted" \| "risky" \| "slot" \| "expert-denied" \| "fast-unsure" \| "choice" \| "untouched" \| "miss"` (`fable` removed) | yes (file format, unreleased) |
| `MODE_NAMES`, `ModeName` (`src/policy/modes.ts`) | new | `readonly ["budget","standard","premium"]`; `ModeName = (typeof MODE_NAMES)[number]` | no |
| `expertAdmitted(mode: ModeName, answers: Record<string, Answer>): boolean` | new | `src/policy/modes.ts`; reads `tier`, `expert_needed`, `effort` raw answers | no |
| `TierDecision` (`src/policy/tier.ts`) | modified | reason union: `"expert-admitted" \| "risky" \| "expert-denied" \| "fast-unsure" \| "choice"` | no |
| `decideTier(answers: WorkerAnswers, offered: readonly TierName[], mode: ModeName): TierDecision` | modified | adds `mode` | no |
| `RouteInput` (`src/policy/route.ts`) | modified | adds `mode: ModeName` | no |
| `TIER_CRITERIA` (`src/jev/rubrics.ts`) | new (replaces `STANDARD_TIER_CRITERIA`) | `Record<ModeName, Record<TierName, string>>` | no |
| `EXPERT_NEEDED_QUESTIONS` (`src/jev/rubrics.ts`) | new (replaces `EXPERT_NEEDED_QUESTION`) | `Record<ModeName, WireQuestion>`; `budget` and `standard` are the same object | no |
| `buildWorkerQuestions(offered, displayNames, mode: ModeName)` | modified | adds `mode` | no |
| `JevArgs` (`src/host/commands.ts`) | modified | adds `{ kind: "mode"; mode: Mode }` | no |
| `RouteReason` (`src/policy/route.ts`) | modified (derived) | follows `TierDecision`: `fable` becomes `expert-admitted` | no |
| `LaunchEntry.mode` (`src/host/worker.ts`) | modified | narrowed from optional `string` to required `Mode`, set in the `LaunchEntry` literal in `classify` before the untouched early return | no |
| `fixtureModelsJson` (`tests/host/fixture.ts`) | modified | `fixture` provider gains model `fixture-expert` (reasoning) | no |

---

## Task 1: Expert gate — implements 1.1

**Files:**
- Create: `src/policy/modes.ts`
- Test: `tests/policy/modes.test.ts`

**Interfaces:** Produces `MODE_NAMES`, `ModeName`, `expertAdmitted` (see Contracts). Consumes `Answer` from `src/policy/answers.ts`.

- [ ] **Step 1: Write failing tests** in `tests/policy/modes.test.ts`, one `test` per scenario of worker-modes "Mode names" and "Expert gate per mode", named as the scenarios. Answers are built as plain `Record<string, Answer>` (`tier`: `{type:"choice", choice, probabilities}`; `effort`: `{type:"choice", choice, probabilities:{}}`; `expert_needed`: `{type:"noul", noul}`). Key assertions:
  - "Policy and store agree": `expect([...MODE_NAMES]).toEqual([...MODES])` (import `MODES` from `src/store/defaults.ts`; tests may cross layers).
  - "Standard gate boundary": `expert_needed` 0.9 → `false`.
  - "Premium probability boundary": `P(expert)` 0.099 → `false`; "Premium gate from a deep choice": exactly 0.1, `expert_needed` absent → `true`.
  - "Expert probability missing": `probabilities` `{deep: 0.9}` → `false`.
  - "Wrong answer type" (Review Focus of the gate): `effort` given as `{type:"noul", noul:1}` in `premium` → `false`; `tier` given as `noul` in `standard` → `false`.
- [ ] **Step 2: Run** `bun test tests/policy/modes.test.ts`. Expect FAIL (module missing).
- [ ] **Step 3: Implement** `src/policy/modes.ts`. `budget` and `standard` share one function; `premium` checks `tier.choice ∈ {deep, expert}`, `(probabilities.expert ?? 0) >= 0.1`, `effort.choice ∈ {xhigh, max}`. Narrow `tier` and `effort` with `type === "choice"` and `expert_needed` with `type === "noul"` before reading them; any other shape counts as unanswered.
- [ ] **Step 4: Run** the test, then `bun run lint`. Expect PASS, no boundary error.
- [ ] **Step 5: Commit** `feat(policy): expert gate per mode`.

## Task 2: Decision, route and ledger reason — implements 1.2, 3.1

**Files:**
- Modify: `src/policy/tier.ts`, `src/policy/route.ts`, `src/store/ledger-schema.ts`, `src/host/worker.ts` (call site only)
- Test: `tests/policy/tier.test.ts`, `tests/policy/route.test.ts`, `tests/store/ledger-schema.test.ts`, `tests/store/ledger.test.ts`

The ledger rename is in this task because `tests/policy/route.test.ts` "Recorded results validate" checks every route reason with `validateLedgerEntry`; renaming one without the other breaks the build.

**Interfaces:** Consumes `ModeName`, `expertAdmitted` (Task 1). Produces the modified `TierDecision`, `decideTier`, `RouteInput` (see Contracts).

- [ ] **Step 1: Update tests first.**
  - `tests/policy/tier.test.ts`: the `answers` helper gains `effort?: string`; every `decideTier` call gains a mode (`"standard"` for existing cases). Rename `describe("Fable rule")` to `describe("Expert admitted rule")` and its tests to the delta's names ("Expert admitted in standard", "Standard boundary", "Expert stands on high risk"), expecting reason `expert-admitted`.
  - Add the delta's new scenarios: "Same answers, different modes", "Premium admits from deep on high risk", "Premium gate passes but expert not offered" (offered `["fast","balanced","deep"]`, answers built directly), "Premium denies expert on low effort", "Effort unanswered in premium".
  - Add "Table per mode": a `const ROWS` array with the nine rows of the delta table, each `{answers, standard: [tier, reason], premium: [tier, reason]}`; loop over `["budget","standard","premium"]` with `test.each` or a loop of `test`s, `budget` expecting the `standard` column.
  - `tests/policy/route.test.ts`: `input()` defaults `mode: "standard"`; the "Recorded results validate" map key `fable` becomes `"expert-admitted"`.
  - `tests/store/ledger-schema.test.ts`: "Expert admitted accepted" (worker line, `reason` `expert-admitted`, `tier` `expert`, valid); "Old reason name rejected" (`reason` `fable` → issue at `reason`). `tests/store/ledger.test.ts`: a file with one `fable` line and one valid line reads one entry with `skipped` 1.
- [ ] **Step 2: Run** `bun test tests/policy tests/store`. Expect FAIL (types and reason).
- [ ] **Step 3: Implement.** `decideTier(answers, offered, mode)`: rule 1 is `offered.includes("expert") && expertAdmitted(mode, answers.answers)` → `decide("expert", "expert-admitted")`. Rules 2–5 unchanged. `routeLaunch` passes `input.mode`. In `src/store/ledger-schema.ts`, replace `"fable"` with `"expert-admitted"` in `WorkerReason` and `DECIDING_REASONS`. Keep the build green: in `src/host/worker.ts` `route()`, pass `mode: snap.settings.mode` to `routeLaunch` for now (Task 4 moves it to the entry).
- [ ] **Step 4: Run** `bun test tests/policy tests/store` and `bun run typecheck`. Expect PASS.
- [ ] **Step 5: Commit** `feat(policy): mode-selected expert gate; ledger reason expert-admitted`.

## Task 3: Rubrics and questions per mode — implements 2.1

**Files:**
- Modify: `src/jev/rubrics.ts`, `src/jev/questions.ts`, `src/host/worker.ts` (call site only)
- Test: `tests/jev/questions.test.ts`

**Interfaces:** Consumes `ModeName` (Task 1). Produces `TIER_CRITERIA`, `EXPERT_NEEDED_QUESTIONS`, modified `buildWorkerQuestions` (see Contracts).

- [ ] **Step 1: Write failing tests** in `tests/jev/questions.test.ts`:
  - Existing tests pass `"standard"` to `buildWorkerQuestions` and read `TIER_CRITERIA.standard`, `EXPERT_NEEDED_QUESTIONS.standard`.
  - "Wording matches the docs": loop over `MODE_NAMES`; every instruction and criterion of a four-tier request is contained in `docs/jev-questions.md`.
  - "Standard request unchanged": `fast` criterion starts with `Fast and low cost, for bounded work with nothing to decide`.
  - "Budget expert criterion": `TIER_CRITERIA.budget.expert === TIER_CRITERIA.standard.expert`.
  - "Premium wording": `deep` starts with `The default for real engineering`, `expert_needed.instructions` starts with `This task needs the strongest available reasoning`.
  - "Expert still asked in premium": keys are `tier`, `effort`, `risky`, `expert_needed`.
  - "Only the tier criteria and expert wording differ" (worker-modes): `budget` vs `premium` requests have equal `tier.instructions`, `effort`, `risky`, and equal `specs`.
  - "Main request ignores the mode": `mainQuestions({askEffort:true})` deep-equals an explicit object built from `MAIN_EFFORT_INSTRUCTION`, `WORKER_EFFORT_QUESTION.criteria`, `RISKY_QUESTION`, `CORRECTS_QUESTION`, and has no `tier` key. Its parameter type stays `{ askEffort: boolean }` (no mode).
- [ ] **Step 2: Run** `bun test tests/jev/questions.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** Copy the `budget` and `premium` tier tables and the `premium` `expert_needed` instruction and criteria verbatim from `docs/jev-questions.md` into `rubrics.ts`. `buildWorkerQuestions` picks `TIER_CRITERIA[mode]` and copies `EXPERT_NEEDED_QUESTIONS[mode]`. Update every importer of the removed `STANDARD_TIER_CRITERIA` and `EXPERT_NEEDED_QUESTION` (`grep -rn` in `src` and `tests`). Keep the build green: in `classify` in `src/host/worker.ts`, pass `settings.mode` to `buildWorkerQuestions` for now.
- [ ] **Step 4: Run** `bun test tests/jev`, `bun run typecheck` and `bun run lint`. Expect PASS.
- [ ] **Step 5: Commit** `feat(jev): tier rubric and expert_needed wording per mode`.

## Task 4: Host captures the mode per launch — implements 4.1, 4.3

**Files:**
- Modify: `src/host/worker.ts`
- Test: `tests/host/worker.test.ts`, `tests/host/worker-ledger.test.ts`, `tests/host/worker-fakes.ts`, `tests/host/worker-routing.test.ts`

**Interfaces:** Consumes `buildWorkerQuestions(…, mode)` (Task 3), `RouteInput.mode` (Task 2).

Test helper changes (the current ones cannot express these scenarios):
- `tests/host/worker-fakes.ts`: `snap()` gains `mode?: Mode`, passed as `state.mode`; add `TIERS_X = { ...TIERS, expert: "fx/expert" }` (and a registry model for it in the fake context); add `choiceWith(pick: string, probabilities: Record<string, number>)` and `bodyWith(tier, probabilities, eff)` that emit a `tier` answer whose probability keys are exactly the offered tiers.
- `tests/host/worker-routing.test.ts`: `jevAnswers` gains `probs?: Record<string, number>` used for `tier` instead of `choice()`'s 0.9 / rest split (which gives `P(expert)` ≈ .033, below the bar); `config()` gains `extra.expert` setting `tiers.expert = "fixture/fixture-expert"`, and the premium tests also set `extra.deep`.

- [ ] **Step 1: Write failing unit tests** (fake Jev, as the existing `worker.test.ts`):
  - "Premium criteria sent": with `snap({mode:"premium"})`, the recorded request's `tier.criteria.deep` starts with `The default for real engineering`.
  - "Mode changed between message end and launch": tiers `TIERS_X`; classify at `message_end` with `standard`, then the `tool_call` handler gets a snapshot with `premium`; Jev answered `bodyWith("deep", {fast:.05, balanced:.15, deep:.5, expert:.3}, "xhigh")`; expect `input.model` is `fx/deep` and the ledger line has `mode` `standard`, `reason` `choice`. The same answers with `premium` at classification give `fx/expert` (control).
  - "Premium with expert switched off": tiers `TIERS_X`, `snap({mode:"premium", switches:{expert:false}})`; the request has no `expert_needed` and its `tier` options are `fast`, `balanced`, `deep`; a `deep` + `xhigh` answer (three-key probabilities) stays `fx/deep`.
  - `worker-ledger.test.ts` "Mode recorded": classified in `budget` → line `mode` `budget`.
- [ ] **Step 2: Write the failing host test** in `tests/host/worker-routing.test.ts` with the loopback fixture and real executor: "Premium launch end to end" (state `{"version":1,"mode":"premium"}`, Jev replies `tier` `deep` with `expert` .3 and `effort` `xhigh`; child runs on the `expert` fixture model; ledger `mode` `premium`, `reason` `expert-admitted`) and "Jev down in premium" (HTTP 500; caller input unchanged; ledger `reason` `miss`, `mode` `premium`). The fixture has no expert model today (`tests/host/fixture.ts:150-165` lists `fixture-main`, `fixture-balanced`, `fixture-fast` and keyless `fixture2/fixture-deep`): add `{ id: "fixture-expert", reasoning: true }` to the `fixture` provider, and in `worker-routing.test.ts` set `tiers.expert = "fixture/fixture-expert"` only for the premium tests, so existing tests see no new tier.
- [ ] **Step 3: Run** `bun test tests/host/worker.test.ts tests/host/worker-ledger.test.ts tests/host/worker-routing.test.ts`. Expect FAIL.
- [ ] **Step 4: Implement.** In `classify`, put `mode: settings.mode` in the `LaunchEntry` literal (before the untouched early return) and pass `entry.mode` to `buildWorkerQuestions`. In `route`, remove `entry.mode = snap.settings.mode` and pass `mode: entry.mode` to `routeLaunch`. Make `LaunchEntry.mode` required.
- [ ] **Step 5: Run** the tests, `bun run typecheck`, `bun run lint`. Expect PASS.
- [ ] **Step 6: Commit** `feat(host): one mode per worker launch`.

## Task 5: `/jev mode` — implements 4.2

**Files:**
- Modify: `src/host/commands.ts`
- Test: `tests/host/commands.test.ts`, `tests/host/jev-base.test.ts`

**Interfaces:** Produces `JevArgs` `{ kind: "mode"; mode: Mode }`; consumes `MODES`, `Mode` from `src/store/defaults.ts`, `updateState`.

- [ ] **Step 1: Write failing tests**, named as the jev-command scenarios:
  - Parser: `parseJevArgs("mode premium")` → `{kind:"mode", mode:"premium"}`; remove `"mode premium"` from the usage list; add `"mode"`, `"mode quality"`, `"mode Premium"`, `"mode premium now"` to it.
  - "Set premium": `state.json` holds `mode` `premium`, report contains `mode: premium`, widget text `Jev · premium`; other fields unchanged (seed `switches.skills:false` first).
  - "Mode survives a restart": after `/jev mode budget`, a fresh `load(dir)` snapshot has `settings.mode === "budget"`.
  - "Back to standard", "Refused mode change" (`chmod 0o000`, skip as root, `EACCES`).
  - `mode premium` is today's "unsupported command" fixture in four places; change each to `tune`: `tests/host/commands.test.ts:71` (the bad list), `:308-313` ("later-group command gets usage as warning", which becomes "Command from a later work group"), `:360` (the call after the throwing `load`), and `tests/host/jev-base.test.ts:144` ("unknown mode notifies a warning" → "unknown command notifies a warning").
  - "Usage lists the mode form": `usageText()` contains `/jev mode budget|standard|premium`.
- [ ] **Step 2: Run** `bun test tests/host/commands.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.** Parser: the `mode` branch goes after the `words.length === 1` check and before the `on`/`off` check: `head === "mode" && rest.length === 0 && MODES.includes(value as Mode)`, else usage. Runner: extract the existing nested ternary into `applyChange(parsed, dir)` returning the store result, with one `switch` arm per kind; the `mode` arm is `updateState(dir, (st) => ({ ...st, mode: parsed.mode }))`. Usage line `"  /jev mode budget|standard|premium  choose the worker mode"`, inserted before `/jev reset`.
- [ ] **Step 4: Run** the test, `bun run typecheck`. Expect PASS.
- [ ] **Step 5: Commit** `feat(host): /jev mode command`.

## Task 6: Docs and full check — implements 5.1, 5.2

**Files:** the docs listed in tasks 5.1.

- [ ] **Step 1:** Replace "Fable rule(s)" with "expert gate(s)" and ledger `fable` with `expert-admitted` in the listed docs. Decisions per hit:
  - Rename: `docs/domain-model.md:22` (`fableRule` → `expertGate`), `:130`, `:143-150`; `docs/jev-questions.md:71`; `docs/architecture.md:57`; `docs/configuration.md:87,151`; `docs/roadmap.md:174,235`; `docs/decisions/0003-rubric-per-mode.md:13,15`; `docs/glossary.md` entry "Fable rule" → "Expert gate"; `docs/jev-contract.md:208,253`; `docs/usage-guide.md:234` ("Fable never runs" → "Expert never runs").
  - Keep (model names as measured data or examples): `docs/domain-model.md:97` (typical model column), `docs/usage-guide.md:102` (distribution column), `docs/decisions/0003-rubric-per-mode.md:9` ("scouting on Fable" measurement), all of `docs/evidence/`, `claude-fable-5-1` config examples. In `docs/domain-model.md` § Fable rules, rename the heading to "Expert gates" and update anchors that link to it (`grep -rn "fable-rules" docs`). In `docs/usage-guide.md`, remove `mode` (WG-12) from the "until its work group adds it" sentence and the "WG-12" marker in the command list. In `docs/workflow.md` §4, "rubric and expert gate". In `docs/roadmap.md` WG-12 row keep `Planned` until Task 7.
- [ ] **Step 2: Verify** `grep -rni fable docs src tests` shows only the kept hits above. (`openspec/specs/` still says `fable` until the archive sync applies the deltas; that is expected.)
- [ ] **Step 3: Run** `bun run typecheck && bun run lint && bun run fmt:check && bun test`. Expect all PASS.
- [ ] **Step 4: Commit** `docs: expert gate and modes`.

## Task 7: Replay (manual, operator) — implements 6.1

- [ ] **Step 1:** Send the operator, through the Inbox, a request to approve a replay: data (real worker briefs, kept outside the repository), modes (`budget`, `standard`, `premium`, plus a plain `standard` rerun), estimated request count and cost. Do not run it without approval.
- [ ] **Step 2:** After the operator runs it, record only aggregates in a new dated file under `docs/evidence/`, compared with `docs/evidence/2026-11-05-replay.md#routing-by-mode`.
- [ ] **Step 3:** If within noise, mark WG-12 `Done` in `docs/roadmap.md`; otherwise leave `Planned` and open a follow-up for rubric wording. Commit `docs(evidence): WG-12 replay`.

---

## Scenario → test

**worker-modes**
- Policy and store agree, Standard gate passes, Standard gate boundary, Budget uses the standard gate, Standard gate ignores effort, Premium gate from a deep choice, Premium gate from an expert choice, Premium probability boundary, Premium needs high effort, Premium needs a deep or expert choice, Premium effort unanswered, Expert probability missing → `tests/policy/modes.test.ts` (Task 1)
- Only the tier criteria and expert wording differ, Main request ignores the mode → `tests/jev/questions.test.ts` (Task 3)

**worker-decision**
- Ordinary choice, Same answers, different modes, Table per mode → `tests/policy/tier.test.ts` (Task 2)
- Expert denied without deep → `tests/policy/tier.test.ts` (existing, mode added, Task 2)
- Risk floor without a tier answer, Expert needed unanswered, Effort unanswered in premium, No tier answer, No tier offered, Every answer unanswered → `tests/policy/tier.test.ts` (Task 2)
- Expert admitted in standard, Standard boundary, Expert stands on high risk, Premium admits from deep on high risk, Premium gate passes but expert not offered, Premium denies expert on low effort → `tests/policy/tier.test.ts` (Task 2)

**worker-request**
- No tier configured, Expert offered, Expert still asked in premium, Asked and accepted agree → `tests/jev/questions.test.ts` (Task 3)
- Wording matches the docs, Standard request unchanged, Budget expert criterion, Premium wording, Display name prefix, Missing display name → `tests/jev/questions.test.ts` (Task 3)

**decision-ledger**
- Valid main line accepted, Valid worker line accepted, Valid correction line accepted, Unknown kind rejected, Field from another kind rejected, Missing required field rejected, Exported field sets match the table, Unknown agent value is still an identifier → existing tests in `tests/store/ledger-schema.test.ts` (unchanged)
- Deciding worker without a tier rejected, Untouched worker without a tier accepted → existing tests in `tests/store/ledger-schema.test.ts` (unchanged)
- Expert admitted accepted, Old reason name rejected → `tests/store/ledger-schema.test.ts` and `tests/store/ledger.test.ts` (Task 2)

**worker-ledger**
- Routed fields, Fallback recorded, Nothing could run recorded, Thinking-only recorded, Miss recorded, Untouched recorded, Locked recorded, Not locked, No prompt text → existing tests in `tests/host/worker-ledger.test.ts` (unchanged)
- Mode recorded → `tests/host/worker-ledger.test.ts` (Task 4)

**worker-routing**
- Premium launch end to end, Jev down in premium → `tests/host/worker-routing.test.ts` (Task 4)
- Mode changed between message end and launch → `tests/host/worker.test.ts` (Task 4)

**jev-command**
- Set premium, Mode survives a restart, Back to standard, Refused mode change → `tests/host/commands.test.ts` (Task 5)
- Command from a later work group, Unknown mode, Usage lists the mode form → `tests/host/commands.test.ts` (Task 5)
- Unknown feature, Bad value, Extra words, Extra words after cli-review, Whitespace only → existing tests in `tests/host/commands.test.ts` (unchanged)

# WG-10 Strategy Advice Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Ask Jev `tier` and `strategy` on eligible main prompts and attach a hidden `<execution_strategy>` advice when its probability gate passes, with ledger fields and a status suffix.

**Architecture:** The gates and block text live in a pure `src/policy/strategy.ts`, and the question wording lives in `src/jev/rubrics.ts`. `src/host/main.ts` reads the answers once, computes the advice before the effort rules, returns it as a hidden `before_agent_start` message, and records it on the turn. `src/host/status.ts` renders the effort and advice suffixes from one split `Decision`.

**Tech Stack:** TypeScript, Bun (`bun test`), Pi `@earendil-works/pi-coding-agent` extension API, local Jev and provider fixtures.

## Global Constraints

- Thresholds: `delegate` and `parallel` ≥ 0.6, `graph` ≥ 0.8. Inclusive (`>=`). Probability of the chosen option only. `confidence` is never read.
- `parallel` needs `tier` answered and ≠ `fast`. `graph` needs `tier` answered and = `deep`. `direct` never attaches.
- Question and block text are copied verbatim from `docs/jev-questions.md`. No `junior`, no skill names, no confidence in the block.
- Main `tier` options are exactly `fast`, `balanced`, `deep`, with `STANDARD_TIER_CRITERIA` text and no prefix.
- Main question order: `effort`, `risky`, `tier`, `strategy`, `corrects`.
- The hidden message is `{ customType: "jev-advice", content: <block>, display: false }`.
- Ledger: only `strategy`, `strategyP` and `advised`, present exactly when `strategy` was answered. No schema change.
- `policy/` imports nothing from Pi or `host/`, which `tests/boundaries.test.ts` enforces. Tests need no secrets and no network beyond loopback.

## Review Focus

1. **Effort unanswered while `strategy` passes.** Advice is still attached. The existing early return `if (effort?.type !== "choice")` must not drop it. Test in Task 4.
2. **Operator moves the level during the wait.** Advice is still attached, and the status keeps the old level with the new advice. Test in Task 4.
3. **Esc after Jev answered but before any provider request.** The status goes back to the previous `Decision`, including the old advice part. No ledger line is written. Test in Task 4.
4. **`/jev strategy off` after advice.** The suffix is hidden, and it comes back on `/jev strategy on`. Test in Task 3.
5. **Probability exactly at 0.6 or 0.8 as a float from JSON.** It must pass, so compare with `>=` and not `>`. Test in Task 1.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `Strategy`, `STRATEGIES` (src/policy/strategy.ts) | new | `"direct" \| "delegate" \| "parallel" \| "graph"`; `STRATEGIES: readonly Strategy[]` in that order. Declared in policy: `.oxlintrc.json` forbids `src/policy` importing `../store`. Structurally equal to the ledger's `Strategy` (`src/store/ledger-schema.ts:19`); a type-level test asserts both unions are equal | no |
| `strategyBlock(s: Exclude<Strategy, "direct">): string` | new | The `<execution_strategy>` block | no |
| `STRATEGY_THRESHOLD`, `GRAPH_THRESHOLD` | new | `0.6`, `0.8` (`number` constants) | no |
| `AdviceInput` | new | `{ strategy?: { choice: string; probabilities: Record<string, number> }; tier?: string }` | no |
| `Advice` | new | `{ strategy: Strategy; strategyP: number; advised: boolean; block?: string } \| undefined`. `undefined` means `strategy` is unanswered. `block` is set exactly when `advised` | no |
| `adviseStrategy(input: AdviceInput): Advice` | new | Pure | no |
| `STRATEGY_QUESTION`, `MAIN_TIER_QUESTION` (src/jev/rubrics.ts) | new | `WireQuestion` | no |
| `mainQuestions(o: { askEffort: boolean; askStrategy: boolean }): MainQuestions` | modified | It was `{ askEffort }`. Order as in Global Constraints | no |
| `Decision` (src/host/status.ts) | modified | `{ effort?: { kind: "level"; level: ThinkingLevel } \| { kind: "no-answer" }; advice?: Strategy }` | no |
| `statusText(s: Snapshot, decision?: Decision): string` | modified | Effort suffix when `switches.effort` and `decision.effort`; advice suffix when `switches.strategy` and `decision.advice` | no |
| `withDecision(prev: Decision \| undefined, effort: Decision["effort"] \| undefined, advice: Strategy \| undefined): Decision` (src/host/status.ts) | new | Builds a `Decision` with conditional spreads (`exactOptionalPropertyTypes`): keys whose value is `undefined` are omitted | no |
| `createMain(...).decision(): Decision \| undefined`; `commands.ts` `deps.decision` | modified | Type follows the new `Decision`; no logic change in `commands.ts` | no |
| `TurnRecord` (src/host/main.ts) | modified | Adds `strategy?: Strategy; strategyP?: number; advised?: boolean` | no |
| `createMain(...).beforeAgentStart` | modified | Returns `Promise<BeforeAgentStartEventResult \| undefined>`, with `{ message }` when advised. `src/host/setup.ts` already returns its value unchanged, so no change is needed there | no |
| Hidden advice message | new | `customType: "jev-advice"`, `display: false`, `content`: block string | no (model context only) |
| `main` ledger line | modified | Adds the existing optional fields `strategy`, `strategyP` and `advised` | no (schema unchanged) |

---

## Task 1: Strategy policy — implements 1.1, 1.2

**Files:**
- Create: `src/policy/strategy.ts`
- Test: `tests/policy/strategy.test.ts`

**Interfaces:**
- Produces: `Strategy`, `STRATEGIES`, `STRATEGY_THRESHOLD`, `GRAPH_THRESHOLD`, `AdviceInput`, `Advice`, `adviseStrategy`, `strategyBlock` (see Contracts). Imports nothing outside `src/policy/` and `src/shared/`.

- [ ] **Step 1: Write the failing tests.** Use a helper `ans(choice, p)` that builds probabilities with `p` on `choice` and the rest spread over the others. Table-driven `test.each`:
  - `delegate` at 0.6 gives `advised` true; at 0.59, false.
  - `parallel` at 0.6 with `tier` `balanced`: true. At 0.59 with `deep`: false. At 0.9 with `fast`: false. At 0.95 with no tier: false.
  - `graph` at 0.8 with `deep`: true. At 0.79 with `deep`: false. At 0.95 with `balanced`: false. At 0.95 with no tier: false.
  - `delegate` at 0.7 with no tier: true.
  - `direct` at 1.0: `advised` false, `block` undefined.
  - Unknown choice `"junior"`, or no `strategy`: returns `undefined`.
  - A `confidence: 0.1` property on the answer is ignored.
  - `strategyP` equals `probabilities[choice]`.
  - For each of `delegate`, `parallel`, `graph`:
    - The block starts with `<execution_strategy>\nA fast decision model read this request as best carried out as: <s>.`.
    - It ends with `If the actual work does not fit, ignore this and work directly.\n</execution_strategy>`.
    - Each `<how>` text is contained verbatim in `docs/jev-questions.md` (read with `readFileSync`, as in `tests/jev/questions.test.ts`).
    - No block contains `junior`.
  - Type-level: `const _eq: [PolicyStrategy] extends [LedgerStrategy] ? ([LedgerStrategy] extends [PolicyStrategy] ? true : never) : never = true;` (the test file may import both; tests are outside the boundary rule).
- [ ] **Step 2:** Run `bun test tests/policy/strategy.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `src/policy/strategy.ts`.**
  - Copy the three `<how>` texts verbatim from `docs/jev-questions.md` § Strategy advice.
  - The `graph` text keeps its three line breaks.
  - The block is the five parts joined with `\n`, as in the docs template.
  - An unknown choice yields `undefined`.
- [ ] **Step 4:** Run `bun test tests/policy/strategy.test.ts tests/boundaries.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src/policy/strategy.ts tests/policy/strategy.test.ts && git commit -m "feat(strategy): add strategy advice gates and block text"`.

---

## Task 2: Main questions — implements 2.1, 2.2, 2.3

**Files:**
- Modify: `src/jev/rubrics.ts`, `src/jev/questions.ts`, `src/host/main.ts:124` (call site only: `mainQuestions({ askEffort, askStrategy: false })` until Task 4)
- Test: `tests/jev/questions.test.ts`, `tests/host/main.test.ts:203` (update to the new signature)

**Interfaces:**
- Consumes: `STRATEGIES` from Task 1, for the option order.
- Produces: `STRATEGY_QUESTION`, `MAIN_TIER_QUESTION`, `mainQuestions({ askEffort, askStrategy })`.

- [ ] **Step 1: Write the failing tests** in `tests/jev/questions.test.ts`:
  - The key sets for `(askEffort, askStrategy)`:
    - `(true, true)` → `["effort","risky","tier","strategy","corrects"]`
    - `(false, true)` → `["tier","strategy","corrects"]`
    - `(true, false)` → `["effort","risky","corrects"]`
    - `(false, false)` → `["corrects"]`
  - `specs.tier` is `{ type: "choice", options: ["fast","balanced","deep"] }`, and `specs.strategy` has options `["direct","delegate","parallel","graph"]`.
  - `wire.tier.instructions === TIER_INSTRUCTION`, and `wire.tier.criteria.fast === STANDARD_TIER_CRITERIA.fast` (no prefix), with no `expert` key.
  - The existing verbatim-docs test runs with `{ askEffort: true, askStrategy: true }`, which covers the `strategy` instruction and criteria.
  - The fresh-copy test also mutates `tier` and `strategy`.
  - Update the existing `mainQuestions({ askEffort: … })` calls to pass `askStrategy`.
- [ ] **Step 2:** Run `bun test tests/jev/questions.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `STRATEGY_QUESTION` is a choice. Its instruction and four criteria are copied verbatim from `docs/jev-questions.md` § `strategy`.
  - `MAIN_TIER_QUESTION` is a choice with `TIER_INSTRUCTION` and the `fast`, `balanced` and `deep` entries of `STANDARD_TIER_CRITERIA`.
  - `mainQuestions` adds both questions through `copy()` when `askStrategy` is set, in the order from Global Constraints.
  - Update the call site in `main.ts` and the `main.test.ts:203` expectation to `{ askEffort: true, askStrategy: false }`.
- [ ] **Step 4:** Run `bun test tests/jev tests/host/main.test.ts && bun run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(jev): add main tier and strategy questions`.

---

## Task 3: Status line — implements 3.1, 3.2

**Files:**
- Modify: `src/host/status.ts`, `src/host/main.ts` (the `setDecision` call sites build `{ effort: … }` with the same values as now; advice comes in Task 4), `src/host/commands.ts` (type only)
- Test: `tests/host/status.test.ts`, `tests/host/commands.test.ts`, `tests/host/main.test.ts` (update the `decision()` expectations to the new shape)

**Interfaces:**
- Consumes: `Strategy` from Task 1.
- Produces: the new `Decision`, `withDecision` and `statusText` from Contracts.

- [ ] **Step 1: Write the failing tests** in `tests/host/status.test.ts`:
  - `{ effort: high, advice: "delegate" }` → `Jev · standard · high · delegate`.
  - With `effort` off and `{ advice: "parallel" }` → `Jev · standard · parallel`.
  - With `strategy` off and `{ effort: high, advice: "delegate" }` → `Jev · standard · high`. The same `Decision` with both switches on renders the advice again, which covers "Strategy switched back on".
  - `{ effort: no-answer }` → `Jev · standard · no answer`.
  - With all decision features off → `Jev · off`.
  - With an invalid config → `Jev · config error`.
  - Convert the existing `high` fixtures to `{ effort: { kind: "level", level: "high" } }`.
- [ ] **Step 2:** Run `bun test tests/host/status.test.ts`. Expected: FAIL.
  - `withDecision(undefined, high, undefined)` deep-equals `{ effort: high }`, with no `advice` key.
- [ ] **Step 3:** Implement the `Decision` shape, `withDecision` and the `statusText` order: base, then the effort part, then the advice part. Adapt the four `setDecision(... { kind: ... })` calls in `main.ts` to `withDecision(current, <effort>, current?.advice)`, so behaviour is unchanged. Update the `decision()` expectations in `tests/host/main.test.ts` (lines 173, 282, 354, 369 and 372) and the `Decision` fixtures in `tests/host/commands.test.ts` and `tests/host/status.test.ts:130`.
- [ ] **Step 4:** Run `bun test tests/host && bun run typecheck`. Expected: PASS. The existing main and status scenarios are unchanged.
- [ ] **Step 5:** Commit: `feat(status-line): split decision into effort and advice parts`.

---

## Task 4: Main decision wiring — implements 4.1, 4.2, 4.4

**Files:**
- Modify: `src/host/main.ts`
- Test: `tests/host/main.test.ts`. Known breakages once `strategy` (default on) is wired:
  - `main.test.ts:152`: the `effort off` untouched case.
  - `main.test.ts:193`: non-reasoning expects `["corrects"]`. Pass `state: { switches: { strategy: false } }` there and add a separate "non-reasoning with strategy" test that expects `["tier","strategy","corrects"]`.
  - `main.test.ts:203`: change the expected value to `mainQuestions({ askEffort: true, askStrategy: true }).wire`.
  - `tests/host/main-effort.test.ts` needs no change: its fixture leaves `strategy` unanswered, which fails open. Confirm by running it.

**Interfaces:**
- Consumes: `adviseStrategy` and `Advice` (Task 1); `mainQuestions({ askEffort, askStrategy })` (Task 2); `Decision` (Task 3).
- Produces: the `beforeAgentStart` return value and the `TurnRecord` fields from Contracts.

- [ ] **Step 1: Write the failing tests** in `tests/host/main.test.ts`.
  - **Setup.** Extend `answer()` with optional `strategy` (choice, p) and `tier` choice.
  - **Eligibility:**
    - Replace `untouched("effort off")` with `untouched("effort and strategy off", { state: { switches: { effort: false, strategy: false } } })`.
    - Add: with `effort` off and `strategy` on, one request with keys `["tier","strategy","corrects"]` and `t.sets` empty.
  - **Return value:**
    - `delegate` 0.9 → `{ message: { customType: "jev-advice", display: false, content: strategyBlock("delegate") } }`.
    - `direct` → `undefined`.
    - Miss → `undefined`.
    - `strategy` off → `undefined`, and the request has no `strategy` key.
  - **Advice independent of effort:** `delegate` is still returned when:
    - The level is moved during a held answer (status `Jev · standard · high · delegate` when the previous decision was `high`).
    - The start level is `max`.
    - `effort` has an unknown choice.
    - `effort` is off.
  - **Cancelled:** the client returns `cancelled` → `undefined`, no widget change.
  - **Esc after an answer with no provider request:** `agentSettled({ aborted: true })` restores the previous `Decision`, including its old advice.
  - **Ledger after `agentSettled`:**
    - Advised turn: `strategy: "delegate", strategyP: 0.9, advised: true`.
    - `graph` 0.7 with `deep`: `advised: false`.
    - `strategy` off, a miss, or an unknown strategy: none of the three keys.
    - Every line passes `validateLedgerEntry`.
  - **Status:** advice cleared by a next turn that asked `strategy` and got `direct`. A miss clears it and shows `no answer`. A turn with `strategy` off leaves it. After `sessionStart()`, `decision()` is `undefined` even after an advised turn.
- [ ] **Step 2:** Run `bun test tests/host/main.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement in `decide()`.**
  - The early return becomes `!(switches.effort || switches.strategy)`.
  - Set `askEffort = switches.effort && canAskEffort(supported)` and `askStrategy = switches.strategy`.
  - After `rec.answered = true` and `corrects` and `risky` are recorded, and **before** the effort block:
    - Call `advice = askStrategy ? adviseStrategy({ strategy, tier }) : undefined`.
    - Copy it into `rec`.
    - Compute `nextAdvice = askStrategy ? (advice?.advised ? advice.strategy : undefined) : current?.advice`.
  - Keep the effort block's control flow. Every `setDecision` call passes `withDecision(current, <effort for that branch>, nextAdvice)`, reading `current` at call time.
  - When the effort block returns without drawing (a discard, or `effort` not asked or not answered while not asked), call `setDecision(rec, ctx, snapshot, withDecision(current, current?.effort, nextAdvice))` once if `nextAdvice !== current?.advice`. It must go through `setDecision` so that `undo.drew` is set for an Esc restore.
  - A miss sets `{ effort: no-answer, advice: undefined }`. That keeps the existing rule: a miss shows `no answer` whatever was asked, even when `effort` was not asked.
  - `decide()` returns the message when `advice?.advised`. `beforeAgentStart` returns it.
  - `write()` adds the three fields when `rec.strategy !== undefined`.
- [ ] **Step 4:** Run `bun test tests/host && bun test && bun run typecheck`. Expected: PASS after updating the breakages listed under Files (task 4.4).
- [ ] **Step 5:** Commit: `feat(main): attach strategy advice and record it`.

---

## Task 5: Host test through the real CLI — implements 4.3

**Files:**
- Create: `tests/host/strategy-advice.test.ts`. Reuse the patterns of `tests/host/main-effort.test.ts`: `startFixture`, `startJevFixture`, `startHostSession`, `widgetLines`, `mainLines`.

**Interfaces:**
- Consumes: the behavior of Task 4 only.

- [ ] **Step 1: Write the tests.** The Jev fixture answers `effort` `high`, `risky` 0.1, `corrects` 0.05, `tier` `balanced` and `strategy` as specified per test.
  - **`delegate` 0.9:**
    - `JSON.stringify(fixture.requests[0].body)` contains `best carried out as: delegate.`.
    - The RPC events hold `setWidget` with `["Jev · standard · high · delegate"]`.
    - The main line has `advised: true`.
  - **`direct` 1.0:** the first provider body does not contain `<execution_strategy>`.
  - **Jev 500:** with `self: true` and `self: false`, the provider bodies are equal after `withoutReview`, mirroring "jev down 500 changes nothing" in `main-effort.test.ts`.
  - **Effort off, strategy on:**
    - Send `/jev effort off` as a prompt first (the RPC prompt runs the command).
    - Then `delegate` 0.9 gives exactly one Jev request.
    - The provider request `reasoningEffort` equals the session start level.
    - The main line has no `requested`.
- [ ] **Step 2:** Run `bun test tests/host/strategy-advice.test.ts`. Expected: PASS. Behavior already exists from Task 4. To show the tests can fail, temporarily make `beforeAgentStart` return `undefined`, confirm the `delegate` test fails, then revert. If a test fails for real, fix the code and not the expectation.
- [ ] **Step 3:** Commit: `test(host): strategy advice through the real CLI`.

---

## Task 6: Docs and full check — implements 5.1, 5.2

**Files:**
- Modify: `docs/jev-questions.md` (§ Tier rubrics / `standard`), `docs/jev-contract.md` (§ Eligibility, § Main questions, strategy gates + precedence line), `docs/domain-model.md` (§ MainDecision Advice row), `docs/usage-guide.md` (status line section)

- [ ] **Step 1: Edit the docs.**
  - **`docs/jev-questions.md`:** under `standard`, add: the main request's `tier` uses these criteria for `fast`, `balanced` and `deep`, without the display-name prefix.
  - **`docs/jev-contract.md`:**
    - Eligibility: "When every applicable feature is off" stays. Add that `effort` and `risky` need `effort` on, and that `tier` and `strategy` need `strategy` on.
    - Gates: add "An unanswered `tier` attaches nothing for `parallel` or `graph`."
    - Precedence: "User and project instructions and a loaded skill keep authority over this advice."
  - **`docs/domain-model.md`:** the Advice row adds "independent of the effort result".
  - **`docs/usage-guide.md`:**
    - Add the example `Jev · standard · high · delegate`, plus a table row: "`· delegate` — advice was attached for the last prompt".
    - Replace "Later work groups add skill and advice to the line." with "A later work group adds the skill."
- [ ] **Step 2:** Add to `tests/jev/questions.test.ts`:
  - A test that `docs/jev-contract.md` contains `User and project instructions and a loaded skill keep authority over this advice.`
  - A test that `docs/jev-questions.md` contains the sentence about the main `tier` having no display-name prefix. Use the exact sentence written in Step 1.
  Run `bun test tests/jev/questions.test.ts tests/policy/strategy.test.ts`. Expected: PASS. The wording is still verbatim; the docs edits did not alter quoted text.
- [ ] **Step 3:** Run `bun run typecheck && bun run lint && bun run fmt:check && bun test`. Expected: all pass.
- [ ] **Step 4:** Commit: `docs: strategy advice eligibility, gates and status line`.

---

## Scenario → test

**strategy-advice**
- Strategy on → `tests/jev/questions.test.ts` "key sets (true,true)"; `tests/host/main.test.ts` "strategy only request keys"
- Tier criteria without a prefix → `tests/jev/questions.test.ts` "tier criteria equal STANDARD_TIER_CRITERIA". `mainQuestions` takes no tier config or display names, so a configured `tiers.fast` cannot add a prefix
- Strategy off → `tests/host/main.test.ts` "strategy off returns undefined, no strategy key"
- Docs state no prefix for the main tier → `tests/jev/questions.test.ts` "docs state no prefix" (Task 6)
- Wording matches the docs → `tests/jev/questions.test.ts` "verbatim in docs"
- Delegate at the boundary / below → `tests/policy/strategy.test.ts` table rows 0.6 / 0.59
- Parallel at the boundary / below / on the fast tier → `tests/policy/strategy.test.ts` rows
- Graph at the boundary / below / off the deep tier → `tests/policy/strategy.test.ts` rows
- Direct attaches nothing → `tests/policy/strategy.test.ts` "direct"
- Tier unanswered → `tests/policy/strategy.test.ts` "parallel/graph without tier"
- Tier unanswered does not block delegate → `tests/policy/strategy.test.ts` "delegate without tier"
- Strategy unanswered → `tests/policy/strategy.test.ts` "unknown choice"
- Confidence ignored → `tests/policy/strategy.test.ts` "confidence ignored"
- Delegate block → `tests/policy/strategy.test.ts` "block shape"
- No junior → `tests/policy/strategy.test.ts` "no junior"
- Advice reaches the provider → `tests/host/strategy-advice.test.ts` "delegate in first provider body"
- Direct leaves the request unchanged → `tests/host/strategy-advice.test.ts` "direct"
- Child session → `tests/host/main.test.ts` `untouched("child")` (now with `strategy` on by default)
- Cancelled before the answer → `tests/host/main.test.ts` "cancelled returns undefined"
- Kept on a manual change → `tests/host/main.test.ts` "advice kept when level moved"
- Effort off → `tests/host/main.test.ts` "advice with effort off"; `tests/host/strategy-advice.test.ts` "effort off, strategy on"
- Effort unanswered → `tests/host/main.test.ts` "advice with effort unknown choice"
- Jev returns 500 (advice) → `tests/host/strategy-advice.test.ts` "jev 500"
- Jev times out (advice) → `tests/host/main.test.ts` "miss returns undefined" (timeout outcome)
- Docs state precedence → `tests/jev/questions.test.ts` "docs state precedence" (Task 6)

**main-effort**
- User prompt with effort on → existing `tests/host/main.test.ts` "request sent once"
- Effort off, strategy on → `tests/host/main.test.ts` "effort off strategy on"
- Effort off (both off) → `tests/host/main.test.ts` `untouched("effort and strategy off")`
- Run started by a custom message / Child session / No key / Empty prompt / Invalid config → existing `untouched(...)` cases
- Reasoning model → `tests/jev/questions.test.ts` "(true,false)"; existing main test
- Non-reasoning model → existing `tests/host/main.test.ts` "non-reasoning model asks corrects only" (run with `strategy` off)
- Both features on → `tests/jev/questions.test.ts` "(true,true)"
- Strategy only → `tests/jev/questions.test.ts` "(false,true)"
- Non-reasoning model with strategy on → `tests/host/main.test.ts` "non-reasoning with strategy"
- Operator changes the level while Jev answers / Next prompt decides again → existing `tests/host/main.test.ts` discard tests
- Jev returns 500 / Jev times out / Effort unanswered → existing `tests/host/main-effort.test.ts` and `main.test.ts` cases

**main-ledger**
- Decided turn / Run fails before any provider request / Session replaced / Ledger directory unwritable → existing tests
- Ineligible prompt → `tests/host/main.test.ts` "effort and strategy off writes no line"
- Strategy only → `tests/host/strategy-advice.test.ts` "effort off, strategy on" (no `requested`)
- Required fields / Effective is read back → existing tests
- Advice attached → `tests/host/main.test.ts` "ledger advised true"
- Advice not attached → `tests/host/main.test.ts` "ledger graph 0.7 advised false"
- Strategy not asked or unanswered → `tests/host/main.test.ts` "ledger without strategy fields"

**status-line**
- Base-state scenarios (default, mode, no key, config error, everything off, one off, no executor, malformed state, kept across /jev, base state wins, session start) → existing `tests/host/status.test.ts` and `tests/host/main.test.ts`, updated for the `Decision` shape
- After a decision → existing
- After a decision with advice → `tests/host/status.test.ts` "high · delegate"; `tests/host/strategy-advice.test.ts` widget
- Advice with effort off → `tests/host/status.test.ts` "effort off, parallel"
- Advice cleared by the next turn → `tests/host/main.test.ts` "advice cleared by direct"
- Strategy switched off → `tests/host/status.test.ts` "strategy off hides advice"
- Strategy switched back on → `tests/host/status.test.ts` "same decision with strategy on"
- Discarded effort with advice → `tests/host/main.test.ts` "advice kept when level moved"
- After a miss / Miss on a non-reasoning model / Answered without effort keeps the suffix / Discarded keeps the previous suffix / Effort switched off → existing tests
- Cancelled keeps both suffixes → `tests/host/main.test.ts` "esc restores previous decision with advice"

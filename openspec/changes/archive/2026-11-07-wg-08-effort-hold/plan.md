# Effort Hold Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** On providers in `effort.holdProviders`, keep the first effort decision until a compaction or a provider/model switch, asking only `corrects` while held.

**Architecture:** A pure rule (`src/policy/hold.ts`) decides from plain facts; `src/host/context.ts` extracts those facts from the current branch (newest `decided` anchor after the latest `compaction` entry); `src/host/main.ts` branches on the result before building the Jev request and writes the anchor into the existing `jev-turn` entry when the run settles.

**Tech Stack:** TypeScript on Pi (`@earendil-works/pi-coding-agent`), Bun test, oxlint, oxfmt.

## Global Constraints

- Public Pi APIs only; `policy/` imports nothing from Pi; only `host/` touches Pi.
- Fail open: a Jev failure or a handler error never blocks the turn or changes the level.
- No prompt, conversation or tool text in the ledger or in `jev-turn`.
- Tests need no secrets, paid calls or network beyond loopback.
- Gate: `bun check`, `oxlint --deny-warnings .`, `oxfmt --check .`, `bun test` all pass.

## Review Focus

1. Overflow compaction inside a decided turn: the turn must not anchor (pinned in Task 4 unit test "compaction during the turn writes no decided").
2. `/tree` to a point before the anchor: not held (Task 2 test "anchor not on the branch").
3. Malformed `jev-turn` data (`decided` with missing or non-string fields, from an older or edited session): ignored, never throws (Task 2 test "malformed decided ignored").
4. Operator changes the level while held: the hold never fights it and records the new level (Task 3 test "manual change while held").
5. Model without `provider` or `id` (unexpected host shape): treated as not held (Task 1 test "missing identity").

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `jev-turn` session entry data | modified | `{ turnId: string } \| { turnId: string; decided: { provider: string; model: string; level: ThinkingLevel } }` | public (session file format) |
| `HoldAnchor` (`src/policy/hold.ts`) | new | `type HoldAnchor = { provider: string; model: string; level: ThinkingLevel }` | no |
| `isHeld` (`src/policy/hold.ts`) | new | `isHeld(o: { provider: string \| undefined; model: string \| undefined; holdProviders: readonly string[]; anchor: HoldAnchor \| undefined }): boolean` | no |
| `holdContext` (`src/host/context.ts`) | new | `holdContext(entries: readonly SessionEntry[]): { anchor: HoldAnchor \| undefined; compactionId: string \| undefined }` | no |
| `TurnRecord` (`src/host/main.ts`) | modified | adds `held?: true; provider?: string; model?: string; compactionId?: string` | no |
| `main` ledger line | modified | `held: true` allowed on held turns (field already in the schema) | public (ledger format, additive) |

---

## Task 1: Pure hold rule — implements 1.1

**Files:**
- Create: `src/policy/hold.ts`
- Test: `tests/policy/hold.test.ts`

**Interfaces:**
- Produces: `HoldAnchor`, `isHeld` (see Contracts).

- [ ] **Step 1: Write the failing tests** in `tests/policy/hold.test.ts`:
  - "listed provider, same model" → `isHeld({ provider: "9router", model: "m1", holdProviders: ["9router"], anchor: { provider: "9router", model: "m1", level: "high" } })` is `true`
  - "provider not listed" → same anchor, `holdProviders: ["other"]` → `false`
  - "no anchor" → `anchor: undefined` → `false`
  - "model switched" → anchor model `m1`, current `m2` → `false`
  - "anchor for another provider" → current `9router`, anchor provider `fixture` → `false`
  - "missing identity" → `provider: undefined` or `model: undefined` → `false`
- [ ] **Step 2: Run** `bun test tests/policy/hold.test.ts` — expected FAIL (module not found).
- [ ] **Step 3: Implement** `isHeld` in `src/policy/hold.ts`, importing only `ThinkingLevel` type from `./effort.ts`.
- [ ] **Step 4: Run** `bun test tests/policy/hold.test.ts tests/boundaries.test.ts` — expected PASS (boundaries test confirms no Pi import in `policy/`).
- [ ] **Step 5: Commit** `feat(effort-hold): add the pure hold rule`.

---

## Task 2: Anchor on the branch — implements 1.2

**Files:**
- Modify: `src/host/context.ts` (next to `previousTurnId`)
- Test: `tests/host/context.test.ts`

**Interfaces:**
- Consumes: `HoldAnchor` from Task 1.
- Produces: `holdContext` (see Contracts).

Validate `level` with the `LEVELS` value exported from `src/policy/effort.ts`. Scan from the end of `entries`; stop at the first `type === "compaction"` entry and record its `id` as `compactionId`; the anchor is the newest `custom` entry with `customType === "jev-turn"` whose `data.decided` has string `provider`, `model` and a `level` among the thinking levels, found before reaching that compaction.

- [ ] **Step 1: Write the failing tests** in a `describe("holdContext")` block:
  - "anchor after compaction" → `[turn(decided A), compaction("c1"), turn(decided B)]` → `{ anchor: B, compactionId: "c1" }`
  - "anchor only before compaction" → `[turn(decided A), compaction("c1"), turn(no decided)]` → `{ anchor: undefined, compactionId: "c1" }`
  - "newest anchor wins" → `[turn(decided A on provider p1), turn(decided B on provider p2)]` → anchor B, `compactionId: undefined`
  - "held turns do not hide the anchor" → `[turn(decided A), turn({turnId}), turn({turnId})]` → anchor A
  - "anchor not on the branch" → `[msg(user)]` → `{ anchor: undefined, compactionId: undefined }`
  - "malformed decided ignored" → `decided: { provider: 1 }`, `decided: { provider: "p", model: "m", level: "huge" }`, `decided: null` → anchor `undefined`, no throw
- [ ] **Step 2: Run** `bun test tests/host/context.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** `holdContext` in `src/host/context.ts`.
- [ ] **Step 4: Run** `bun test tests/host/context.test.ts` — expected PASS.
- [ ] **Step 5: Commit** `feat(effort-hold): read the hold anchor from the branch`.

---

## Task 3: Held prompt in the main flow — implements 2.1

**Files:**
- Modify: `src/host/main.ts` (`decide`, `TurnRecord`, `write`)
- Test: `tests/host/main.test.ts` (new `describe("hold")`; extend `setup` with `holdProviders?: string[]` passed through `config: { effort: { holdProviders } }`, a mutable branch (`setBranch(entries)` on the returned handle, read by `getBranch`), and a default model carrying `provider` and `id`: `{ provider: "fixture", id: "fixture-main", reasoning: true, thinkingLevelMap: { xhigh: "xhigh" } }`)

**Interfaces:**
- Consumes: `isHeld` (Task 1), `holdContext` (Task 2), `snapshot.settings.effort.holdProviders`.
- Produces: `TurnRecord.held`, `TurnRecord.provider`, `TurnRecord.model`, `TurnRecord.compactionId` used by Task 4.

In `decide`, after the model check: read `holdContext(entries)` (reuse the `entries` already read), compute `held = isHeld({ provider: model.provider, model: model.id, holdProviders: snapshot.settings.effort.holdProviders, anchor })`. Store `provider`, `model`, `compactionId` on the record. When held: force `askEffort` to false, build `mainQuestions({ askEffort: false })`, set `rec.held = true`. The held prompt has its own post-request path, taken before the existing miss and no-effort branches: for any outcome other than `cancelled` (answered, transport miss, or `readAnswers` miss) record `miss` and `corrects` as usual, then set `rec.effective = level()` and `setDecision(... { kind: "level", level: rec.effective })`, and return; never call `pi.setThinkingLevel`. In `write`, add `held: true` to the `main` line only when `rec.held`; `effortP`, `risky` and `requested` stay absent because they are never set on a held record.

- [ ] **Step 1: Write the failing tests:**
  - "second prompt held" → branch with `jev-turn { turnId, decided: { provider: "fixture", model: "fixture-main", level: "high" } }`, `holdProviders: ["fixture"]`, start `high`, outcome answer `xhigh` → request `questions` keys exactly `["corrects"]`, `sets` `[]`, status `["Jev · standard · high"]`
  - "provider not listed" → same branch, `holdProviders: ["other"]` → keys `effort`, `risky`, `corrects`
  - "held miss" → held, outcome `{ kind: "miss", miss: "timeout", ms: 300 }` → `sets` `[]`, status `["Jev · standard · high"]`; after `agentSettled`, `main` line has `held: true`, `answered: false`, `miss: "timeout"`, `effective: "high"`
  - "manual change while held" → anchor `high`, start `low` → held, `sets` `[]`, line `held: true`, `from: "low"`, `effective: "low"`
  - "held line fields" → held, answer `corrects` 0.1, settle → line validates with `validateLedgerEntry`, has `held: true`, `effective`, `from`, `corrects: 0.1`, and no `effortP`, `risky`, `requested`
  - "correction while held" → branch `jev-turn { turnId: "T1", decided }`, held, `corrects` 0.9, settle → a `correction` line with `turnId: "T1"`
  - "decided turn on listed provider has no held" → no anchor, `holdProviders: ["fixture"]`, answer `high` → line has no `held`
  - "held schema miss" → held, outcome body without `corrects` → `sets` `[]`, status `["Jev · standard · high"]`, line `held: true`, `miss: "schema"`, `effective: "high"`
  - Edit existing test "forbidden fields are absent": drop `"held"` from the forbidden list (it is now covered by "decided turn on listed provider has no held")
- [ ] **Step 2: Run** `bun test tests/host/main.test.ts` — expected FAIL on the new tests only.
- [ ] **Step 3: Implement** as described above.
- [ ] **Step 4: Run** `bun test tests/host/main.test.ts tests/policy tests/jev` — expected PASS; the only edit to existing tests is the forbidden-list change above.
- [ ] **Step 5: Commit** `feat(effort-hold): hold the main effort on listed providers`.

---

## Task 4: Anchor marker on settle — implements 2.2

**Files:**
- Modify: `src/host/main.ts` (`write`, `agentSettled`)
- Test: `tests/host/main.test.ts`

**Interfaces:**
- Consumes: `TurnRecord` fields from Task 3; `holdContext` (Task 2) re-read at settle through the stored `ctx`.
- Produces: the `jev-turn` data shape in Contracts.

At settle (including a run aborted after its first provider request), `decided` is added to the `jev-turn` data when `rec.held !== true`, `rec.effective !== undefined`, `rec.provider` and `rec.model` are strings, and `holdContext(ctx.sessionManager.getBranch()).compactionId === rec.compactionId`. Otherwise the data stays `{ turnId }`. A throw while reading the branch at settle writes `{ turnId }`.

- [ ] **Step 1: Write the failing tests:**
  - "applied turn anchors" → no anchor, answer `high` from `low`, settle → `custom` last is `{ type: "jev-turn", data: { turnId, decided: { provider: "fixture", model: "fixture-main", level: "high" } } }`
  - "same level anchors" → start `medium`, answer `medium` → `decided.level` `medium`
  - "max anchors" → start `max`, answer `low` → `decided.level` `max`
  - "unlisted provider anchors" → `holdProviders: []`, answer `high` → `decided` present
  - "held turn" → held → data exactly `{ turnId }`
  - "discarded turn" → level changed during the wait → data exactly `{ turnId }`
  - "miss" → data exactly `{ turnId }`
  - "non-reasoning model" → `{ reasoning: false }` → data exactly `{ turnId }`
  - "aborted after the provider request anchors" → answer `high`, `beforeProviderRequest`, then `agentSettled({ aborted: true })` → `decided.level` `high`
  - "compaction during the turn writes no decided" → branch at prompt has no compaction; before `agentSettled`, `t.setBranch([...branch, { type: "compaction", id: "c1" }])` → data exactly `{ turnId }`
  - Edit existing test "applied turn" (ledger block, `t.custom` assertion): expect `data` `{ turnId, decided: { provider: "fixture", model: "fixture-main", level: <its effective> } }`
- [ ] **Step 2: Run** `bun test tests/host/main.test.ts` — expected FAIL on the new tests.
- [ ] **Step 3: Implement** in `write` (pass the settle-time `compactionId` in from `agentSettled`).
- [ ] **Step 4: Run** `bun test tests/host/main.test.ts` — expected PASS.
- [ ] **Step 5: Commit** `feat(effort-hold): record the hold anchor on the turn entry`.

---

## Task 5: Host proof through the real CLI — implements 3.1

**Files:**
- Modify: `tests/host/harness.ts` (`PrepareOpts.jevConfig` gains optional `holdProviders?: string[]`, written as `effort.holdProviders` in `jev/config.json`)
- Test: `tests/host/harness.test.ts` (one case: `jev/config.json` carries `effort.holdProviders` when given, and no `effort` key otherwise)
- Create: `tests/host/effort-hold.test.ts` (reuse the setup pattern of `tests/host/main-effort.test.ts` and the summarization match plus filler of `tests/host/q5-q6-main.test.ts`; `persist: true`; `holdProviders: ["fixture"]`)

**Interfaces:**
- Consumes: the behaviour of Tasks 3 and 4.

Per provider request, `fixture.requests[i].reasoningEffort` is the level sent; Jev request bodies are in `jev.requests[i].body`. Set each prompt's Jev answer by reassigning `routes[ASK]` before the prompt, as `main-effort.test.ts` does; on a held prompt the returned `effort` is ignored, which is part of the check. Count `thinking_level_change` entries by reading the persisted session file after each settle: Pi writes one at session creation, so assertions compare counts between points, never an absolute count. The compaction case needs the summarization script entry (`times: 1`), `FILLER` on the prompts before the compaction, and asserts `compact` succeeded first. The host test is written after Tasks 3–4 by design: it proves the real CLI wiring, and the unit tests carried the TDD.

- [ ] **Step 1: Write the harness case** in `tests/host/harness.test.ts`, run `bun test tests/host/harness.test.ts` — expected FAIL; add the option; run again — expected PASS.
- [ ] **Step 2: Write the host tests:**
  - "no thinking change after the anchor" → Jev answers `high` then `low`, `low`, `low`; start `low`; four prompts → first provider request `high`; requests 2–4 `high`; Jev requests 2–4 have question keys exactly `["corrects"]`; ledger `main` lines 2–4 have `held: true`; the `thinking_level_change` count after prompt 1 equals the count after prompt 4
  - "exactly one decision after a compaction" → anchor `low`, two held prompts (with filler), `compact` succeeds, then three prompts with Jev answering `high` → exactly the first post-compaction Jev request asks `effort`; provider requests after compaction all carry `high`; the `thinking_level_change` count rises by exactly one between the compaction and the last prompt
  - "unlisted provider decides every prompt" → `holdProviders: []`, two prompts → both Jev requests ask `effort`
  - "entry not in the provider request" → after an anchored turn, the next provider request body contains neither `jev-turn` nor `decided`
- [ ] **Step 3: Run** `bun test tests/host/effort-hold.test.ts` — expected PASS (Tasks 3–4 are in place); if a case fails, fix the code, not the expectation.
- [ ] **Step 4: Commit** `test(effort-hold): host proof of the hold and the compaction release`.

---

## Task 6: Docs and full gate — implements 3.2

**Files:**
- Modify: `docs/workflow.md` (§1 "While held": add that the level is not touched and the status shows the level in force; "Ledger and status": `jev-turn` may carry `decided`; §7 step 2: the hold is released because the anchor is before the compaction)
- Modify: `docs/domain-model.md` (Hold row: anchor on provider and model; `held` row: on held turns, with `effective`)
- Modify: `docs/roadmap.md` (WG-08 status `Done`)
- Modify: `docs/usage-guide.md` only if it describes the status suffix for held turns

- [ ] **Step 1: Edit the docs** as listed; English, glossary vocabulary.
- [ ] **Step 2: Run the gate:** `bun check && bunx oxlint --deny-warnings . && bunx oxfmt --check . && bun test` — expected all pass.
- [ ] **Step 3: Commit** `docs(effort-hold): describe the hold and mark WG-08 done`.

---

## Scenario → test

effort-hold:
- Second prompt on a held provider → `tests/policy/hold.test.ts` "listed provider, same model"; `tests/host/main.test.ts` "second prompt held"
- Provider not listed → `hold.test.ts` "provider not listed"; `main.test.ts` "provider not listed"
- First prompt of a session → `hold.test.ts` "no anchor"
- Anchor before the latest compaction → `tests/host/context.test.ts` "anchor only before compaction"
- Model switched → `hold.test.ts` "model switched"
- Provider switched back → `hold.test.ts` "anchor for another provider"; `context.test.ts` "newest anchor wins" (with anchors for provider A then provider B)
- Resume keeps the hold → `main.test.ts` "second prompt held" (a fresh `createMain` with only the branch holding the anchor, which is what a resumed session sees)
- Branch without the anchor → `context.test.ts` "anchor not on the branch"
- No thinking change while held → `effort-hold.test.ts` "no thinking change after the anchor"
- Held and Jev fails → `main.test.ts` "held miss"
- Manual change while held → `main.test.ts` "manual change while held"
- Correction while held → `main.test.ts` "correction while held"
- Exactly one decision after a compaction → `effort-hold.test.ts` "exactly one decision after a compaction"
- Miss right after a compaction → `context.test.ts` "anchor only before compaction" plus `main.test.ts` "miss" (a miss writes no anchor)
- Compaction inside a decided turn → `main.test.ts` "compaction during the turn writes no decided"
- Applied turn → `main.test.ts` "applied turn anchors"
- Held turn → `main.test.ts` "held turn"
- Discarded turn → `main.test.ts` "discarded turn"
- Aborted after the provider request → `main.test.ts` "aborted after the provider request anchors"
- Non-reasoning model → `main.test.ts` "non-reasoning model"

main-effort:
- Reasoning model, Non-reasoning model → existing `tests/jev/questions.test.ts`, `main.test.ts` "non-reasoning model asks corrects only"
- Held prompt → `main.test.ts` "second prompt held"

main-ledger:
- Required fields, Effective is read back from Pi → existing `main.test.ts` ledger tests
- Held turn → `main.test.ts` "held line fields"
- Held turn with a miss → `main.test.ts` "held miss"
- Decided turn is not held → `main.test.ts` "decided turn on listed provider has no held"
- Entry after a decided turn → `main.test.ts` "miss"
- Entry after an applied turn → `main.test.ts` "applied turn anchors"
- Entry not in the provider request → `effort-hold.test.ts` "entry not in the provider request"

status-line (new and changed scenarios; the rest stay covered by existing `tests/host/status.test.ts` and `main.test.ts`):
- After a miss → existing miss status test (not held)
- Held turn shows the level in force → `main.test.ts` "second prompt held" (fresh `createMain`, so no prior suffix)
- Held miss shows the level → `main.test.ts` "held miss"

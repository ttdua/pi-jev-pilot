# WG-13 Slots and Fallback Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` (`worker-decision`, `worker-request`, `worker-routing`, `worker-ledger`, `config-file`, `jev-command`, `slot-commands`) and `design.md`.

**Goal:** Offer configured slots to Jev in the worker `tier` question, decide and fall back on them, warn by slot name, and let the operator add, replace, show and remove slots with `/jev`, with `when` required.

**Architecture:** The policy widens from `TierName` to `Target = TierName | slot::<name>` (design D1). Slot names enter the pure route as a list, while models stay behind host callbacks (D2). `decideTier` gains rule `slot` and the below-the-bar substitution (D3). `chooseFallback` gains the slot ladder `balanced`, `fast` (D4). Host code gains `models.ts` (registry check, nearest names) and `slots.ts` (slot forms); `commands.ts` only dispatches to `slots.ts` (D7, D9).

**Tech Stack:** TypeScript, Bun (`bun test`), oxlint boundary rules, `@earendil-works/pi-coding-agent` 1.5.0 (`ModelRegistry.find`, `getAvailable`, `hasConfiguredAuth`), `@gotgenes/pi-subagents` 25.0.5 (host test only).

## Global Constraints

- `policy/` imports only itself and `shared/`; `jev/` may import `policy/`; only `host/` imports Pi (`.oxlintrc.json`).
- Slot bar: probability `>= 0.6` (inclusive). Below-the-bar tie order: `fast`, `balanced`, `deep`, `expert` (the lower tier wins).
- Slot fallback ladder: `balanced`, then `fast`. A slot never falls back to `deep`, never to `expert`, and is never itself a fallback target.
- Slot criterion: `` `${displayName ?? model} (a custom model). ${when.trim()}` ``, the same in every mode.
- Warning setting text: `` crew.slots "<name>" model ``; tier warnings keep `tiers.<name>`.
- Nearest names: at most 3, from `getAvailable()` only, by case-insensitive edit distance, ties broken alphabetically. Suggestions only for `not in the model registry` and `no credentials`.
- Add and replace check order: parse, then `provider/id` shape, then the `when` requirement, then the registry and credentials check, then the slot writer.
- Every commit passes `bun run typecheck` and `bun test`.
- No new dependency. No ledger schema, state or config version change. Ledger `v` stays `1`.
- A request with no slot configured is unchanged byte for byte.
- Tests need no secrets, paid calls or network beyond loopback.
- Everything in the repository is English; relative imports use the `.ts` extension.

## Review Focus

- **Jev returns `tier` probabilities without a key for some option.** Missing counts as 0 for both the bar and the below-the-bar pick. Test "Slot probability missing" in Task 3.
- **A slot is renamed in config between `message_end` and `tool_call`.** The answer names a slot that is no longer offered. Rule `slot` must not match, and the choice falls to the highest tier. Covered by "Slot not offered" in Task 3. In Task 6, the host must also resolve a slot's model at `tool_call` from the same snapshot that produced `offered`. Test "Slot removed before the tool call" in Task 6.
- **The slot's model string contains `/` twice (`9router/openai/gpt-6`).** `splitModel` splits at the first `/`, as it does for tiers. Test "Nested provider id" in Task 5.
- **`/jev reviewer x/y when` with trailing spaces and tabs, or `when` text containing the word `when`.** Only the first `when` after the model is the keyword; everything after it is verbatim. Test "When text containing when" in Task 7.
- **The operator removes the slot Jev keeps choosing.** The next launch simply has no slot option, and no warning is left over. Covered by "Next launch sees the slot" (add) in Task 8, plus "Removed slot not offered" in Task 8.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `/jev <slot> <provider/model> [when <text>]` | new | adds or replaces a slot; `<slot>` matches `^[a-z][a-z0-9-]{0,23}$` and is not reserved; text after `when` is verbatim, trimmed | yes (operator-approved) |
| `/jev <slot>` | new | shows `slot <name>: <model>` then `when: <when>`; writes nothing; slot forms notify only their message, not the status | yes |
| `/jev remove <slot>` | new | removes through `writeSlots`; reports `slot <name> removed` | yes |
| Usage text | modified | adds lines `  /jev <slot> <provider/model> [when <text>]`, `  /jev <slot>`, `  /jev remove <slot>` after the `cli-review` line | yes |
| `config.json` `crew.slots[].when` | modified | required string, 1–500 characters after trim (was optional) | yes (file format, unreleased) |
| `Slot` (`src/store/config.ts`) | modified | `{ name: string; model: string; when: string }` (`when` no longer optional) | no |
| `SlotTarget`, `Target`, `isSlot` (`src/policy/launch.ts`) | new | `` type SlotTarget = `slot::${string}` ``; `type Target = TierName \| SlotTarget`; `isSlot(t: Target): t is SlotTarget`; `slotTarget(name: string): SlotTarget` | no |
| `TierDecision` (`src/policy/tier.ts`) | modified | `{ kind: "decided"; tier: Target; reason: "expert-admitted" \| "risky" \| "slot" \| "expert-denied" \| "fast-unsure" \| "choice" } \| { kind: "none"; reason?: "miss" }` | no |
| `decideTier(answers, offered: readonly TierName[], mode: ModeName, slots: readonly string[] = [])` | modified | adds `slots` (configured names, config order) | no |
| `FallbackResult` | modified | `{ kind: "keep"; tier: Target } \| { kind: "moved"; tier: TierName; from: Target } \| { kind: "unchanged" }` | no |
| `chooseFallback(target: Target, offered: readonly TierName[], canRun: (t: Target) => boolean, slots: readonly string[] = [])` | modified | `slots` appended last with a default, so existing calls compile; a slot is kept only when its name is in `slots` and it can run | no |
| `RouteInput` (`src/policy/route.ts`) | modified | adds `slots: readonly string[]`; `canRun`, `thinkingOf`, `modelOf` take `Target` | no |
| `Route.record` | modified | `tier?: Target; fallback?: Target` | no |
| `launchKind(launch, offered, forkedLaunch, slotCount = 0)` | modified | "no tier" means `offered.length === 0 && slotCount === 0` | no |
| `EffortInput.tier` (`src/policy/effort.ts`) | modified | `Target`; the `fast` cap applies only to `"fast"`. Deviation (internal): the plan named it `WorkerEffortInput`; the existing type is `EffortInput` | no |
| `SlotOption` (`src/jev/questions.ts`) | new | `{ name: string; model: string; when: string; displayName?: string }` | no |
| `buildWorkerQuestions(offered, displayNames, mode, slots: readonly SlotOption[] = [])` | modified | appends `slot::<name>` criteria and options after tiers | no |
| `SLOT_CRITERION_INFIX` (`src/jev/rubrics.ts`) | new | `" (a custom model). "` | no |
| `editDistance(a: string, b: string): number` (`src/shared/text.ts`) | new | Levenshtein over code points | no |
| `src/host/models.ts` | new | `splitModel(id): [string, string] \| undefined`; `type ModelCheck = { ok: true; thinking: ModelThinking } \| { ok: false; why: "not a provider/model" \| "not in the model registry" \| "no credentials" }`; `checkModel(registry: ModelRegistry, id: string): ModelCheck`; `nearestModels(registry: ModelRegistry, id: string, max = 3): string[]` | no |
| `src/host/slots.ts` | new | `type SlotArgs = { kind: "set"; name; model; when?: string } \| { kind: "show"; name } \| { kind: "remove"; name }`; `parseSlotArgs(text: string): SlotArgs \| "usage" \| undefined` (`undefined` = not a slot form; after trim, a set form must match `/^(\S+)\s+(\S+)(?:\s+when\s+(\S[\s\S]*))?$/`, so `when` is a whole word followed by text; a name-shaped first word that does not match gives `"usage"`); `runSlot(args: SlotArgs, registry: ModelRegistry, dir: string): { ok: true; message: string } \| { ok: false; message: string; usage?: true }` | no |
| `JevArgs` (`src/host/commands.ts`) | modified | adds `{ kind: "slot"; args: SlotArgs }` | no |
| `resolveModel(target: Target, tiers: Partial<Record<TierName, string>>, slots: readonly Slot[]): string \| undefined` (`src/host/models.ts`) | new | a tier from `tiers`, a slot from `slots` by name | no |
| `fixtureModelsJson` (`tests/host/fixture.ts`) | modified | `fixture` provider gains `fixture-review` (reasoning); `fixture2` gains `fixture-review-keyless` when `keyless` | no |

---

## Task 1: `when` required — implements 1.1

**Files:** Modify `src/store/config.ts` (`slotsValidator`), `tests/store/config-read.test.ts`, `tests/store/config-write.test.ts`, and every test that writes a slot without `when` (find them with `grep -rn "slots" tests/`).

- [ ] **Step 1: Write failing tests** "Slot without when" (`{name:"reviewer", model:"a/b"}` → problem paths `["crew.slots[0].when"]`) and "Slot writer refuses a slot without when" (`writeSlots(dir, [{name:"reviewer", model:"a/b"}])` returns `ok: false` with that path, file bytes unchanged).
- [ ] **Step 2: Run** `bun test tests/store`. Expect FAIL on the two new tests.
- [ ] **Step 3: Implement.** In `slotsValidator`, move `when` from optional to required with the same 1–500 trimmed bounds, and add it to the `required` list. Make `Slot.when` non-optional and drop the `when === undefined` branch in `writeSlots`. Add a `when` to the `slot()` helper and every slot fixture so existing tests keep passing. Cast the test input that has no `when`.
- [ ] **Step 4: Run** `bun test` and `bun run typecheck`. Expect PASS.
- [ ] **Step 5: Commit** `feat(config): require when on every slot`.

## Task 2: Target type and effort — implements 2.1

**Files:** Modify `src/policy/launch.ts`, `src/policy/effort.ts`; Test `tests/policy/effort.test.ts`, `tests/policy/launch.test.ts`.

**Interfaces:** Produces `SlotTarget`, `Target`, `isSlot`, `slotTarget` (Contracts).

- [ ] **Step 1: Write failing tests**:
  - "Slot without the fast cap": `workerEffort({effort: choice("high"), tier: "slot::reviewer", movedByFallback: false})` → `"high"`.
  - "Slot fell back to fast": `effort` `low`, `tier: "fast"`, `movedByFallback: true` → `"xhigh"`.
  - `isSlot("slot::a") === true`, `isSlot("fast") === false`, `slotTarget("a") === "slot::a"`.
- [ ] **Step 2: Run** `bun test tests/policy/effort.test.ts tests/policy/launch.test.ts`. Expect FAIL (no export, type error).
- [ ] **Step 3: Implement** the types in `launch.ts` and widen `EffortInput.tier` to `Target`. The cap check stays `tier === "fast"`.
- [ ] **Step 4: Run** the tests and `bun run typecheck`. Expect PASS.
- [ ] **Step 5: Commit** `feat(policy): slot targets`.

## Task 3: Rule `slot` — implements 2.2

**Files:** Modify `src/policy/tier.ts`, `src/policy/route.ts` and `src/host/worker.ts`; Test `tests/policy/tier.test.ts`.
- `route.ts` and `tier.ts` change types only. `record.tier` and `record.fallback` become `Target`. `RouteInput.canRun`, `thinkingOf` and `modelOf` take `Target`. `chooseFallback`'s first parameter and its `canRun` take `Target`. Until Task 4, a slot target in `chooseFallback` returns `unchanged`.
- `worker.ts` gets the minimal widening that compiles: `checkOf`, `modelOf` and `warn` accept `Target` and treat a slot as unable to run until Task 6.

**Interfaces:** Consumes `Target`, `slotTarget`. Produces the `decideTier` and `TierDecision` contracts.

- [ ] **Step 1: Write failing tests.** Extend the `answers()` helper so the `tier` probabilities can carry `slot::` keys, and drop the fixed zero entries for any key the test gives. Add the cases below. Unless a case says otherwise, `R` = `["reviewer"]`, mode `standard`, `ALL` offered.
  - "Slot at the bar": `slot::reviewer` .6 → `decided("slot::reviewer","slot")`.
  - "Risk wins over a slot": .95 with risky .8 → `deep`, `risky`.
  - "Risk floor with only a slot": offered `[]`, risky .9, slot .95 → slot, `slot`.
  - "Two slots": slots `["reviewer","bulk"]`, `slot::bulk` .7 → `slot::bulk`.
  - "Slot below the bar": choice slot .5, `{balanced:.3, deep:.15, fast:.05}` → `balanced`, `choice`.
  - "Below the bar into unsure fast": slot .55, `{fast:.4, balanced:.05}` → `balanced`, `fast-unsure`.
  - "Below the bar into expert denied": slot .5, `{expert:.3, deep:.1}` → `deep`, `expert-denied`.
  - "Slot not offered": slots `[]`, choice `slot::old` .9, `{balanced:.08}` → `balanced`, `choice`.
  - "Slot choice never passes the standard expert gate": like expert denied, with `expertNeeded` .95 → `deep`, `expert-denied`.
  - "Slot choice never passes the premium expert gate": mode `premium`, slot .5, `{expert:.3, deep:.1}`, effort `max` → `deep`, `expert-denied`.
  - "Slot probability missing" (Review Focus): choice slot with probabilities `{balanced:.2}` only → `balanced`, `choice`.
  - "Below-the-bar tie": slot .5, `{fast:.2, balanced:.2}` → the pick is `fast`, then rule `fast-unsure` gives `balanced`.
  - "Slot below the bar, no tier offered": offered `[]`, slot .5 → `{kind:"none"}`.
  - "Slot in every mode": for each of `MODE_NAMES`, slot .92 with effort `max` and risky .1 → slot, `slot`.
- [ ] **Step 2: Run** `bun test tests/policy/tier.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** in `decideTier`. Change the early return to `offered.length === 0 && slots.length === 0`. After rule 2:
  - If `choice.choice` is an offered `slot::<name>` and its probability is ≥ .6, decide it with reason `slot`.
  - If `choice.choice` starts with `slot::` but rule `slot` did not decide it, substitute the offered tier of highest probability, scanning `TIER_LADDER` and keeping the first maximum. With no offered tier, return `none`.
  - Rules 3–5 then use the substituted choice.
  - Rule 2 with no qualifying tier already falls through; keep that.
- [ ] **Step 4: Run** `bun test` and `bun run typecheck`. Expect PASS, including every existing test.
- [ ] **Step 5: Commit** `feat(policy): slot decision rule`.

## Task 4: Slot fallback and route — implements 2.3, 2.4

**Files:** Modify `src/policy/tier.ts` (`chooseFallback`), `src/policy/route.ts`, `src/host/worker.ts` (passes `slots: []` until Task 6); Test `tests/policy/tier.test.ts`, `tests/policy/route.test.ts`.

**Interfaces:** Consumes Task 3. Produces `chooseFallback`, `FallbackResult`, `RouteInput`, `Route.record` and `launchKind` (Contracts).

- [ ] **Step 1: Write failing fallback tests**:
  - "Usable slot kept": `chooseFallback("slot::reviewer", ALL, () => true, R)` → `{kind:"keep", tier:"slot::reviewer"}`.
  - A runnable slot whose name is not in `slots` is not kept; it falls back as if it could not run.
  - "Slot falls back to balanced": `canRun = t => t !== "slot::reviewer"` → `{kind:"moved", tier:"balanced", from:"slot::reviewer"}`.
  - "Slot falls back to fast": offered `["fast","deep"]`, slot unusable → moved to `fast`.
  - "Slot never moves up": only `deep` and `expert` can run → `unchanged`.
- [ ] **Step 2: Write failing route tests** (helper `input({...})` already exists; add `slots`):
  - "Slot written": the slot model `fixture/fixture-review` with `{reasoning:true}`, choice slot .92, effort `high` → `write {model:"fixture/fixture-review", thinking:"high"}`, record `{reason:"slot", tier:"slot::reviewer", effort:"high"}`.
  - "Slot falls back with xhigh": the slot is unusable, effort `low` → `balanced` model, thinking `xhigh` clamped, record `fallback:"slot::reviewer"`, `tier:"balanced"`, `reason:"slot"`.
  - "Unusable slot alone": offered `[]`, slots R, nothing can run → `write {}`, record `{tier:"slot::reviewer", reason:"slot", fallback:"slot::reviewer"}`.
  - "Slot below the bar with no tier": offered `[]`, slot .5, effort `medium` → `write {thinking:"medium"}`, reason `untouched`, no tier.
  - "Slot alone with thinking locked": `launchKind(thinkingLocked, [], "untouched", 1)` → `{kind:"ask", tierQuestion:true}`.
  - "Model locked with a slot decided": write thinking `high` only; record tier slot, `slot`, locked, no fallback.
  - "Recorded results validate": the existing loop also validates the slot records with `validateLedgerEntry`.
- [ ] **Step 3: Run** `bun test tests/policy`. Expect FAIL.
- [ ] **Step 4: Implement.**
  - In `chooseFallback`, a slot target walks `["balanced","fast"]` over offered tiers that can run. A tier target keeps today's walk.
  - In `launchKind`, take `slotCount`.
  - In `routeLaunch`, call `launchKind(…, input.slots.length)` and pass `slots` to `decideTier` and `chooseFallback`. The callbacks are already `Target` from Task 3.
- [ ] **Step 5: Run** `bun test tests/policy` and `bun run typecheck`. Expect PASS.
- [ ] **Step 6: Commit** `feat(policy): slot fallback and route`.

## Task 5: Slot questions, edit distance, model helpers — implements 3.1, 4.1

**Files:**
- Modify: `src/jev/questions.ts`, `src/jev/rubrics.ts`, `src/shared/text.ts`.
- Create: `src/host/models.ts`.
- Move `splitModel` and `checkTier` out of `src/host/worker.ts`, which then imports them.
- Test: `tests/jev/questions.test.ts`, `tests/shared/text.test.ts`, `tests/host/models.test.ts` (new).

**Interfaces:** Produces `SlotOption`, `SLOT_CRITERION_INFIX`, `editDistance`, `splitModel`, `checkModel`, `ModelCheck`, `nearestModels`, `resolveModel`.

- [ ] **Step 1: Write failing question tests**:
  - "Slots after tiers": offered `["fast","balanced"]`, slots reviewer then bulk → `specs.tier.options` `["fast","balanced","slot::reviewer","slot::bulk"]`, and the criteria keys are the same.
  - "No slot, request unchanged": `JSON.stringify(buildWorkerQuestions(ALL, names, m))` equals the same call with `slots` `[]`, for every mode.
  - "Slot alone": offered `[]` → question keys `["tier","effort","risky"]`, options `["slot::reviewer"]`.
  - "Reviewer criterion": `"GPT-6.1 Sol (a custom model). Choose for reviews. Not for fixing."`.
  - "No display name": the criterion starts with `"9router/gpt-6.1-sol (a custom model). "`.
  - "Same in every mode": the slot criterion is equal across `MODE_NAMES`.
  - "Slot answer read": `readWorkerOutcome` on a body answering `slot::reviewer` keeps choice and all probabilities.
  - "Main request with a slot configured": the `mainQuestions` wire has no key or option containing `slot::`.
  - "Expert offered": options before slots end with `expert`.
  - "Asked and accepted agree": extend the existing test to offered `["fast","deep"]` plus slot reviewer → keys and options are both `["fast","deep","slot::reviewer"]`.
  - "No tier configured": extend the existing test so no tier and no slot gives exactly `effort`, `risky`.
  - Wording: the docs file contains the text ` (a custom model). ` from `docs/jev-questions.md`, so `SLOT_CRITERION_INFIX` matches the docs.
- [ ] **Step 2: Write failing helper tests**:
  - `editDistance("kitten","sitting") === 3`, `editDistance("","abc") === 3`, emoji counted as one code point.
  - `checkModel` with a fake registry, returning `not a provider/model` for `"x"`, `not in the model registry`, `no credentials`, and ok with thinking.
  - "Nested provider id": `splitModel("9router/openai/gpt-6")` → `["9router","openai/gpt-6"]`.
  - "Typo suggests the right model": `nearestModels(fake, "fixture/fixture-reviw")[0] === "fixture/fixture-review"` and length ≤ 3.
  - "Keyless model not suggested": a model with no auth is absent from `getAvailable()` and from the result.
  - "No usable model at all": `[]`.
  - Case-insensitive ranking, and an alphabetic tie-break.
  - `resolveModel("deep", {deep:"a/b"}, [])` → `"a/b"`; `resolveModel("slot::r", {}, [{name:"r", model:"c/d", when:"x"}])` → `"c/d"`; an unknown slot → `undefined`.
- [ ] **Step 3: Run** `bun test tests/jev tests/shared tests/host/models.test.ts`. Expect FAIL.
- [ ] **Step 4: Implement.** `nearestModels` maps `getAvailable()` to `` `${m.provider}/${m.id}` ``, then sorts by `editDistance(lower(a), lower(id))`, then by `localeCompare`, then takes the first `max`.
- [ ] **Step 5: Run** the same tests, then `bun test`. Expect PASS; worker tests are unchanged.
- [ ] **Step 6: Commit** `feat: slot questions and model helpers`.

## Task 6: Host routing with slots — implements 4.2, 4.3

**Files:** Modify `src/host/worker.ts`, `tests/host/fixture.ts`, `tests/host/fixture.test.ts` (its expected `fixture` model list gains `fixture-review`), and `tests/host/worker-fakes.ts` (`Opts` and `snap()` gain `slots?: Slot[]`; the fake registry gains `getAvailable()`); Test `tests/host/worker.test.ts`, `tests/host/worker-ledger.test.ts`, `tests/host/worker-routing.test.ts`.

**Interfaces:** Consumes Tasks 4 and 5.

- [ ] **Step 1: Write failing unit tests** in `tests/host/worker.test.ts` (fake registry and fake `ask`):
  - "Slot display name": the request's `slot::reviewer` criterion starts with `Fixture Review (a custom model). `.
  - "Unusable slot": a slot without auth, Jev answers the slot at .92, input `model` becomes the `balanced` model.
  - "Slot warning text": one notify containing `slot reviewer`, the model, `no credentials`, `balanced` and `crew.slots "reviewer" model`.
  - "Once per slot": three launches give one notify.
  - "Slot warning with nothing to fall back to": no `balanced`/`fast` usable gives `launch left unchanged`.
  - "Slot warning shown again after its model changes": change the slot model in the snapshot and notify again.
  - "Slot warning shown again after a slot command": after `routing.clearWarnings()`, notify again.
  - "Forked launch with thinking asks fewer questions", with a slot configured: the request still asks exactly `effort` and `risky`.
  - "Slot removed before the tool call" (Review Focus): classify with slot reviewer; the snapshot at `tool_call` has no slots; Jev chose the slot. The launch routes with the classification's slot list and model, without throwing.
  - Ledger, in `tests/host/worker-ledger.test.ts`: "Slot decision recorded" and "Slot fallback recorded" lines pass `validateLedgerEntry`.
- [ ] **Step 2: Run** `bun test tests/host/worker.test.ts tests/host/worker-ledger.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.**
  - In `classify`, read `settings.crew.slots` into the `LaunchEntry` as `slots: Slot[]`, with name, model and when, next to `offered`.
  - Pass the slot count to `launchKind`. Pass `SlotOption`s with registry display names to `buildWorkerQuestions` only when `kind.tierQuestion`, else `[]`, the same way tiers are already passed.
  - In `route`, pass `slots` names and resolve a target's model as follows: a tier from `settings.tiers`; a slot from the entry's captured `slots`, so a config change mid-launch cannot drop it.
  - Resolve models with `resolveModel(target, settings.tiers, entry.slots)` and pass the resolved model to `checkOf` and `warn`, so `route` holds no slot lookup itself. The warning key is `target + NUL + model`.
  - The warn text for a slot is `Jev: slot <name> (<model>) cannot run (<why>); <tail>. Fix crew.slots "<name>" model in <config path>.`
- [ ] **Step 4: Write failing host tests** in `tests/host/worker-routing.test.ts`, using the existing loopback Jev fixture and the real CLI pattern, with config slot `reviewer` → `fixture/fixture-review` and `when` set:
  - "Review launch on the reviewer slot": Jev answers `slot::reviewer` .92 with effort `high`; the child's first request has `model` `fixture-review` and reasoning effort `high`.
  - "Background review launch": the same with `run_in_background: true`.
  - "Unusable reviewer slot falls back": slot model `fixture2/fixture-review-keyless` with `keyless: true`; the child runs `fixture-balanced`; the RPC notify names `crew.slots "reviewer" model`.
  - "Jev down with a slot configured": the Jev fixture returns 500; the child uses the caller model.
- [ ] **Step 5: Run** `bun test tests/host`. Expect PASS.
- [ ] **Step 6: Commit** `feat(worker-routing): route to slots`.

## Task 7: Slot forms — implements 5.1

**Files:** Create `src/host/slots.ts`; Test `tests/host/slots.test.ts` (new; temp jev dir, fake registry).

**Interfaces:** Consumes `checkModel`, `nearestModels`, `readConfig`, `writeSlots`, `RESERVED_SLOT_NAMES`. Produces `SlotArgs`, `parseSlotArgs`, `runSlot`.

- [ ] **Step 1: Write failing parse tests**:
  - "Add with when": `parseSlotArgs("reviewer fixture/fixture-review when Choose for reviews.  Not for fixing.")` → `when` keeps the double space.
  - "When text containing when": `"r a/b when Choose when reviewing."` → `when` `"Choose when reviewing."`.
  - "Third word not when" → `"usage"`; a third word `whenever` → `"usage"`.
  - "Empty when": `"r a/b when \t "` → `"usage"`.
  - "Reserved name": `parseSlotArgs("review a/b when x")` → `undefined`, and `parseJevArgs` of the same text → `{kind:"usage"}`.
  - "Remove with extra words" → `"usage"`.
  - `"skills off"` → `undefined`, since a reserved first word is not a slot form.
  - `"Colors off"` → `undefined`, since it does not match the slot pattern.
  - `"colors off"` → `{kind:"set", name:"colors", model:"off"}`.
- [ ] **Step 2: Write failing run tests**:
  - "Bad model shape reported before missing when" and "Name-shaped typo of a feature": `{kind:"set", name:"colors", model:"off"}` fails with `not a provider/model`, `usage: true`, and no suggestions.
  - "New slot without when": the message contains `needs when` and how to write it; the file is unchanged.
  - "Missing when reported before an unknown model": the same `needs when` error for `fixture/unknown`.
  - "New slot appended": the result order is `bulk`, `reviewer`; other keys are deep-equal to the old ones; the message has the model and `when`.
  - "Ninth slot": the message contains `crew.slots`.
  - "Created from nothing": the file holds only `crew.slots`.
  - "Write error": read-only dir, the message has `EACCES`; `skipIf(process.getuid?.() === 0)`.
  - "Replace the model, keep when"; "Replace when"; "Position kept".
  - "Keyless model refused": message `no credentials`.
  - "Typo suggests the right model": message `not in the model registry` and a `Try:` line starting with `fixture/fixture-review`.
  - "Show": the message has the name, model and `when`; the file's bytes and mtime are unchanged.
  - "Show unknown" and "Remove unknown": the error names the slot, `usage: true`.
  - "Remove the last slot": no `crew` key; message `removed`.
  - "Add refused on an invalid file": the message names `classifier.timeoutMs`; bytes unchanged.
  - "Show refused on an invalid file": the message has `(file)`.
- [ ] **Step 3: Run** `bun test tests/host/slots.test.ts`. Expect FAIL.
- [ ] **Step 4: Implement** `parseSlotArgs`. Trim the text, then split off the first word.
  - First word `remove`: exactly one more valid name → `remove`; anything else → `"usage"`.
  - First word not matching the name pattern → `undefined`.
  - First word reserved → `undefined`. The existing parser then handles it: it runs a real form, or it prints usage.
  - One word → `show`.
  - Second word is the model.
  - Third word and the rest: apply the Contracts regex. A match without group 3 → `set` without `when`. A match with group 3 → `set` with it, trimmed. No match (a bare `when`, `whenever`, any other word) → `"usage"`.
- [ ] **Step 5: Implement** `runSlot`:
  1. Read the config; if invalid, return its problems with `path`, or `(file)` for the root.
  2. Find the slot by name.
  3. For `set`: if `splitModel(model)` fails, refuse with `not a provider/model` and `usage: true`. Then, if the slot is new and has no `when`, refuse with `needs when`. Then run `checkModel`; on failure, refuse with the reason and, for registry or auth failures, `nearestModels`. Then build the new list (replace in place, keeping the old `when`, or append) and call `writeSlots`.
  4. For `show` and `remove`: an unknown slot is an error with `usage: true`.
  - Messages: `slot <name>: <model>\nwhen: <when>` and `slot <name> removed`.
- [ ] **Step 6: Run** the tests. Expect PASS.
- [ ] **Step 7: Commit** `feat(slot-commands): add, show and remove slots`.

## Task 8: `/jev` dispatch and docs — implements 5.2, 6.1, 6.2

**Files:** Modify `src/host/commands.ts`, the docs listed in tasks 6.1; Test `tests/host/commands.test.ts`.

**Interfaces:** Consumes `parseSlotArgs`, `runSlot`.

- [ ] **Step 1: Write failing tests** in `tests/host/commands.test.ts`:
  - "Usage lists the slot forms": `usageText()` contains the three lines from Contracts.
  - "Unknown feature": `/jev Colors off` gives usage, with the existing behaviour kept.
  - "Name-shaped typo of a feature": `/jev colors off` gives an error notify that contains `not a provider/model` and the usage text.
  - "Print mode": `-p` with a valid add writes the file, and stdout is empty.
  - "Child session": a child id causes no notify and no write.
  - "Next launch sees the slot": after `runJev("reviewer fixture/fixture-review when …")`, a worker request built from a fresh snapshot offers `slot::reviewer`.
  - "Removed slot not offered" (Review Focus): after `remove`, the next request has no `slot::` option.
  - Update the existing tests: remove `"colors off"` from the `bad` list (it is now a slot form, covered above), and make "lists no later forms" check only that no line starts with `/jev tune`.
  - Test helpers: `fakeCtx` gains a fake `modelRegistry` (`find`, `hasConfiguredAuth`, `getAvailable`), and the snapshot loader in these tests reads `readConfig(dir)` instead of a fixed empty config.
  - The existing `/jev skills off` and `/jev mode premium` tests still pass.
- [ ] **Step 2: Run** `bun test tests/host/commands.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement.**
  - In `parseJevArgs`, try `parseSlotArgs` after the `cli-review` branch and before the one-word `reset` check. A defined result becomes `{kind:"slot", args}`, or `USAGE` for `"usage"`.
  - In `runJev`, handle `kind: "slot"` before the cli-review and change branches and return early, so `applyChange` stays exhaustive (add `"slot"` to the `Exclude` in `Change`). The branch calls `runSlot(args, ctx.modelRegistry, deps.dir)`:
    - On success, notify `info` with the message only.
    - On failure, notify `error` with the message, followed by `usageText()` when `usage`.
  - Usage lines go after `cli-review`.
- [ ] **Step 4: Run** `bun test tests/host`. Expect PASS.
- [ ] **Step 5: Docs.** Edit these files:
  - `docs/configuration.md`: the `when` row becomes "Yes", and the default sentence is dropped.
  - `docs/jev-questions.md`: drop the "Default `when`" paragraph.
  - `docs/usage-guide.md`:
    - make `when` required, with a good and a bad example;
    - drop the "(WG-13)" marks;
    - drop "slot commands (WG-13)" from the until-its-work-group sentence;
    - "Without one, the default…" becomes "A new slot needs `when`; replacing a model keeps it".
  - `docs/domain-model.md` WorkerDecision:
    - rule 3 below the bar: "continue with the offered tier of highest probability";
    - availability: "an unusable slot moves to `balanced`, then `fast`, never up".
  - `docs/architecture.md`: the slot row reads "`balanced`, then `fast`, with a warning naming `crew.slots "<name>" model`".
  - `docs/jev-contract.md`: unchanged unless it mentions a default `when`.
  - `docs/roadmap.md`: WG-13 becomes `Done`.
- [ ] **Step 6: Verify.** Run `bun run typecheck && bun run lint && bun run fmt:check && bun test`. Expect all exit 0. Run `openspec validate wg-13-slots --strict` and expect `is valid`.
- [ ] **Step 7: Commit** `feat(jev-command): slot forms; docs for WG-13`.

---

## Scenario → test

Baseline scenarios carried unchanged in MODIFIED blocks (85) keep their existing test of the same name in the same file: `tests/policy/{tier,route,effort}.test.ts`, `tests/jev/questions.test.ts`, `tests/host/{worker,worker-routing,worker-ledger,commands}.test.ts`, `tests/store/config-{read,write}.test.ts`. Each one must still pass after its task. New scenarios:

**config-file**
- Slot without when → Task 1, `tests/store/config-read.test.ts`
- Slot writer refuses a slot without when → Task 1, `tests/store/config-write.test.ts`

**worker-decision**
- Slot without the fast cap; Slot fell back to fast → Task 2, `tests/policy/effort.test.ts`
- Slot in every mode; Slot at the bar; Risk wins over a slot; Risk floor with only a slot; Two slots; Slot below the bar; Below the bar into unsure fast; Below the bar into expert denied; Slot not offered; Slot choice never passes the standard expert gate; Slot choice never passes the premium expert gate → Task 3, `tests/policy/tier.test.ts`
- Usable slot kept; Slot falls back to balanced; Slot falls back to fast; Slot never moves up → Task 4, `tests/policy/tier.test.ts`
- Slot written; Slot falls back with xhigh; Unusable slot alone; Slot below the bar with no tier; Slot alone with thinking locked; Model locked with a slot decided → Task 4, `tests/policy/route.test.ts`

**worker-request**
- Slots after tiers; No slot, request unchanged; Slot alone; Reviewer criterion; No display name; Same in every mode; Slot answer read; Main request with a slot configured → Task 5, `tests/jev/questions.test.ts`

**worker-routing**
- Forked launch with thinking asks fewer questions (with a slot configured); Slot display name; Unusable slot; Slot warning text; Once per slot; Slot warning with nothing to fall back to; Slot warning shown again after its model changes; Slot warning shown again after a slot command → Task 6, `tests/host/worker.test.ts`
- Review launch on the reviewer slot; Background review launch; Unusable reviewer slot falls back; Jev down with a slot configured → Task 6, `tests/host/worker-routing.test.ts`

**worker-ledger**
- Slot decision recorded; Slot fallback recorded → Task 6, `tests/host/worker-ledger.test.ts`

**slot-commands**
- Add with when; Third word not when; Empty when; Reserved name; Remove with extra words → Task 7, `tests/host/slots.test.ts` (parse)
- New slot without when; Missing when reported before an unknown model; Bad model shape reported before missing when; New slot appended; Ninth slot; Created from nothing; Write error; Replace the model, keep when; Replace when; Position kept; Keyless model refused; Typo suggests the right model; Show; Show unknown; Remove the last slot; Remove unknown; Add refused on an invalid file; Show refused on an invalid file → Task 7, `tests/host/slots.test.ts` (run)
- Keyless model not suggested; No usable model at all → Task 5, `tests/host/models.test.ts`
- Name-shaped typo of a feature; Print mode; Child session; Next launch sees the slot → Task 8, `tests/host/commands.test.ts`

**jev-command**
- Usage lists the slot forms → Task 8, `tests/host/commands.test.ts`

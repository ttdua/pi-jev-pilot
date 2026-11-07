# WG-09 Skill Policy Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` (`skill-pick`, `main-effort`) and `design.md`.

**Goal:** Pure, offline building blocks for skill pick: criteria, batches, the skill questions, the pick rule, the delivery texts and the duplicate check.

**Architecture:** `src/policy/skill.ts` holds every rule and text builder, importing only `policy/` and `shared/`. `src/jev/rubrics.ts` holds the wording; `src/jev/questions.ts` builds wire questions and `QuestionSpec`s from one option list. Nothing is wired into Pi; `wg-09-skill-host` does that.

**Tech Stack:** TypeScript, Bun (`bun test`), oxlint boundary rules.

## Global Constraints

- `policy/` imports only itself and `shared/`; `jev/` never imports `host/`, `store/` or Pi (`.oxlintrc.json`).
- Tests need no secrets, paid calls or network beyond loopback.
- Wording is copied verbatim from `docs/jev-questions.md`, checked by test; the docs change lands first (Task 1).
- Probabilities decide; `confidence` and `choice` are never read for the pick (ADR 0002).
- Thresholds are named constants in `src/policy/skill.ts` with a comment naming their evidence (upstream jev-pilot 0.12.1, `docs/evidence/2026-11-05-replay.md` "Skill .5 and .3").
- Everything in the repository is English; relative imports use the `.ts` extension.
- `mainQuestions(o)` without `skills` must return exactly what it returns today (existing tests in `tests/jev/questions.test.ts` and `tests/host/main.test.ts` stay green unchanged).

## Review Focus

- A body whose 300th code point is an astral emoji must not leave a lone surrogate → "Surrogate pairs are not split" in Task 2.
- A skill literally named `(none)`, or a repeated name, must not create a duplicate option key → "Skill named none" and "Repeated name" in Task 2.
- A probability map with keys in an unexpected order must not change the leader: ties resolve by the asked option order, not by object key order → "Tie within a batch" in Task 3 passes the probabilities in reverse key order.
- A path or body containing `$&`, `$1` or `</skill>` must appear unchanged → "Special characters in a path" in Task 4, which also puts `$&` in the body.
- A Jev answer for a later batch whose options differ from what was asked must count as a failed batch → "Unreadable which" in Task 3 uses a `ReadResult` where `which` is unanswered.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `SkillEntry` (`src/policy/skill.ts`) | new | `{ name: string; description?: string; body?: string }` — body already without frontmatter | no |
| `skillCriterion(entry: SkillEntry): string` | new | See spec "Skill criterion" | no |
| `MAX_BATCH`, `skillBatches(entries: readonly SkillEntry[]): SkillEntry[][]` | new | `MAX_BATCH = 254` | no |
| `NONE_OPTION` (`src/policy/skill.ts`) | new | `"(none)"` | no |
| `GATE_KEYS`, `GateKey` | new | `["gate::acts_on_user_system", "gate::would_follow_documented_procedure", "gate::prose_suffices"] as const` | no |
| `SURE_PICK`, `FIT_PICK`, `GATE_PICK` | new | `.5`, `.3`, `.3` | no |
| `batchLeader(options: readonly string[], answer: ChoiceAnswer): { name: string; p: number } \| undefined` | new | `undefined` when `(none)` leads | no |
| `gateMean(answers: Record<string, Answer>): number \| undefined` | new | Mean over read gates, `prose_suffices` as `1 - p` | no |
| `SkillPick` | new | `{ kind: "picked"; name: string; p: number; gate?: number } \| { kind: "none"; reason: "below"; p: number; gate?: number } \| { kind: "none"; reason: "none-leads"; gate?: number } \| { kind: "none"; reason: "no-batch" \| "failed" }` | no |
| `pickSkill(batches: readonly { options: readonly string[]; read: ReadResult \| undefined }[]): SkillPick` | new | Batch 0's `read` supplies the gates; `read` undefined means the request failed | no |
| `DeliveryForm`, `deliveryForm(o: { name: string; fingerprint: string; inject: "content" \| "suggest"; loaded: readonly { name: string; fingerprint: string }[] }): DeliveryForm` | new | `"content" \| "suggest" \| "reference"` | no |
| `deliveryText(form: DeliveryForm, skill: { name: string; path: string; baseDir: string; body: string }): string` | new | Templates below | no |
| `BareNoulQuestion` (`src/jev/rubrics.ts`) | new | `{ type: "noul"; instructions: string }` | no |
| `WHICH_INSTRUCTION`, `NONE_CRITERION`, `GATE_QUESTIONS: Record<GateKey, BareNoulQuestion>` | new | Verbatim from docs | no |
| `MainQuestions` (`src/jev/questions.ts`) | unchanged | `{ wire: Record<string, WireQuestion>; specs: Record<string, QuestionSpec> }` | no |
| `SkillQuestions` (`src/jev/questions.ts`) | new | `{ wire: Record<string, WireQuestion \| BareNoulQuestion>; specs: Record<string, QuestionSpec> }` | no |
| `mainQuestions` overloads | modified | `(o: { askEffort: boolean; skills?: undefined }): MainQuestions`; `(o: { askEffort: boolean; skills: readonly SkillEntry[] }): SkillQuestions`. `skills` = first batch, non-empty; appends `which` then the gates. An empty array is treated as not asked and returns the same as `undefined` | no |
| `skillBatchQuestions(batch: readonly SkillEntry[]): MainQuestions` | new | `which` only (a choice, so the narrow type holds) | no |
| Delivery texts in `docs/jev-questions.md` | new | File format of model-visible text; templates below | yes |

Delivery templates (`<…>` are inserted verbatim; lines joined with `\n`):

```text
<skill_relevance>
Relevant to the current request: <name>. Ignore this if it does not fit what the user actually asked for.
<skill name="<name>" location="<path>">
References are relative to <baseDir>.

<body>
</skill>
</skill_relevance>
```

```text
<skill_relevance>
Relevant to the current request: <name>. Ignore this if it does not fit what the user actually asked for.
Its instructions are in <path>, with references relative to <baseDir>. Read that file before you start if the skill fits.
</skill_relevance>
```

```text
<skill_relevance>
Relevant to the current request: <name>. Ignore this if it does not fit what the user actually asked for.
Skill <name> is already loaded above; its instructions are unchanged.
</skill_relevance>
```

No config key, CLI argument, ledger field or state file changes.

---

## Task 1: Docs — implements 1.1, 1.2

**Files:** Modify `docs/jev-questions.md` (Wire format; `which`; Skill gates; new "### Skill delivery" under "Text added to the model's context"), `docs/jev-contract.md` ("Main questions", "Skill pick"), `docs/roadmap.md` (WG-09).

- [ ] **Step 1:** In `docs/jev-questions.md` "Wire format", add: the three skill gates are sent with `instructions` only, as upstream measured them; the instruction sent is the table cell without the trailing "Inverted when averaged." note.
- [ ] **Step 2:** Add "### Skill delivery" with the three templates above. Each is a line `**\`content\`**` (resp. `suggest`, `reference`), a blank line, then a ```` ```text ```` fence holding the template exactly. In the `which` section change "first 300 characters of the body" to "first 300 code points of the body".
- [ ] **Step 3a:** In `docs/jev-contract.md` "Main questions": the first batch's request carries `which` and the three gates; each later batch carries only its `which`; the gates are sent as `type` and `instructions` only.
- [ ] **Step 3:** In `docs/jev-contract.md` "Skill pick": criterion fallback (trimmed; empty counts as absent); batches of at most 254 skills plus `(none)`, as few as fit, near-equal, catalog order, first of a repeated name, no skill named `(none)`; step 1 reworded to "Take each batch's leader by probability; a batch led by `(none)` is ignored. Then the highest leader; ties go to the earlier option or batch"; gate mean over the gates read, absent with none read, then only the .5 rule; duplicate rule "same name and same body fingerprint in context since the latest compaction".
- [ ] **Step 4:** In `docs/roadmap.md` WG-09 add: "Ships as two changes: `wg-09-skill-policy` (criteria, batches, questions, pick, delivery text, duplicate check) and `wg-09-skill-host` (catalog, eligibility, `/skill:name` skip, hidden message, ledger, host test)."
- [ ] **Step 5:** `bun run fmt:check` passes. Commit `docs(skill-pick): wording and rules for skill pick and delivery`.

---

## Task 2: Criteria and batches — implements 2.1

**Files:** Create `src/policy/skill.ts`, `tests/policy/skill.test.ts`.

**Interfaces:** Produces `SkillEntry`, `skillCriterion`, `MAX_BATCH`, `NONE_OPTION`, `skillBatches`. Consumes `cutCodePoints` (`src/shared/text.ts`).

- [ ] **Step 1: Failing tests** in `describe("skillCriterion")`:
  - "Description and body": `{ name: "debug", description: " Debug failures ", body: "x".repeat(400) }` → `"Debug failures — " + "x".repeat(300)`.
  - "Body only", "Description only", "Neither" (`"A skill named notes."`), "Whitespace-only description" (`"   "` → body excerpt alone).
  - "Surrogate pairs are not split": body `"a".repeat(299) + "😀" + "tail"` → excerpt ends with `"😀"`, length in code points 300, no lone surrogate (`/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/` does not match).
  In `describe("skillBatches")`, with `n` entries named `s0…s{n-1}`: 78 → `[78]`; 254 → `[254]`; 255 → `[128, 127]`; 302 → `[151, 151]`; 509 → `[170, 170, 169]`; 0 → `[]`; order preserved; "Repeated name" (two `review`, the first kept); "Skill named none" (`(none)` dropped).
- [ ] **Step 2:** `bun test tests/policy/skill.test.ts` fails (module missing).
- [ ] **Step 3:** Implement in `src/policy/skill.ts`. Separator is ` — ` (space, U+2014, space). Batching: dedupe and drop `NONE_OPTION` first, then `count = ceil(n / MAX_BATCH)`, `size = ceil(n / count)`.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `feat(skill-pick): criteria and batches`.

---

## Task 3: Leader, gate mean and pick — implements 2.2

**Files:** Modify `src/policy/skill.ts`, `tests/policy/skill.test.ts`.

**Interfaces:** Produces `GATE_KEYS`, `GateKey`, `SURE_PICK`, `FIT_PICK`, `GATE_PICK`, `batchLeader`, `gateMean`, `SkillPick`, `pickSkill`. Consumes `Answer`, `ChoiceAnswer`, `ReadResult` (`src/policy/answers.ts`).

- [ ] **Step 1: Failing tests**, with a helper `choice(probs)` building a `ChoiceAnswer` and `read(answers, unanswered?)` building a `ReadResult`:
  - `batchLeader`: "Leader is a skill" (`debug` .6 → `{ name: "debug", p: .6 }`); "Leader is none" (`debug` .3, `(none)` .7 → `undefined`); "Tie within a batch" (options `["debug","plan","(none)"]`, probabilities given as `{ "(none)": .2, plan: .4, debug: .4 }` → `debug`); "Choice field ignored" (`choice: "plan"`, `debug` highest → `debug`).
  - `gateMean`: "All gates" (.8, .9, `prose_suffices` .1 → `toBeCloseTo(0.8667, 4)`); "One gate missing" (.6 and `prose_suffices` .2 → `toBeCloseTo(0.7, 10)`); "No gate" → `undefined`.
  - `pickSkill`: "Sure pick" (.5, gate .1 → picked); "Gate supports a weaker pick" (.3, gate .3 → picked); "Gate too low" (.45, gate .29 → `{ kind: "none", reason: "below", p: .45, gate: ≈.29 }`); "Probability too low" (.29, gate .9 → none); "No gate and a weaker pick" (.4, no gates → none, `gate` absent); "Every batch led by none" (`reason: "none-leads"`, no `p`); "No batch" (`[]` → `reason: "no-batch"`, no `p`, no `gate`); "Best across batches" (batch 1 `plan` .55, batch 2 `deploy` .7 → `deploy`); "Tie across batches" (both .6 → batch 1's); "Jev failure on a later batch" (batch 2 `read` undefined → `{ kind: "none", reason: "failed" }`); "Unreadable which" (`read` with `which` in `unanswered` → failed).
  For the .3 boundary read `acts_on_user_system` .3 and `would_follow_documented_procedure` .3 only (mean exactly .3), and assert only `kind: "picked"`; avoid `1 - .7`, which is `0.30000000000000004`.
- [ ] **Step 2:** Tests fail.
- [ ] **Step 3:** Implement. Leader: walk `options` in asked order, keep the first with the strict maximum. `pickSkill`: any batch with `read` undefined, `kind: "miss"`, or no `which` choice answer → failed; otherwise leaders, best by strict maximum in batch order; gate mean from batch 0's answers. Comment each threshold with its evidence.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `feat(skill-pick): batch leader, gate mean and pick rule`.

---

## Task 4: Delivery form and text — implements 2.3

**Files:** Modify `src/policy/skill.ts`, `tests/policy/skill.test.ts`.

**Interfaces:** Produces `DeliveryForm`, `deliveryForm`, `deliveryText`.

- [ ] **Step 1: Failing tests**:
  - `deliveryForm`: "First pick on the branch" (`content`, `[]` → `content`); "Same body already in context" (→ `reference`); "Skill edited since" (same name, other fingerprint → configured); "Suggest configured" (→ `suggest`); "Another skill in context" (only `plan` → configured).
  - `deliveryText`: for `{ name: "debug", path: "/s/debug/SKILL.md", baseDir: "/s/debug", body: "Step one." }`, each form equals the template extracted from `docs/jev-questions.md` "### Skill delivery" (read the file, take the first ```` ```text ```` fence after the line `**\`<form>\`**`, substitute `<name>`, `<path>`, `<baseDir>` and then `<body>` last, each by `split/join`). "Content form" also asserts `Step one.` occurs once; "Suggest form" asserts no body; "Reference form" asserts no path. "Special characters in a path": path `/s/$&/$1/SKILL.md` and body `cost $& more` appear unchanged.
- [ ] **Step 2:** Tests fail.
- [ ] **Step 3:** Implement with array `join("\n")`; no `String.replace` with patterns.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `feat(skill-pick): delivery form and text`.

---

## Task 5: Skill wording — implements 3.1

**Files:** Modify `src/jev/rubrics.ts`, `tests/jev/questions.test.ts`.

**Interfaces:** Produces `BareNoulQuestion`, `WHICH_INSTRUCTION`, `NONE_CRITERION`, `GATE_QUESTIONS`. Consumes `GateKey` (Task 3).

- [ ] **Step 1: Failing tests** in `describe("Skill wording")`: `WHICH_INSTRUCTION` and `NONE_CRITERION` appear verbatim in the docs (the `which` blockquote and the `(none)` blockquote); for each `GATE_KEYS` key, `GATE_QUESTIONS[key]` has exactly the keys `type`, `instructions`, `type` is `noul`, and the docs row `` | `<key>` | <instructions>`` is present (for `prose_suffices` the row continues with ` Inverted when averaged. |`).
- [ ] **Step 2:** Tests fail.
- [ ] **Step 3:** Add the constants, text copied from the docs.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `feat(skill-pick): which and gate wording`.

---

## Task 6: Skill questions — implements 3.2

**Files:** Modify `src/jev/questions.ts`, `tests/jev/questions.test.ts`.

**Interfaces:** Consumes `SkillEntry`, `skillCriterion`, `NONE_OPTION`, `GATE_KEYS` (Tasks 2–3), `WHICH_INSTRUCTION`, `NONE_CRITERION`, `GATE_QUESTIONS` (Task 5). Produces the `mainQuestions` overloads, `SkillQuestions` and `skillBatchQuestions` (Contracts).

- [ ] **Step 1: Failing tests**: "First batch with effort" (keys in the order of the spec); "First batch without effort" (`corrects`, `which`, three gates); "Which option order" (`debug`, `plan`, `review` → criteria keys and `specs.which.options` both `["debug","plan","review","(none)"]`, criteria values from `skillCriterion`, `(none)` → `NONE_CRITERION`); "Later batch" (`skillBatchQuestions` keys `["which"]`); "Skills not asked" (`mainQuestions({ askEffort })` deep-equals a snapshot built from the existing constants for both `askEffort` values, and `skills: undefined` and `skills: []` change nothing); "Skill gate shape" (each gate wire has keys `type`, `instructions` only, spec `{ type: "noul" }`); gates and `which` are fresh copies per call (mutation does not leak).
- [ ] **Step 2:** Tests fail.
- [ ] **Step 3:** Implement with the two overloads in Contracts; existing tests reading `.criteria` on `mainQuestions({ askEffort })` keep typechecking because that overload returns `MainQuestions`. Build `which` criteria and `options` from one list. Copy each gate object per call.
- [ ] **Step 4:** `bun test` and `bun run typecheck` pass, including `tests/jev/questions.test.ts` and `tests/host/main.test.ts` unchanged.
- [ ] **Step 5:** Commit `feat(skill-pick): skill questions in the main request`.

---

## Task 7: Final check — implements 4.1

- [ ] **Step 1:** Confirm `docs/architecture.md` lists `policy/skill.ts` as "Skill pick from choice and gate answers"; extend it to "Skill criteria, batches, pick, delivery text and duplicate check".
- [ ] **Step 2:** Run `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun test`; all pass. Lint passing covers "Lint boundaries".
- [ ] **Step 3:** Commit `docs(architecture): skill policy module` if Step 1 changed anything.

---

## Scenario → test

skill-pick:
- Description and body → `tests/policy/skill.test.ts` skillCriterion "Description and body" (Task 2)
- Body only → skillCriterion "Body only" (Task 2)
- Description only → skillCriterion "Description only" (Task 2)
- Neither → skillCriterion "Neither" (Task 2)
- Whitespace-only description → skillCriterion "Whitespace-only description" (Task 2)
- Surrogate pairs are not split → skillCriterion "Surrogate pairs are not split" (Task 2)
- Small catalog, Exactly 254, Just over the limit, Near-equal split, Three batches, Empty catalog, Repeated name, Skill named none → skillBatches tests of the same names (Task 2)
- First batch with effort, First batch without effort, Later batch, Skills not asked → `tests/jev/questions.test.ts` (Task 6)
- Which option order → `tests/jev/questions.test.ts` "Which option order" (Task 6)
- Wording matches the docs → `tests/jev/questions.test.ts` "Skill wording" (Task 5)
- Leader is a skill, Leader is none, Tie within a batch, Choice field ignored → batchLeader tests (Task 3)
- Best across batches → pickSkill "Best across batches" (Task 3)
- All gates, One gate missing, No gate → gateMean tests (Task 3)
- Sure pick, Gate supports a weaker pick, Gate too low, Probability too low, No gate and a weaker pick, Every batch led by none, No batch, Jev failure on a later batch, Unreadable which → pickSkill tests of the same names (Task 3)
- Content form, Suggest form, Reference form, Special characters in a path → deliveryText tests (Task 4)
- First pick on the branch, Same body already in context, Skill edited since, Suggest configured, Another skill in context → deliveryForm tests (Task 4)
- Lint boundaries → `bun run lint` (Task 7) and `tests/boundaries.test.ts`

main-effort:
- Choice shape, Noul shape → existing `tests/jev/questions.test.ts` (unchanged)
- Skill gate shape → `tests/jev/questions.test.ts` "Skill gate shape" (Task 6)

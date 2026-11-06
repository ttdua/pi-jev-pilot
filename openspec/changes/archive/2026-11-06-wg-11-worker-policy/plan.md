# WG-11 Worker Policy Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` (`agent-metadata`, `worker-request`, `worker-decision`) and `design.md`.

**Goal:** Pure, offline building blocks for worker routing: agent facts, the worker request, the tier decision, the fallback choice and worker effort.

**Architecture:** `policy/` holds the pure rules and the plain types (`AgentFacts`, `WorkerAnswers`, `TierName`). `jev/` builds state and questions from plain inputs and imports only `policy/` and `shared/`. `host/agents.ts` is the only file that reads disk or imports Pi (`parseFrontmatter`). Nothing is wired into Pi events; `wg-11-worker-host` does that.

**Tech Stack:** TypeScript, Bun (`bun test`), oxlint boundary rules, `@earendil-works/pi-coding-agent` 1.5.0 (`parseFrontmatter`, `getAgentDir` not used: the caller passes `agentDir`).

## Global Constraints

- `policy/` imports only itself and `shared/`; `jev/` never imports `host/`, `store/` or Pi; only `host/` imports Pi (`.oxlintrc.json`).
- Tests need no secrets, paid calls or network beyond loopback.
- Wording is copied verbatim from `docs/jev-questions.md`; a change in wording needs a replay.
- The agent's `model` and `thinking` values never enter `AgentFacts` or the worker state.
- Probabilities decide; `confidence` is never read.
- Everything in the repository is English.
- Relative imports in `src/` and `tests/` use the `.ts` extension, as existing files do.
- `TierName` and `EffortLevel` in `policy/` intentionally duplicate `store/` literals; a test keeps them equal.

## Review Focus

- A `subagent_type` containing `/`, `\` or `..` must not read outside the agents directories → test "Path-like type" in Task 2.
- A body or brief ending in an emoji at the cut point must not produce a lone surrogate → tests "Long body" (Task 2) and "Brief at the limit" (Task 4) use code points.
- Frontmatter that `parseFrontmatter` throws on must not throw out of the reader → test "Malformed frontmatter skipped" in Task 2.
- A Jev answer whose `tier` option set differs from what was offered must be unanswered, not trusted → covered by "Asked and accepted agree" (Task 3) and `readAnswers` (Task 5).
- With only `expert` configured, an unadmitted `expert` choice must not slip through as `choice` → test "Only expert offered and denied" in Task 6.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `TierName` (`src/policy/launch.ts`) | new | `"fast" \| "balanced" \| "deep" \| "expert"`; `TIER_LADDER: readonly TierName[] = ["fast","balanced","deep","expert"]` | no |
| `LOCKABLE_FIELDS`, `LockableField`, `LockDeclaration` (`src/policy/launch.ts`) | new | `LOCKABLE_FIELDS = ["model","thinking","max_turns","inherit_context","run_in_background"] as const`; `LockableField = (typeof LOCKABLE_FIELDS)[number]`; `LockDeclaration = true \| readonly LockableField[]`. Deviation (apply, final review): `LOCKABLE_FIELDS` added so `host/agents.ts` reuses one list instead of duplicating the union | no |
| `AgentFacts` (`src/policy/launch.ts`) | new | `{ name: string; source: "project" \| "global" \| "builtin"; description: string; instructionsExcerpt: string; declaredTools: string[] \| null; maxTurns: number \| null; runInBackground?: boolean; inheritContext?: boolean; locked?: LockDeclaration; sets: { model: boolean; thinking: boolean } }` | no |
| `isFieldLocked(facts: AgentFacts, field: LockableField): boolean` | new | `src/policy/launch.ts` | no |
| `effectiveLaunch(input: Record<string, unknown>, facts: AgentFacts): EffectiveLaunch` | new | `EffectiveLaunch = { resume: boolean; inheritContext: boolean; runInBackground: boolean; modelLocked: boolean; thinkingLocked: boolean }` | no |
| `cutCodePoints(text: string, max: number): string` (`src/shared/text.ts`) | new | First `max` code points | no |
| `readAgent(name: unknown, dirs: { cwd: string; agentDir: string }): AgentFacts` (`src/host/agents.ts`) | new | Never throws; a non-string name resolves to `general-purpose` | no |
| `BUILTIN_AGENTS: ReadonlyMap<string, AgentFacts>` (`src/host/agents.ts`) | new | Keys `general-purpose`, `Explore`, `Plan` | no |
| `STANDARD_TIER_CRITERIA`, `TIER_INSTRUCTION`, `WORKER_EFFORT_QUESTION`, `RISKY_QUESTION`, `EXPERT_NEEDED_QUESTION` (`src/jev/rubrics.ts`) | new | `{ type, instructions, criteria: Record<string,string> }` per question; `STANDARD_TIER_CRITERIA: Record<TierName,string>` | no |
| `offeredTiers(tiers: Partial<Record<TierName,string>>, expertOn: boolean): TierName[]` (`src/jev/questions.ts`) | new | Ladder order | no |
| `buildWorkerQuestions(offered: readonly TierName[], displayNames: Partial<Record<TierName,string>>): { questions: Record<string, WireQuestion>; specs: Record<string, QuestionSpec> }` | new | `WireQuestion = { type: "choice" \| "noul"; instructions: string; criteria: Record<string,string> }`. Deviation (apply, final review): `WireQuestion` is declared in `src/jev/rubrics.ts` and re-exported from `src/jev/questions.ts`, replacing an identical `RubricQuestion` | no |
| `buildWorkerState(input: WorkerStateInput): WorkerState` (`src/jev/state.ts`) | new | `WorkerStateInput = { brief: string; description?: string; agent: AgentFacts; runInBackground: boolean; parentRequest?: string }` (no model or thinking field by construction); `WorkerState = { task: { brief: string; description: string }; agent: { name: string; source: AgentFacts["source"]; description: string; instructions_excerpt: string; declared_tools: string[] \| null; max_turns: number \| null; run_in_background: boolean }; parent_request?: string }` | no |
| `WorkerAnswers` (`src/policy/worker.ts`) | new | `{ kind: "read"; answers: Record<string, Answer>; unanswered: Record<string, UnansweredReason> } \| { kind: "miss"; miss: MissKind } \| { kind: "cancelled" }` | no |
| `readWorkerOutcome(outcome: WorkerOutcome, specs: Record<string, QuestionSpec>): WorkerAnswers` | new | `WorkerOutcome` structurally equal to `JevOutcome` (`{kind:"ok";body:unknown} \| {kind:"miss";miss:MissKind} \| {kind:"cancelled"}`), declared in policy so it does not import `jev/` | no |
| `TierDecision` (`src/policy/tier.ts`) | new | `{ kind: "decided"; tier: TierName; reason: "fable" \| "risky" \| "expert-denied" \| "fast-unsure" \| "choice" } \| { kind: "none"; reason?: "miss" }` | no |
| `decideTier(answers: WorkerAnswers, offered: readonly TierName[]): TierDecision` | new | | no |
| `chooseFallback(tier: TierName, offered: readonly TierName[], canRun: (t: TierName) => boolean): FallbackResult` | new | `{ kind: "keep"; tier } \| { kind: "moved"; tier; from: TierName } \| { kind: "unchanged" }` | no |
| `workerEffort(input: { effort?: ChoiceAnswer; risky?: number; tier?: TierName; movedByFallback: boolean }): EffortLevel \| undefined` (`src/policy/effort.ts`) | new | `EffortLevel = "low" \| "medium" \| "high" \| "xhigh" \| "max"` | no |

No config key, CLI argument or file format changes.

---

## Task 1: Lock and effective launch fields — implements 1.1

**Files:** Create `src/policy/launch.ts`, `tests/policy/launch.test.ts`.

**Interfaces:** Produces `TierName`, `TIER_LADDER`, `LockableField`, `LockDeclaration`, `AgentFacts`, `isFieldLocked`, `effectiveLaunch`, `EffectiveLaunch`.

- [ ] **Step 1: Write failing tests** in `tests/policy/launch.test.ts`, one `test` per scenario under `describe("Locked fields")` and `describe("Effective launch fields")`. Build facts with a local `facts(overrides)` helper (`source: "project"`, `sets: { model: false, thinking: false }`). Assertions:
  - `locked: true`, `sets.model: true`, `sets.thinking: false` → `isFieldLocked(f,"model")` true, `"thinking"` false.
  - `locked: ["thinking"]`, `sets.thinking: false` → `"thinking"` true.
  - Input `{}`, facts `inheritContext: true` → `effectiveLaunch(...).inheritContext` true.
  - Input `{ inherit_context: false }`, facts `inheritContext: true`, no lock → false.
  - Input `{ inherit_context: false }`, facts `inheritContext: true`, `locked: ["inherit_context"]` → true.
  - Input `{ resume: "agent-12" }` → `resume` true; `{ resume: "" }` → false.
  - `modelLocked`/`thinkingLocked` mirror `isFieldLocked`.
- [ ] **Step 2: Run** `bun test tests/policy/launch.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `src/policy/launch.ts`. For `inherit_context`/`run_in_background`/`max_turns`, "the agent sets the field" means the facts value is not `undefined`/`null`; for `model`/`thinking` it is `sets.model`/`sets.thinking`. Effective value: input boolean when not locked, else facts value, else `false`.
- [ ] **Step 4: Run** the test → PASS; `bun run lint` → no boundary errors.
- [ ] **Step 5: Commit** `feat(policy): effective launch fields and locks`.

## Task 2: Agent reader and built-ins — implements 1.2

**Files:** Create `src/shared/text.ts`, `src/host/agents.ts`, `tests/shared/text.test.ts`, `tests/host/agents.test.ts`.

**Interfaces:** Consumes `AgentFacts`, `LockDeclaration`, `LockableField` (Task 1). Produces `cutCodePoints`, `readAgent`, `BUILTIN_AGENTS`.

- [ ] **Step 1: Write failing tests.** `tests/shared/text.test.ts`: `cutCodePoints("ab😀c", 3)` is `"ab😀"`; a string shorter than `max` is returned whole. `tests/host/agents.test.ts`: create `cwd` and `agentDir` with `tempDir()` from `tests/helpers.ts`, write files under `cwd/.pi/agents/` and `agentDir/agents/`, one `test` per scenario of the agent-metadata spec, named exactly as the scenario. Key assertions:
  - Precedence and `source` for project/global/built-in; `Explore.md` project file overrides the built-in.
  - `Worker.md` found for `worker`; `does-not-exist` → `name: "general-purpose"`, `source: "builtin"`.
  - Unreadable file: create a directory named `cwd/.pi/agents/worker.md` (reading it throws `EISDIR`) plus a global `worker.md` → global agent returned.
  - `explore.md` in the project and request `EXPLORE` → built-in `Explore` (executor's case-insensitive order).
  - `readAgent(42, dirs)` → `general-purpose`.
  - Frontmatter `---\nfoo\n---\nbody` (not a mapping) → fields read as empty, description is the name.
  - No frontmatter, body starting with `\n\n` → excerpt starts with the first non-blank character.
  - `thinking: banana` → `sets.thinking` false.
  - `locked: [colour]` and `locked: false` → `locked` undefined; `locked: "model, thinking"` → `["model","thinking"]`.
  - Built-in `Explore` and `Plan` have `inheritContext`, `runInBackground`, `locked` undefined and `maxTurns` null.
  - Malformed frontmatter (`---\ntools: [unclosed\n---\n`) → `general-purpose`, no throw.
  - Path-like: write `secret.md` in `cwd` and request `../../secret` → `general-purpose`.
  - No agents directories, `Plan` → built-in `Plan`, declared tools `["read","bash","grep","find","ls"]`.
  - `Explore` built-in description `Fast codebase exploration agent (read-only)`, excerpt `""`; `general-purpose` `declaredTools` `null`.
  - `tools: read, grep` → `["read","grep"]`; `tools: none` → `[]`.
  - Body of 2000 characters → excerpt length 500.
  - `model`/`thinking` set → `JSON.stringify(facts)` contains neither value; `sets` both true.
  - `inherit_context: "yes"` → `inheritContext` false; `max_turns: "5"` → `maxTurns` null.
  - `locked: true` → `true`; `locked: [model, colour]` → `["model"]`.
- [ ] **Step 2: Run** `bun test tests/shared/text.test.ts tests/host/agents.test.ts` → FAIL.
- [ ] **Step 3: Implement** `cutCodePoints` with `Array.from(text).slice(0, max).join("")`. Implement `readAgent`: for each directory, `readdirSync` filtered to `.md` and sorted (catch → empty), map base name → path. Exact name: project → global → `BUILTIN_AGENTS`. Case-insensitive pass: build the executor's key order (built-in names, then sorted global names not already present, then sorted project names not already present), take the first key equal ignoring case, and resolve that key with the exact precedence. Non-string name or no match → `general-purpose`. A frontmatter value that is not a plain object is treated as `{}`. `instructionsExcerpt` is `cutCodePoints(body.trim(), 500)`. `sets.model` is `typeof fm.model === "string"`; `sets.thinking` is membership in `off, minimal, low, medium, high, xhigh, max`. Read and parse each candidate inside `try`; on any error treat as absent and continue. Field parsing mirrors the executor (`custom-agents.ts` 25.0.5): `description` string else name; list fields from array or comma-split string, `none`/empty → `[]`; `max_turns` a `number >= 0`; flags `!= null ? value === true : undefined`; `locked` per `lockDeclaration`. Built-in descriptions are copied from the executor's `default-agents.ts`; built-ins have `sets` both false, except `Explore`, whose `sets.model` is true (it declares a model), so a whole-file lock rule stays correct if one is added.
- [ ] **Step 4: Run** the tests → PASS.
- [ ] **Step 5: Commit** `feat(host): agent metadata reader`.

## Task 3: Rubrics and worker questions — implements 2.1, 2.2

**Files:** Create `src/jev/rubrics.ts`, `src/jev/questions.ts`, `tests/jev/questions.test.ts`.

**Interfaces:** Consumes `TierName`, `TIER_LADDER` (Task 1), `QuestionSpec` (`src/policy/answers.ts`). Produces the rubric constants, `offeredTiers`, `buildWorkerQuestions`, `WireQuestion`.

- [ ] **Step 1: Write failing tests**, one per scenario of Offered tiers, Worker questions and Question wording:
  - `offeredTiers({fast:"a/b",deep:"c/d"}, true)` → `["fast","deep"]`; all four with `expertOn` false → `["fast","balanced","deep"]`.
  - No tier → question keys exactly `["effort","risky"]`.
  - Expert offered → keys `tier, effort, risky, expert_needed`; `Object.keys(questions.tier.criteria).at(-1)` is `"expert"`.
  - Display name `Claude Haiku 5.5` → `criteria.fast` starts with `"Claude Haiku 5.5. Fast and low cost"`; missing name → `criteria.balanced === STANDARD_TIER_CRITERIA.balanced`.
  - Offered `fast`,`deep` → `Object.keys(questions.tier.criteria)` equals `specs.tier.options`.
  - "Wording matches the docs": read `docs/jev-questions.md`, and assert each constant's instruction and every criterion appears verbatim in the file (`expect(doc).toContain(text)`), and that `effort.instructions` equals the "Worker instruction" quote.
- [ ] **Step 2: Run** `bun test tests/jev/questions.test.ts` → FAIL.
- [ ] **Step 3: Implement.** `rubrics.ts`: `TIER_INSTRUCTION` = "Which is the cheapest tier that can complete this coding task well?"; `STANDARD_TIER_CRITERIA` from the `standard` table; `WORKER_EFFORT_QUESTION` (choice, worker instruction, five level criteria keyed `low`…`max`); `RISKY_QUESTION` and `EXPERT_NEEDED_QUESTION` (noul, `budget`/`standard` wording, `true`/`false` criteria). `buildWorkerQuestions`: `tier` only when `offered.length > 0`, criteria in ladder order, prefix `"<name>. "` when a display name exists; `expert_needed` only when `offered` includes `expert`; specs: `tier` choice over `offered`, `effort` choice over the five levels, nouls for `risky`, `expert_needed`.
- [ ] **Step 4: Run** → PASS; `bun run lint` → no boundary errors.
- [ ] **Step 5: Commit** `feat(jev): worker questions and standard rubric`.

## Task 4: Worker state — implements 2.3

**Files:** Create `src/jev/state.ts`, `tests/jev/state.test.ts`.

**Interfaces:** Consumes `AgentFacts` (Task 1), `cutCodePoints` (Task 2). Produces `buildWorkerState`, `WorkerStateInput`, `WorkerState`.

- [ ] **Step 1: Write failing tests**, one per scenario of Worker state shape and Worker state text limits:
  - Sorted top-level keys `["agent","task"]` without parent request; `parent_request` present and 500 code points long when given 800.
  - Agent block keys exactly `name, source, description, instructions_excerpt, declared_tools, max_turns, run_in_background`; `run_in_background` equals `input.runInBackground`.
  - Brief 6000 → 4000; exactly 4000 → whole; 3999 `a` + `"😀😀"` (4001 code points) → 4000 code points, ends with `"😀"`.
  - "No model in state": `WorkerStateInput` has no model or thinking field, so the caller's values cannot be passed; use facts with `sets` both true, read from a file with `model: anthropic/claude-opus` and `thinking: high` via `readAgent`, and assert `JSON.stringify(state)` contains neither `claude-opus` nor a `model`/`thinking` key.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `buildWorkerState`; `description` defaults to `""`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(jev): worker state`.

## Task 5: Reading worker outcomes — implements 2.4

**Files:** Create `src/policy/worker.ts`, `tests/policy/worker.test.ts`.

**Interfaces:** Consumes `readAnswers`, `QuestionSpec`, `MissKind` (`src/policy/answers.ts`). Produces `WorkerAnswers`, `WorkerOutcome`, `readWorkerOutcome`.

- [ ] **Step 1: Write failing tests** for Reading worker answers: `timeout` and `error` misses → `{kind:"miss", miss}`; `ok` with `{"model":"jev-1.14.0"}` → `{kind:"miss", miss:"schema"}`; valid `tier` with `effort.choice` `"extreme"` → `tier` answered, `unanswered.effort === "choice"`; `cancelled` → `{kind:"cancelled"}`. Also prove `JevOutcome` is assignable to `WorkerOutcome`: `import type { JevOutcome } from "../../src/jev/client.ts"`, declare `const o: JevOutcome = { kind: "miss", miss: "timeout", reason: "t", ms: 1 }` and call `readWorkerOutcome(o, specs)`; `bun run typecheck` covers `tests/`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `readWorkerOutcome` as a switch on `kind`, delegating `ok` bodies to `readAnswers`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(policy): read worker outcomes`.

## Task 6: Tier decision and fallback — implements 3.1, 3.2

**Files:** Create `src/policy/tier.ts`, `tests/policy/tier.test.ts`.

**Interfaces:** Consumes `WorkerAnswers` (Task 5), `TierName`, `TIER_LADDER` (Task 1). Produces `TierDecision`, `decideTier`, `FallbackResult`, `chooseFallback`.

- [ ] **Step 1: Write failing tests** as tables, one row per scenario of Decision order, Fable rule, Risk floor rule, Expert denied rule, Unsure fast rule, Partial answers in the decision, Rules without a qualifying tier, Decision on Jev failure and Fallback choice. A helper `answers({ tier?: [choice, probs], risky?, expertNeeded? })` builds a `read` result; probabilities for unnamed options are 0. Default offered set is all four tiers unless the scenario names one. Expected values are taken from the scenario text, e.g. `expert`/.9 → `{decided, deep, expert-denied}`; only `expert` offered, `expert`/.5 → `{kind:"none"}`; miss → `{kind:"none", reason:"miss"}`; cancelled → `{kind:"none"}` with no `reason` key.
- [ ] **Step 2: Run** `bun test tests/policy/tier.test.ts` → FAIL.
- [ ] **Step 3: Implement** `decideTier` with the five rules in order. "Highest offered below expert" and "lowest offered above fast and below expert" walk `TIER_LADDER`; a rule whose target is absent falls through; the `choice` rule returns nothing for `expert`; an empty `offered` decides nothing. `chooseFallback`: if `offered.includes(tier) && canRun(tier)` return `keep` (also for `expert`); otherwise walk `TIER_LADDER` strictly below the decided tier, skipping `expert` and tiers not in `offered`, returning `moved` with `from: tier` at the first that can run, else `unchanged`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(policy): worker tier decision and fallback`.

## Task 7: Worker effort — implements 3.3

**Files:** Create `src/policy/effort.ts`, `tests/policy/effort.test.ts`.

**Interfaces:** Consumes `ChoiceAnswer` (`src/policy/answers.ts`), `TierName`. Produces `EffortLevel`, `workerEffort`.

- [ ] **Step 1: Write failing tests**, one row per scenario of Worker effort and Effort after fallback: `max`/`deep` → `xhigh`; `low`, risky .8 → `high`; `low`, risky .7 → `low`; `high`/`fast` → `medium`; `low`, risky .8, `fast` → `medium`; `high`, no tier → `high`; moved to `fast` with `low` → `xhigh`; moved, no effort → `xhigh`; not moved, no effort → `undefined`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** on the ordered ladder `low < medium < high < xhigh < max`: moved → `xhigh`; else no answer, or a choice that fails an `isEffortLevel` guard → `undefined`; else choice, raise to `high` if `risky > .7`, min with `xhigh`, min with `medium` if `tier === "fast"`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(policy): worker effort rules`.

## Task 8: Docs and full check — implements 4.1, 4.2

**Files:** Modify `docs/domain-model.md`, `docs/jev-contract.md`, `docs/architecture.md`, `docs/roadmap.md`.

- [ ] **Step 1: Edit `docs/domain-model.md`** WorkerDecision: rule 4 reads "the highest configured non-expert tier" like rule 2, and an `expert` choice with no tier below decides nothing; effort paragraph adds "after a fallback move, `xhigh` on every tier, without the `fast` cap"; availability paragraph keeps "never to `expert`".
- [ ] **Step 2: Edit `docs/jev-contract.md`** Worker state: lengths count code points; agent files are matched by listing; `max_turns` is the agent's value, `run_in_background` the effective value; built-ins send an empty `instructions_excerpt`.
- [ ] **Step 3: Edit `docs/architecture.md`** module layout: add `policy/launch.ts` (effective launch fields, locks), `policy/worker.ts` (worker answers), `shared/text.ts` (code-point cut).
- [ ] **Step 4: Edit `docs/roadmap.md`**: status WG-04, WG-05, WG-06 `Done`; WG-11 lists two changes (`wg-11-worker-policy`, `wg-11-worker-host`) and gains the pre-launch tier cascade with a warning; WG-13 keeps slots and the slot fallback only.
- [ ] **Step 5: Run** `bun run typecheck && bun run lint && bun run fmt:check && bun test` → all exit 0.
- [ ] **Step 6: Commit** `docs: worker policy rules and WG-11 split`.

---

## Scenario → test

agent-metadata (`tests/host/agents.test.ts` unless noted):
- Project file wins, Global file, Project file overrides a built-in, Case-insensitive match, Unknown type → `describe("Agent lookup order")`
- Path-like type → `describe("Agent files are found by listing")`
- Unreadable file skipped, Malformed frontmatter skipped, Agents directory missing → `describe("Lookup never throws")`
- Explore built-in, general-purpose declares no tools → `describe("Built-in agents")`
- Long body → `describe("Agent identity fields")`
- Comma-separated tools, Tools none → `describe("Declared tools")`
- Non-boolean flag, max_turns not a number → `describe("Launch fields in the agent file")`
- Whole-file lock, Field list with unknown entry, List with no lockable field, Comma-separated lock → `describe("Lock declaration")`
- Case-insensitive match prefers the built-in name → `describe("Case-insensitive agent match")`
- Body without frontmatter → `describe("Agent identity fields")`
- Model never read out, Invalid thinking is not set → `describe("Model and thinking are never read out")`
- Whole-file lock covers only fields the file sets, Listed lock without a value → `tests/policy/launch.test.ts` `describe("Locked fields")`
- Inherit from frontmatter, Input wins without a lock, Lock keeps the agent value, Resume → `tests/policy/launch.test.ts` `describe("Effective launch fields")`

worker-request:
- Parent request off by default, No model in state → `tests/jev/state.test.ts` `describe("Worker state shape")`
- Brief cut at 4000 characters, Brief at the limit, Parent request on → `tests/jev/state.test.ts` `describe("Worker state text limits")`
- Partial configuration, Expert switched off → `tests/jev/questions.test.ts` `describe("Offered tiers")`
- No tier configured, Expert offered, Asked and accepted agree → `tests/jev/questions.test.ts` `describe("Worker questions")`
- Wording matches the docs, Display name prefix, Missing display name → `tests/jev/questions.test.ts` `describe("Question wording")`
- Jev timeout or error, Body without answers, One bad answer, Cancelled → `tests/policy/worker.test.ts` `describe("Reading worker answers")`

worker-decision (`tests/policy/tier.test.ts` unless noted):
- Ordinary choice → `describe("Decision order")`
- Fable passes, Fable boundary, Expert stands on high risk → `describe("Fable rule")`
- Risk floor, Risk boundary, Risk floor without deep → `describe("Risk floor rule")`
- Expert denied without deep → `describe("Expert denied rule")`
- Fast sure, Fast unsure → `describe("Unsure fast rule")`
- Risk floor without a tier answer, Expert needed unanswered, No tier answer, No tier offered, Every answer unanswered → `describe("Partial answers in the decision")`
- Risk floor with only fast, Fast unsure without a higher tier, Only expert offered and denied → `describe("Rules without a qualifying tier")`
- Jev failure, Cancelled → `describe("Decision on Jev failure")`
- Target usable, Usable expert kept, Move down, Skip an unusable lower tier, Unoffered tier skipped, Expert never a target, Fast cannot run, Nothing can run → `describe("Fallback choice")`
- Ceiling, Risk raises effort, Risk boundary for effort, Fast cap, Risk floor then fast cap, No tier decided → `tests/policy/effort.test.ts` `describe("Worker effort")`
- Fallback lifts effort on fast, Fallback without an effort answer, No effort answer → `tests/policy/effort.test.ts` `describe("Effort after fallback")`

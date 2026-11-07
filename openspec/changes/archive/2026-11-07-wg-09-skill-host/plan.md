# WG-09 Skill Host Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` (`skill-delivery`, `main-effort`, `main-ledger`, `skill-pick`) and `design.md`.

**Goal:** Wire the merged skill policy into the main `before_agent_start` flow, so an eligible prompt gets at most one hidden skill message, sent in full only once while it stays in the model's context.

**Architecture:**
- `src/host/skills.ts` (new) owns all Pi- and file-shaped skill work: catalog, explicit-skill detection, loaded-in-context scan and fingerprint.
- `src/host/main.ts` orchestrates. It handles eligibility, sends the first batch with the main questions and later batches in parallel, and calls `pickSkill`, `deliveryForm` and `deliveryText`. It returns one `jev-skill` message and records `skill`, `skillP` and `gate` on the turn.
- `src/policy/skill.ts` and `src/jev/questions.ts` are used unchanged.

**Tech Stack:** TypeScript, Bun (`bun test`), oxlint boundary rules, Pi 1.5.0 RPC host tests with loopback Jev and provider fixtures.

## Global Constraints

- **Tests:** no secrets, paid calls or network beyond loopback. Host tests use `tests/host/harness.ts` (`startHostSession`) and `tests/jev/fixture.ts`, as `tests/host/main-effort.test.ts` does.
- **Boundaries:** only `src/host/` imports Pi. `policy/` stays pure (`.oxlintrc.json`). Use only Pi public exports: `parseFrontmatter`, `stripFrontmatter`, `ReadonlySessionManager.buildSessionProjection`, `ExtensionAPI.getCommands`.
- **Fail open:** any throw in skill code yields no skill message, and the effort result stands. Handler errors never reach Pi; extend the `beforeAgentStart` catch in `main.ts` accordingly.
- **Privacy:** never store prompt text. `details` of `jev-skill` holds `name`, `fingerprint` and `form` only.
- **Compatibility:** `/jev skills off` makes every Jev request identical to today. The existing tests in `tests/host/main.test.ts`, `tests/host/main-effort.test.ts` and `tests/host/effort-hold.test.ts` stay green.
  - `MainDeps` gains required `commands` and `readFile`. `setup()` in `tests/host/main.test.ts` defaults them to `() => []` and a reader that throws, so skills do not apply there.
  - The real-Pi host tests run in a throwaway agent dir and `HOME`, so their catalog is empty.
- **Style:** everything is English, and relative imports use `.ts`. Follow `~/.agents/skills/coding-standards/SKILL.md`: each new function has one job; `decide()` must not grow into a god function, so skill steps live in helpers.
- **WG-10 (#31):** if it merges first, rebase and combine advice and skill into one returned message: skill text, blank line, advice. Keep `details` holding the skill keys. This is not part of this plan's tasks unless the rebase is needed.

## Review Focus

- **Effort paths:** a skill message must survive every effort path (held, discarded, `max`, `effort` unanswered, skills only) → `tests/host/main.test.ts` "skill survives effort paths" (Task 6).
- **Context edits:** a delivered message removed by a context edit must not count as loaded → `tests/host/skills.test.ts` "loadedSkills: removed by a context edit" (Task 4).
- **`</skill>` in a body:** an explicit `/skill:name` block whose body contains `</skill>` must still fingerprint correctly → "loadedSkills: explicit block with `</skill>` in the body" (Task 4).
- **Later batches:** a later batch's miss or cancel must clear the skill and leave effort applied → `tests/host/main.test.ts` "later batch fails" (Task 5).
- **Status line:** a skills-only turn must not touch the status line or write `decided` → `tests/host/main.test.ts` "skills only" (Task 6).
- **Ledger names:** a skill name outside the ledger pattern never reaches a `main` line → "readCatalog: name the ledger cannot record" (Task 3).

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `CatalogSkill` (`src/host/skills.ts`) | new | `{ name: string; description?: string; body: string; path: string; baseDir: string; fingerprint: string }`. `baseDir` is always `dirname(path)` | no |
| `SKILL_NAME` (`src/store/ledger-schema.ts`) | modified | the existing `SKILL` regex `/^[a-z0-9][a-z0-9-]{0,63}$/`, now exported under this name and used by both the schema and `readCatalog` | no |
| `SkillCommand` (`src/host/skills.ts`) | new | `{ name: string; description?: string; source: string; sourceInfo?: { path?: string; baseDir?: string } }`, the subset of Pi's `SlashCommandInfo` that is read | no |
| `fingerprint(body: string): string` | new | Lowercase hex SHA-256 of the UTF-8 body (`node:crypto`) | no |
| `skillBlock(s: { name: string; path: string; baseDir: string; body: string }): string` | new | `` `<skill name="${name}" location="${path}">\nReferences are relative to ${baseDir}.\n\n${body}\n</skill>` ``, Pi 1.5.0's `_expandSkillCommand` format, built by `join`, with no pattern replace | no |
| `explicitSkill(prompt: string): string \| undefined` | new | Name from a prompt that starts with `<skill name="N" location="…">\nReferences are relative to `; otherwise `undefined` | no |
| `readCatalog(commands: readonly SkillCommand[], read: (path: string) => string): CatalogSkill[]` | new | Spec "Skill catalog" and "Catalog exclusions"; `read` may throw | no |
| `loadedSkills(entries: readonly { sourceEntry: unknown; messages: readonly unknown[] }[], catalog: readonly CatalogSkill[]): { name: string; fingerprint: string }[]` | new | Spec "No duplicate body in context" and "Explicit skill counts as loaded"; the input is `buildSessionProjection().entries` | no |
| `SKILL_MESSAGE_TYPE` | new | `"jev-skill"` | no |
| `jev-skill` custom message | new | `{ customType: "jev-skill", content: string, display: false, details: { name: string; fingerprint: string; form: "content" \| "suggest" \| "reference" } }`, stored in session files | yes |
| `MainDeps` (`src/host/main.ts`) | modified | adds `commands: () => readonly SkillCommand[]` and `readFile: (path: string) => string` | no |
| `TurnRecord` | modified | adds `skill?: string; skillP?: number; gate?: number` | no |
| `createMain(...).beforeAgentStart` | modified | returns `Promise<BeforeAgentStartEventResult \| undefined>`; the message is set only on a pick | no |
| `main` ledger line | modified | now writes `skill`, `skillP` and `gate` when known; the schema is already in `src/store/ledger-schema.ts` | yes |

No config key, CLI argument, ledger schema or state file changes.

---

## Task 1: Docs — implements 1.1, 1.2

**Files:** Modify `docs/jev-contract.md` ("Eligibility", "Skill pick"), `docs/workflow.md` ("1. A main prompt", "7. A compaction"), `docs/architecture.md` ("Host seams"), `docs/privacy.md`.

- [ ] **Step 1:** In `docs/jev-contract.md` "Eligibility", replace the first paragraph with: "A main request is sent when `messageType` is `user`, the text is not empty, the session is not a child, and effort applies or skills apply. Skills apply when `skills` is on, the catalog is not empty, and the prompt has no explicit `/skill:name`, which Pi has already expanded to a leading `<skill name=…>` block. `corrects` is asked on every main request. When nothing applies, no request is made."
- [ ] **Step 2:** In "Skill pick", extend the catalog paragraph with these exclusions: names not matching `^[a-z0-9][a-z0-9-]{0,63}$`, read on each eligible prompt, body as Pi builds it. Replace the duplicate paragraph with: "If the same name with the same body fingerprint is still in the context Pi sends to the model (after compaction and context edits), from a delivered body or an explicit `/skill:name`, the `reference` form is sent instead. A suggestion never counts. A failed batch means no skill; effort still applies when the first batch answered." Add one line: "Delivered as a custom message `jev-skill`, `display: false`, whose `details` holds the name, fingerprint and form."
- [ ] **Step 3:** `docs/workflow.md`:
  - In section 1, change "Skipped when … every applicable feature is off" to add: "Skills apply only with a catalog and no explicit `/skill:name`."
  - In "Effect on the session", add: "A skill picked again while its body is still in context is sent as a one-line reference."
  - In section 7, change step 3 to: "Skill bodies that the compaction dropped are sent again in full if picked again; bodies it kept are referenced."
- [ ] **Step 4:** `docs/architecture.md` "Host seams":
  - Change the "Skill catalog" row to "`pi.getCommands()` with `sourceInfo.path`, `parseFrontmatter` / `stripFrontmatter`".
  - Add a row "Skills already in context | `ctx.sessionManager.buildSessionProjection()` | Documented".
  - In the module list, set `host/` to include `skills.ts  Skill catalog, explicit skill, loaded-in-context scan`.
- [ ] **Step 5:** `docs/privacy.md`: after "Hidden skill and advice messages are saved in your Pi session files", add: "A skill message holds the skill's own text (its body, or only its path for `suggest`), and its details hold the skill name, a SHA-256 of the body and the form. No prompt text."
- [ ] **Step 6:** `bun run fmt:check` passes. Commit `docs(skill-delivery): eligibility, catalog and duplicate rules`.

---

## Task 2: Fingerprint, block and explicit skill — implements 2.1

**Files:** Create `src/host/skills.ts`, `tests/host/skills.test.ts`.

**Interfaces:** Produces `fingerprint`, `skillBlock`, `explicitSkill` and `SKILL_MESSAGE_TYPE` (Contracts).

- [ ] **Step 1: Failing tests** in `describe("explicitSkill")`:
  - **"Operator loads a skill":** `skillBlock({ name: "debug", path: "/s/debug/SKILL.md", baseDir: "/s/debug", body: "Step." }) + "\n\nfix the test"` → `"debug"`.
  - **"Skill block later in the prompt":** `"see <skill name=\"debug\" location=\"/x\">\nReferences are relative to /x."` → `undefined`.
  - **"Unexpanded skill command":** `"/skill:unknown do it"` → `undefined`.
  - **"Not Pi's block":** `<skill name="debug" location="/x">` with no `References` line → `undefined`.

  In `describe("fingerprint")`:
  - The same body gives the same 64-hex value.
  - A one-character change gives a different value.
  - `fingerprint("")` is the SHA-256 of the empty string (`e3b0c442…`).

  In `describe("skillBlock")`: the output equals the literal Pi 1.5.0 format, and `$&` in the path survives.
- [ ] **Step 2:** `bun test tests/host/skills.test.ts` fails (module missing).
- [ ] **Step 3:** Implement. `explicitSkill` uses an anchored regex `^<skill name="([^"]*)" location="[^"]*">\nReferences are relative to `. `fingerprint` uses `createHash("sha256").update(body, "utf8").digest("hex")`.
- [ ] **Step 4:** Tests pass. `bun run lint` passes.
- [ ] **Step 5:** Commit `feat(skill-delivery): skill block, fingerprint and explicit skill`.

---

## Task 3: Catalog — implements 2.2

**Files:** Modify `src/host/skills.ts`, `tests/host/skills.test.ts` and `src/store/ledger-schema.ts` (export `SKILL_NAME`).

**Interfaces:** Produces `SkillCommand`, `CatalogSkill`, `readCatalog` and `SKILL_NAME`. Consumes `parseFrontmatter` and `stripFrontmatter` from `@earendil-works/pi-coding-agent`, and `fingerprint` (Task 2).

- [ ] **Step 1: Failing tests** in `describe("readCatalog")`, with an in-memory `read` over a `Record<string, string>` that throws for missing paths:
  - **"Skills listed by Pi":** commands `skill:debug` and `skill:plan` → names `["debug", "plan"]`. Each has `path` and `baseDir` from `sourceInfo`, the body without frontmatter and trimmed, the command's description, and `fingerprint(body)`.
  - **"Package base directory":** `sourceInfo.baseDir` is `/a` (the agent root) for `/a/skills/debug/SKILL.md` → `baseDir` is `/a/skills/debug`. The same holds with no `sourceInfo.baseDir`.
  - **"Model invocation disabled":** frontmatter `disable-model-invocation: true` drops the skill.
  - **"Unreadable file":** `read` throws for `plan` → only `debug`.
  - **"Malformed frontmatter":** `---\na: [\n---\nbody` → that entry is dropped and the others are kept. The test first asserts that `parseFrontmatter` throws on this input.
  - **"Name the ledger cannot record":** `skill:My_Skill` and a 65-character name are dropped.
  - **"Other commands":** `source` `extension` and `prompt` are dropped, and so is a `skill` command with no `sourceInfo.path`.
  - **"Same body as Pi":** for raw `---\nname: debug\n---\n\n  Step one.\n\n`, the body is `stripFrontmatter(raw).trim()`.
- [ ] **Step 2:** Tests fail.
- [ ] **Step 3:** Implement as one loop. A small `toCatalogSkill(command, read)` helper returns `CatalogSkill | undefined` inside its own `try`/`catch`. Name pattern: rename `SKILL` in `src/store/ledger-schema.ts` to the exported `SKILL_NAME`, use it in the schema, and import it in `skills.ts` (`host/` may import `store/`). `baseDir = dirname(path)`.
- [ ] **Step 4:** Tests pass. Typecheck and lint pass.
- [ ] **Step 5:** Commit `feat(skill-delivery): skill catalog from getCommands`.

---

## Task 4: Loaded in context — implements 2.3

**Files:** Modify `src/host/skills.ts`, `tests/host/skills.test.ts`.

**Interfaces:** Produces `loadedSkills`. Consumes `skillBlock` and `CatalogSkill`.

- [ ] **Step 1: Failing tests** in `describe("loadedSkills")`, with entries shaped like `buildSessionProjection().entries`:
  - A `custom_message` source entry is `{ type: "custom_message", customType, content, details }`, with `messages: [{ role: "custom", content }]`.
  - A user message is `{ type: "message", message: { role: "user", content } }`, with `messages: [same]`.

  Cases:
  - **"Delivered content":** a `jev-skill` entry with `details { name: "debug", fingerprint: F, form: "content" }`, projected unchanged → `[{ name: "debug", fingerprint: F }]`.
  - **"Suggested before":** `form: "suggest"` → `[]`.
  - **"Reference":** `form: "reference"` → `[]`.
  - **"Removed by a context edit":** source entry as above with `messages: []` → `[]`.
  - **"Rewritten by a context edit":** `messages[0].content` differs from the source `content` → `[]`.
  - **"Loaded by the operator":** user text `skillBlock(debug) + "\n\nfix it"`, string or `[{ type: "text", text }]` → `{ name: "debug", fingerprint: debug.fingerprint }`.
  - **"Loaded before an edit":** user text is a block with an older body → `debug` with a fingerprint that is not `debug.fingerprint`.
  - **"Explicit block with `</skill>` in the body":** the catalog body contains `</skill>\nmore`, and the user text is the full block → current fingerprint.
  - **"Unknown skill block":** a block for a name not in the catalog → ignored.
  - **"Other entries":** assistant messages, `jev-advice` and `compaction` entries → ignored.
  - **"Malformed details":** missing or non-string `details` fields → ignored, no throw.
- [ ] **Step 2:** Tests fail.
- [ ] **Step 3:** Implement with two small helpers:
  - `deliveredSkill(entry)`: counts only when `messages` has one element whose content equals the source content.
  - `explicitLoaded(entry, catalog)`: reads the first text part, gets the name with `explicitSkill`, compares `text.startsWith(skillBlock(skill))`, and on a mismatch uses the fingerprint `"stale"`.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `feat(skill-delivery): skills loaded in the model's context`.

---

## Task 5: Eligibility and batch requests — implements 3.1, 3.2

**Files:** Modify `src/host/main.ts`, `src/host/setup.ts`, `tests/host/main.test.ts`.

**Interfaces:** Consumes `readCatalog`, `explicitSkill` (Tasks 2–3), `skillBatches`, `pickSkill`, `SkillPick` (`src/policy/skill.ts`), and `mainQuestions` and `skillBatchQuestions` (`src/jev/questions.ts`). Produces the `MainDeps` changes.

- [ ] **Step 0: Refactor first, behaviour unchanged.** Split `decide()` in `src/host/main.ts` into three parts:
  - `prepare(event, ctx)`: eligibility, the hold, and the record. It returns the context or `undefined`.
  - The ask.
  - `applyEffort(rec, ctx, snapshot, read, …)`, returning void; the held path stays in `holdOutcome`.

  Run `bun test tests/host` green with no test change. Commit `refactor(main): split decide into prepare and applyEffort`.
- [ ] **Step 1: Failing tests.** Extend `setup()` in `tests/host/main.test.ts`:
  - New options: `skills?: { name: string; body: string; description?: string }[]`, `inject?: "content" | "suggest"`, `projection?: unknown[]`.
  - Each skill becomes a command `skill:<name>` with `sourceInfo { path: "/s/<name>/SKILL.md", baseDir: "/s/<name>" }`. `readFile` returns `---\nname: <name>\n---\n<body>`.
  - Add `buildSessionProjection: () => ({ entries: projection ?? [], messages: [] })` to the fake session manager.
  - Add an `answerWith({ effort?, which?, gates? })` helper building a full outcome.
  - Make the fake `ask` route on `Object.keys(req.questions)`: a request whose only key is `which` takes from a `batchOutcomes` queue, and any other from `outcomes`. Then the test does not depend on call order. The implementation still issues the main `ask` first, then batches in order.

  Tests:
  - **"Effort off, skills apply":** one request; its `questions` keys are `corrects`, `which` and the three gates; the level is unchanged.
  - **"Effort off and empty catalog":** zero requests.
  - **"Effort off and explicit skill":** prompt `skillBlock(debug) + "\n\nx"` → zero requests.
  - **"Operator loads a skill" (effort on):** one request with keys `effort`, `risky`, `corrects`.
  - **"Effort and skills":** ordered keys as in the spec.
  - **"Held prompt with skills":** keys `corrects`, `which`, gates.
  - **"Skills off":** keys unchanged from today, and `readFile` is never called.
  - **"Ineligible prompt":** with the key unset, and separately in session `child-1`, `readFile` is never called.
  - **"Two batches":** 300 skills → two requests. The second has only `which`, over 150 options plus `(none)`, with the same `state` and `timeoutMs`. Both are issued before either resolves; assert with held promises.
  - **"Later batch fails":** with 300 skills, the first outcome answers `effort` `high` and `which` `s0` .9, and the second is a miss → level `high`, no message, and `TurnRecord` has no `skill`, `skillP` or `gate`, checked through the ledger after `agentSettled`.
  - **"Later batch cancelled":** same, with the second outcome `cancelled`.
- [ ] **Step 2:** Tests fail.
- [ ] **Step 3:** Implement in `main.ts`:
  - `planSkills(prompt, snapshot)` returns `{ batches: CatalogSkill[][] } | undefined`. It returns `undefined` when skills are off, the prompt has an explicit skill, or the catalog is empty. It reads the catalog through `deps.commands()` / `deps.readFile`, inside a `try`; a throw means `undefined`.
  - Eligibility runs `if (!effortOn && skills === undefined) return;` after the existing checks, with the catalog read last.
  - The hold is computed only when `effortOn`.
  - Main questions: `mainQuestions({ askEffort, skills: batches[0] })`.
  - Later requests: `askBatches(rest, common)` maps each batch through `deps.ask` with `skillBatchQuestions`. It is started before awaiting the main request, and each is awaited with `.catch(() => miss)`.
  - The later outcomes are kept for Task 6, where `skillPick` consumes them. Do not add an unused helper here.

  In `setup.ts`, pass `commands: () => pi.getCommands()` and `readFile: (p) => readFileSync(p, "utf8")`.
- [ ] **Step 4:** All tests in `tests/host/main.test.ts` pass, the old ones unchanged.
- [ ] **Step 5:** Commit `feat(skill-delivery): skill questions on the main request`.

---

## Task 6: Skill message — implements 3.3

**Files:** Modify `src/host/main.ts`, `tests/host/main.test.ts`.

**Interfaces:** Consumes `loadedSkills`, `deliveryForm`, `deliveryText` and `SKILL_MESSAGE_TYPE`. Produces the `jev-skill` message (Contracts).

- [ ] **Step 1: Failing tests:**
  - **"Content form":** `debug` is picked at .6 → the result is `{ message: { customType: "jev-skill", display: false, content: deliveryText("content", …), details: { name: "debug", fingerprint, form: "content" } } }`.
  - **"Suggest form":** `inject: "suggest"` → `form` `suggest`, and the content has the path but no body.
  - **"None leads":** `which` led by `(none)` → result `undefined`.
  - **"Gate too low":** `debug` .4 with gates .2/.2/`prose` .8 → `undefined`.
  - **"Reference":** `projection` holds a delivered `debug` with the same fingerprint → `form` `reference`.
  - **"Skill survives effort paths":** a message is attached in each case:
    - held: `holdProviders: ["fixture"]` plus a `decided` anchor in the branch;
    - discarded: the level changes during a held promise;
    - `max`: start level `max`;
    - `effort` unanswered: unknown choice.
  - **"Skills only":** `effort` off, `debug` picked → message attached, `t.widgets` unchanged, and after `agentSettled` the `jev-turn` data is exactly `{ turnId }`.
  - **"Main miss":** the outcome is a miss → `undefined`.
  - **"Cancelled":** `cancelled` → `undefined`.
  - **"Throwing projection":** `buildSessionProjection` throws → no message, effort still applied.
  - **"Skill edited since":** `projection` holds a delivered `debug` with another fingerprint → `form` `content`.
  - **"Other branch":** `projection` without the delivered entry, while `getBranch` still holds one elsewhere → `form` `content`.
  - **"Unreadable which":** `which` probabilities name an option that was not asked → effort applies, no message.
  - **"Esc after the pick":** `debug` picked; then `agentSettled({ aborted: true })` with no `beforeProviderRequest` → `t.appended` is empty, and no `jev-turn` entry is written.
  - **"Skills only, Jev miss":** `effort` off, outcome miss → `t.widgets` unchanged, and `t.main.decision()` is `undefined`.
- [ ] **Step 2:** Tests fail.
- [ ] **Step 3:** Implement:
  - `skillPick(specs, mainRead, laterOutcomes)` builds the `{ options, read }[]` list for `pickSkill`. `options` is each batch's `which` spec options; `read` is `undefined` for a miss or cancel.
  - `skillMessage(pick, catalog, ctx, inject)` returns a `BeforeAgentStartEventResult | undefined` inside its own `try`.
  - In `decide()`, compute `const message = …` once right after `readAnswers` succeeds, and in `holdOutcome` after its read. Every effort branch then returns `message`.
  - For a skills-only turn (`!effortOn`), never call `setDecision` on any path (pick, miss, schema miss).
  - The miss, cancel and schema paths return `undefined`.
  - Change `beforeAgentStart` to return `decide()`'s result, and `undefined` on a throw.
- [ ] **Step 4:** Tests pass; old tests unchanged. `t.main.beforeAgentStart` returning `undefined` still holds wherever skills do not apply.
- [ ] **Step 5:** Commit `feat(skill-delivery): hidden skill message with duplicate check`.

---

## Task 7: Ledger fields — implements 3.4

**Files:** Modify `src/host/main.ts`, `tests/host/main.test.ts`.

**Interfaces:** Modifies `TurnRecord` and the `main` line.

- [ ] **Step 1: Failing tests:**
  - **"Skill picked":** `debug` .6, gates .4/.4/`prose` .6 (mean .4) → line `skill` `debug`, `skillP` .6, `gate` ≈.4, validated with `validateLedgerEntry`.
  - **"Skill picked again as a reference":** the line has `skill`.
  - **"Below the threshold":** .45 with a mean of .29 → `skillP`, `gate`, no `skill`.
  - **"None leads":** gate mean .1 → `gate` only.
  - **"Skills not asked":** with skills off, an explicit skill, or a failed batch, the line has none of the three.
  - **"Skills only":** the line has no `requested` and no `effective`.
  - **"Held turn":** with skills not applying, the existing assertions are unchanged.
  - **"Held prompt with a pick":** held plus `debug` picked → line `held` true, `effective`, `skill` `debug`, and no `effortP`, `risky` or `requested`.
- [ ] **Step 2:** Tests fail.
- [ ] **Step 3:** Set `rec.skill`, `rec.skillP` and `rec.gate` from the `SkillPick` (`p` → `skillP`). Spread them into the `main` line in `write()` after `corrects`.
- [ ] **Step 4:** Tests pass.
- [ ] **Step 5:** Commit `feat(skill-delivery): skill fields on the main line`.

---

## Task 8: Host test through the real CLI — implements 4.1

**Files:** Create `tests/host/skill-delivery.test.ts`. Modify `tests/host/harness.ts`: add `skills?: Record<string, string>` to `PrepareOpts`, mapping the name to the full `SKILL.md` text (frontmatter with `name` and `description`, then the body). It is written to `<agentDir>/skills/<name>/SKILL.md`, which Pi 1.5.0 auto-discovers (`package-manager.js` user skills dir; the harness sets `PI_CODING_AGENT_DIR`). Pi skips a skill without `description`.

**Interfaces:** Black-box. Consumes `startHostSession`, `startFixture` and `startJevFixture`.

- [ ] **Step 1: Failing tests.** One `setup()` modelled on `tests/host/main-effort.test.ts`:
  - Skills `debug` (body contains the marker `JEV-SKILL-BODY-DEBUG`) and `plan`.
  - The Jev route is changeable per turn, and `persist: true`.

  Helpers:
  - `bodyCount(req)` counts `JEV-SKILL-BODY-DEBUG` in `JSON.stringify(req.body.messages)`.
  - `skillEntries(s)` reads the session file's `custom_message` entries with `customType` `jev-skill`.

  Tests:
  - **"Content once across three picks":** three prompts with `which` `debug` .8. There is exactly one `jev-skill` entry with `form` `content` and two with `reference`. Every provider request of the main model has `bodyCount` 1. The first request has no transcript-visible message (`display: false` in the entry). The ledger lines all have `skill` `debug`.
  - **"Operator loads a skill then a pick":** prompt 1 is `/skill:debug go`. Its Jev request has no `which`, and no `jev-skill` entry. Prompt 2 picks `debug` → `reference`, and `bodyCount` stays 1 in prompt 2's requests.
  - **"After a compaction, dropped":**
    - Turn 1 picks `debug`; turns 2 and 3 pick nothing (`(none)`), each with `FILLER`, so the compaction cut lands after turn 1.
    - Send `{ type: "compact" }`, then `await Bun.sleep(300)`, as in `tests/host/effort-hold.test.ts`, with its summarization script entry.
    - Fail-fast precondition: read the session file, find the compaction entry's `firstKeptEntryId`, and assert the first `jev-skill` entry comes before it.
    - Then pick `debug` again and assert the new `jev-skill` entry's `details.form` is `content`.
  - **"After a compaction, kept":**
    - Turns 1 and 2 are filler with `(none)`; turn 3 picks `debug` with a short prompt.
    - Compact, then assert as a precondition that the `jev-skill` entry is at or after `firstKeptEntryId`.
    - Pick `debug` again and assert `details.form` is `reference`.
    - If Pi's cut point cannot be steered this way, keep the unit test "Delivered content" as the cover for "Kept across a compaction", and record in `apply.md` that the host variant was not reachable.
  - **"None leads" and "Gate too low":** no `jev-skill` entry, and no `<skill_relevance>` in the provider request.
  - **"Suggest form":** `config.json` has `skills.inject: "suggest"`. The request has the path and `bodyCount` 0.
  - **"Jev down":** HTTP 500 → no entry. The provider request messages equal those of the same run with `/jev skills off`.
  - **"Skills only":** `/jev effort off`, then a pick → entry present, and the thinking level is unchanged.
  - **"Marker absent":** the prompt contains `JEV-MARKER-PROMPT`. Neither the ledger nor any `jev-skill` `details` contains it.
- [ ] **Step 2:** Run `bun test tests/host/skill-delivery.test.ts`. It fails first on whatever is not wired, or passes if Tasks 5–7 already cover it. If any test passes before the wiring, prove it is RED by reverting the `message` return.
- [ ] **Step 3:** Fix any gap the host test reveals in `src/host/`, with a unit test for each fix.
- [ ] **Step 4:** Run the whole host suite: `bun test tests/host`. All pass.
- [ ] **Step 5:** Commit `test(skill-delivery): host test for exactly once, none and gate paths`.

---

## Task 9: Final check — implements 5.1

- [ ] **Step 1:** In `docs/roadmap.md`, set WG-09 to `Done`.
- [ ] **Step 2:** Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test`; all must pass. Lint passing covers "Lint boundaries".
- [ ] **Step 3:** Commit `docs(roadmap): mark WG-09 done`.

---

## Scenario → test

skill-delivery:
- Skills listed by Pi → `tests/host/skills.test.ts` readCatalog "Skills listed by Pi" (Task 3)
- Skills off → `tests/host/main.test.ts` "Skills off" (`readFile` not called) (Task 5)
- Ineligible prompt → `tests/host/main.test.ts` "Ineligible prompt" (Task 5)
- Model invocation disabled, Unreadable file, Name the ledger cannot record, Other commands → readCatalog tests of the same names (Task 3)
- One batch → `tests/host/main.test.ts` "Effort off, skills apply" and "Effort and skills" (Task 5)
- Two batches → `tests/host/main.test.ts` "Two batches" (Task 5)
- Empty catalog → `tests/host/main.test.ts` "Effort off and empty catalog" (Task 5)
- Operator loads a skill → `tests/host/skills.test.ts` explicitSkill and `tests/host/main.test.ts` "Operator loads a skill" (Tasks 2, 5); host "Operator loads a skill then a pick" (Task 8)
- Skill block later in the prompt, Unexpanded skill command → explicitSkill tests (Task 2)
- Content form → `tests/host/main.test.ts` "Content form" (Task 6); host "Content once across three picks" (Task 8)
- Suggest form → `tests/host/main.test.ts` "Suggest form" (Task 6); host "Suggest form" (Task 8)
- None leads → `tests/host/main.test.ts` "None leads" (Task 6); host "None leads" (Task 8)
- Gate too low → `tests/host/main.test.ts` "Gate too low" (Task 6); host "Gate too low" (Task 8)
- Level changed during the wait, Held prompt with a pick, Max kept with a pick, Effort unanswered with a pick → `tests/host/main.test.ts` "Skill survives effort paths" (Task 6)
- Skills only (skill-delivery) → `tests/host/main.test.ts` "Skills only" (Task 6); host "Skills only" (Task 8)
- Esc after the pick → `tests/host/main.test.ts` "Esc after the pick" (Task 6)
- Held prompt with a pick (ledger part) → `tests/host/main.test.ts` "Held prompt with a pick" (Task 7)
- Kept across a compaction → `tests/host/skills.test.ts` "Delivered content" (a kept entry projects unchanged) (Task 4); host "After a compaction, kept" (Task 8)
- Package base directory → readCatalog "Package base directory" (Task 3); host "Operator loads a skill then a pick" (Task 8, real Pi `sourceInfo`)
- Picked twice on one branch → host "Content once across three picks" (Task 8)
- Removed by a context edit → `tests/host/skills.test.ts` "Removed by a context edit" and "Rewritten by a context edit" (Task 4)
- Skill edited since → `tests/host/main.test.ts` "Skill edited since" (Task 6)
- After a compaction → host "After a compaction, dropped" (Task 8)
- Other branch → `tests/host/main.test.ts` "Other branch": a projection without the delivered entry gives `content` (Task 6)
- Suggested before → `tests/host/skills.test.ts` "Suggested before" (Task 4)
- Loaded by the operator, Loaded before an edit → `tests/host/skills.test.ts` tests of the same names (Task 4)
- Jev down → `tests/host/main.test.ts` "Main miss" (Task 6); host "Jev down" (Task 8)
- Later batch fails → `tests/host/main.test.ts` "Later batch fails" and "Later batch cancelled" (Task 5)
- Unreadable which → `tests/host/main.test.ts` "Unreadable which": `which` names an option not asked → effort applies, no message (Task 6)
- Lint boundaries → `bun run lint` (Task 9)

main-effort:
- User prompt with effort on → existing `tests/host/main.test.ts` "request sent once for a user prompt" (unchanged)
- Effort off, skills apply → `tests/host/main.test.ts` (Task 5)
- Effort off → existing `untouched("effort off")`, extended with `skills` off (Task 5)
- Effort off and empty catalog, Effort off and explicit skill → `tests/host/main.test.ts` (Task 5)
- Run started by a custom message, Child session, No key, Empty prompt, Invalid config → existing `untouched(...)` tests (unchanged)
- Reasoning model, Non-reasoning model, Held prompt → existing tests in `tests/host/main.test.ts` and `tests/host/effort-hold.test.ts` (unchanged; fakes have no skills)
- Effort and skills, Skills only, Held prompt with skills → `tests/host/main.test.ts` (Task 5)
- Jev returns 500, Jev times out, Effort unanswered → existing `tests/host/main-effort.test.ts` and `tests/host/main.test.ts` (unchanged)

main-ledger:
- Decided turn, Run fails before any provider request, Session replaced before the turn settles, Ledger directory unwritable → existing tests (unchanged)
- Ineligible prompt → existing test, extended with `skills` off (Task 7)
- Skills only (main-ledger) → `tests/host/main.test.ts` "Skills only" ledger assertion (Task 7)
- Required fields, Effective is read back from Pi, Held turn, Held turn with a miss, Decided turn is not held → existing tests (unchanged)
- Skill picked, Skill picked again as a reference, Below the threshold, None leads, Skills not asked → `tests/host/main.test.ts` (Task 7)
- Marker absent → existing host test, plus host "Marker absent" (Task 8)
- Skill details → `tests/host/main.test.ts` "Content form" (`details` keys) and host "Marker absent" (Tasks 6, 8)

skill-pick:
- First batch with effort, First batch without effort, Later batch, Skills not asked → existing `tests/jev/questions.test.ts` (unchanged)

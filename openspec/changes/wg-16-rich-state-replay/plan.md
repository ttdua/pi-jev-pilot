# Rich State Replay Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Build the rich main-state field groups behind an empty shipped list, a local git-count recorder, and `scripts/replay`. Then run the two approved replay passes and apply each group's decision.

**Architecture:** Pure builders and readers live in `src/jev/`, so the host and `scripts/replay` share them. `src/host/main.ts` builds inputs only for groups listed in `SHIPPED_MAIN_GROUPS`. The replay script reads sessions, builds per-variant requests with the package's builders, calls Jev only with `--send`, and writes outputs under `<agentDir>/jev/replay/`. Tasks 1–11 are code. Tasks 12 and 14 are operator-gated runs. Task 13 applies the decisions from Task 12.

**Tech Stack:** TypeScript on Bun (`bun test`), oxlint and oxfmt. No new dependency.

## Global Constraints

- Public Pi APIs only. Only `src/host/` imports `@earendil-works/*`. `scripts/` must not import `src/host/` or `src/store/` (`.oxlintrc.json`).
- Fail open: any failure in rich inputs or the recorder leaves the main decision as it would be without them.
- Never store prompt text, tool arguments or tool output. Inside the repository, only aggregates. Recorder lines hold numbers and ids only.
- Tests need no secrets, paid calls, or network beyond loopback (`tests/jev/fixture.ts`).
- Count code points, not UTF-16 units, for every cut (`cutCodePoints`).
- Gate before every real Jev call: the operator approves at that moment, after seeing the counts and the cost.
- Verify: `bun test`, `bun run typecheck`, `bun run lint`, `bun run fmt:check`.

## Review Focus

1. **Entries that are not messages, or are corrupt.** A session line that is not JSON, or an entry with no `message`, must be skipped by `readSessionFile`, never thrown. Test: `skips corrupt lines`.
2. **Huge trees for `scanLanguages`.** For example a home directory as `cwd`. It must stop at 5000 entries quickly. Test: `stops at the entry cap`.
3. **`git` hanging or not installed.** The host input must be omitted after 500 ms, and the decision must still go ahead. Test: `git timeout omits field`.
4. **The recorder racing a concurrent session.** Two appends must not interleave a line. Lines are under 512 bytes, written with one `appendFileSync` in `O_APPEND` mode. Test: `two appends give two whole lines`.
5. **The replay run interrupted halfway.** No partial `aggregates.json` must be left looking complete. Write it atomically at the end. Test: `aggregates written only on completion`.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `SessionEntryLike` | new | `{ type: string; id?: string; customType?: string; data?: unknown; message?: unknown }` | no |
| `branchItems` | modified (moved to `src/jev/branch.ts`) | `(entries: readonly SessionEntryLike[]) => BranchItem[]` | no |
| `scanPlatforms` | modified (moved to `src/jev/workspace.ts`) | `(cwd: string) => string[]` | no |
| `scanLanguages` | new, `src/jev/workspace.ts` | `(cwd: string) => string[]` | no |
| `parseShortstat` | new, `src/jev/state.ts` | `(out: string) => GitCounts \| undefined` | no |
| `GitCounts` | new | `{ changed_files: number; diff_lines: number }` | no |
| `RichGroup` | new | `"last_decision" \| "context_used_percent" \| "git" \| "languages" \| "capabilities"` | no |
| `RichInputs` | new | `{ lastDecision?: { effort?: string; strategy?: string }; contextPercent?: number \| null; git?: GitCounts; languages?: string[]; capabilities?: { tools: { name: string; description: string }[]; agents: { name: string; description: string; tools: string[] \| null }[] } }` | no |
| `SHIPPED_MAIN_GROUPS` | new | `readonly RichGroup[]`, initially `[]` | no |
| `mainState` | modified | `(i: { prompt: string; items: BranchItem[]; platforms: string[]; rich?: RichInputs }) => MainState` (rich keys optional in `MainState`) | no |
| `pickRich` | new, `src/jev/state.ts` | `(all: RichInputs, groups: readonly RichGroup[]) => RichInputs` | no |
| `listAgents` | new, `src/host/agents.ts` | `(dirs: { cwd: string; agentDir: string }) => AgentFacts[]` | no |
| `gitCounts` | new, `src/host/git.ts` | `(exec, cwd: string) => Promise<GitCounts \| undefined>` (see Task 5) | no |
| `--pass 2 --kept <groups>` | new CLI flag | comma-separated `RichGroup` names shipped after pass 1 | yes (operator tool) |
| `buildRichInputs` | new, `src/host/rich.ts` | see Task 5 | no |
| `MainDeps.rich`, `MainDeps.record` | new (optional) | see Tasks 5 and 6 | no |
| `readLedgerLines` | new, `scripts/replay/sessions.ts` | `(dir: string) => Map<string, { effective?: string; strategy?: string; from?: string }>` | no |
| `replay-git.jsonl` | new file format | one JSON line: `{ "v": 1, "at": number, "session": string, "turnId": string, "changedFiles": number, "diffLines": number }` | yes (local file, documented in `docs/privacy.md`) |
| `JEV_REPLAY_GIT` | new env var | `"1"` enables the recorder; any other value or unset disables it | yes (documented in `docs/testing.md`) |
| `scripts/replay` CLI | new | `bun scripts/replay/cli.ts --pass 1\|2 [--kept GROUPS] [--seed N=1] [--main N=100] [--workers N=46] [--sessions DIR] [--capabilities FILE] [--models FILE] [--url URL] [--send]` | yes (operator tool) |
| Capabilities snapshot | new file format | `{ "v": 1, "tools": [{ "name", "description" }], "agents": [AgentFacts] }`; also the worker agent-facts source | no (private) |
| `aggregates.json` | new file format | `{ v: 1, runId, pass, samples: { main, workers }, skipped: string[], variants: { [id]: { base, requests, misses, excluded, flips: { [key]: number }, noise: { [key]: number }, beyond: string[] } } }` | no (private, copied into evidence by hand) |

`effortQuestionReversed` is not a contract. The variant reverses the key order of `wire.effort.criteria` and `specs.effort.options` locally in `variants.ts`.

---

## Task 1: Move the shared readers into jev/ — implements 1.1, 1.2, 1.3

**Files:**
- Create: `src/jev/branch.ts`, `src/jev/workspace.ts`
- Modify: `src/host/context.ts` (delete the bodies and re-export), `docs/architecture.md` (module tree)
- Test: `tests/host/context.test.ts` (unchanged; must pass)

**Interfaces:** Produces `SessionEntryLike`, `branchItems`, `scanPlatforms`.

- [ ] **Step 1:** Move `textOf`, `Part` and `branchItems` into `src/jev/branch.ts`, typed over `SessionEntryLike`. Move `MARKERS`, `SKIP_DIRS`, `listDir`, `isDir`, `isFile` and `scanPlatforms` into `src/jev/workspace.ts`, and export `SKIP_DIRS`.
- [ ] **Step 2:** In `src/host/context.ts`, add `export { branchItems } from "../jev/branch.ts"; export { scanPlatforms } from "../jev/workspace.ts";`. Keep `previousTurnId` and `holdContext` there.
- [ ] **Step 3:** Run `bun test tests/host/context.test.ts && bun run lint && bun run typecheck`. Expected: all pass with no test edits.
- [ ] **Step 4:** Add `branch.ts` and `workspace.ts` to the `jev/` block in `docs/architecture.md`.
- [ ] **Step 5:** Commit: `refactor: move session and workspace readers into jev/`.

## Task 2: Rich group placement in mainState — implements 2.1

**Files:**
- Modify: `src/jev/state.ts`
- Test: `tests/jev/state.test.ts`

**Interfaces:** Produces `RichGroup`, `RichInputs`, `SHIPPED_MAIN_GROUPS`, `pickRich`, and `mainState` with `rich`.

- [ ] **Step 1:** Write failing tests:
  - `one group alone`: `mainState({ ..., rich: { languages: ["TypeScript"] } })` equals the minimal state plus `workspace.languages: ["TypeScript"]`.
  - `every group`: all five inputs give `conversation.last_decision`, `conversation.context_used_percent`, `workspace.git`, `workspace.languages`, and `capabilities.{tools,subagents}`.
  - `pickRich keeps only listed groups`.
  - `shipped list starts empty`: `expect(SHIPPED_MAIN_GROUPS).toEqual([])`.
- [ ] **Step 2:** Run `bun test tests/jev/state.test.ts`. Expected: FAIL (`rich` is not accepted).
- [ ] **Step 3:** Implement. The optional keys are added only when their input is defined, in contract order. `pickRich` maps each group to its input key.
- [ ] **Step 4:** Run the same test file. Expected: PASS, and the existing `mainState` tests are unchanged.
- [ ] **Step 5:** Commit: `feat(jev): optional rich groups in main state`.

## Task 3: last_decision, context percent, git, capabilities builders — implements 2.2, 2.3, 2.5

**Files:**
- Modify: `src/jev/state.ts`
- Test: `tests/jev/state.test.ts`

**Interfaces:**
- Consumes Task 2.
- Produces `parseShortstat`. The builders are internal to `mainState`.

- [ ] **Step 1:** Write failing tests with the spec values:
  - `last decision kept`: `{effort:"high",strategy:"direct"}`.
  - `last decision key omitted`: `{effort:"high"}` gives `{effort:"high"}`.
  - `last decision empty omitted`: `{}` gives no field.
  - `context rounded`: 33.6 gives 34.
  - `context clamped`: 140 gives 100, and -3 gives 0.
  - `context null omitted`.
  - `parseShortstat`:
    - `" 3 files changed, 70 insertions(+), 14 deletions(-)"` gives `{changed_files:3,diff_lines:84}`;
    - `" 1 file changed, 5 insertions(+)"` gives `{1,5}`;
    - `" 2 files changed, 4 deletions(-)"` gives `{2,4}`;
    - `""` gives `{0,0}`;
    - `"garbage"` gives `undefined`.
  - `first sentence`: `"Read a file. Supports images."` gives `"Read a file."`. A description with no period is cut to 200 code points.
  - `tool cap 40 by name`.
  - `agent cap 30 by name, description 200 code points`.
  - `no model or thinking in subagents`: the keys are exactly `name`, `description`, `tools`.
- [ ] **Step 2:** Run `bun test tests/jev/state.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - First sentence: the text up to and including the first `.`, `!` or `?` that is followed by whitespace or the end of the text, then `cutCodePoints(…, 200)`.
  - `parseShortstat` regex: `/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/`. Trimmed empty output gives `{0,0}`.
- [ ] **Step 4:** Run the same test file. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(jev): build last decision, context, git and capabilities fields`.

## Task 4: scanLanguages — implements 2.4

**Files:**
- Modify: `src/jev/workspace.ts`
- Test: `tests/jev/workspace.test.ts` (new)

**Interfaces:**
- Consumes `SKIP_DIRS`.
- Produces `scanLanguages(cwd): string[]`.

- [ ] **Step 1:** Write failing tests on temp trees:
  - `ranked languages`: 10 `.ts`, 4 `.py` and 1 `.go` give `["TypeScript","Python"]`.
  - `ties by name`.
  - `at most 5`.
  - `skipped directory`: only `node_modules/a.ts` gives `["none found"]`.
  - `too deep`: `a/b/c/d/x.ts` gives `["none found"]`, while `a/b/c/x.ts` counts.
  - `symlink skipped`.
  - `unreadable dir skipped`, using `chmod 000`. Skipped when `process.getuid?.() === 0`.
  - `stops at the entry cap`: 6000 files, and the scan stays under 1 s.
- [ ] **Step 2:** Run `bun test tests/jev/workspace.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as a breadth-first walk, depth 3 below `cwd`, counting each entry visited against 5000. Extension table:
  - TypeScript: `ts`, `tsx`, `mts`, `cts`
  - JavaScript: `js`, `jsx`, `mjs`, `cjs`
  - Python: `py`
  - Go: `go`
  - Rust: `rs`
  - Java: `java`
  - Kotlin: `kt`, `kts`
  - Swift: `swift`
  - C: `c`, `h`
  - C++: `cc`, `cpp`, `cxx`, `hpp`
  - C#: `cs`
  - Ruby: `rb`
  - PHP: `php`
  - Shell: `sh`, `bash`, `zsh`
  - Svelte: `svelte`
  - Vue: `vue`
  - Dart: `dart`
  - Elixir: `ex`, `exs`
  - Scala: `scala`
  - Lua: `lua`
  - SQL: `sql`
  - HTML: `html`
  - CSS: `css`, `scss`
  - Zig: `zig`
  - Haskell: `hs`

  Thresholds: a language needs at least 3 files and at least 5% of the recognised files.
- [ ] **Step 4:** Run the same test file. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(jev): language scan from file names`.

## Task 5: Host rich inputs — implements 3.1

**Files:**
- Create: `src/host/rich.ts`, `src/host/git.ts`
- Modify:
  - `src/host/agents.ts`: export `listAgents`
  - `src/host/main.ts`: `Ctx` gains `getContextUsage`; `MainDeps` gains `rich`; `lastDecided` state; one call in `decide`
  - `src/host/setup.ts`: wiring
- Test: `tests/host/rich.test.ts` (new), `tests/host/git.test.ts` (new), `tests/host/agents.test.ts`, `tests/host/main.test.ts`, `tests/host/q5-q6-main.test.ts`

**Interfaces:**
- Consumes `pickRich`, `SHIPPED_MAIN_GROUPS`, `scanLanguages`, `parseShortstat` and `readAgent`.
- Produces:
  - `listAgents(dirs: { cwd: string; agentDir: string }): AgentFacts[]`: name order, with project over global over built-ins.
  - `gitCounts(exec: (cmd: string, args: string[], o: { cwd: string; timeout: number }) => Promise<{ stdout: string; code: number; killed?: boolean; truncated?: boolean }>, cwd: string): Promise<GitCounts | undefined>`.
  - `buildRichInputs(i: { groups: readonly RichGroup[]; cwd: string; last?: { effort?: string; strategy?: string }; contextPercent: () => number | null | undefined; git?: Promise<GitCounts | undefined>; tools: () => { name: string; description: string }[]; agents: () => AgentFacts[] }): Promise<RichInputs>`.
  - `MainDeps.rich?: { groups: readonly RichGroup[]; git: (cwd: string) => Promise<GitCounts | undefined>; tools: () => {name: string; description: string}[]; agents: (cwd: string) => AgentFacts[] }`, where `groups` defaults to `SHIPPED_MAIN_GROUPS`.

- [ ] **Step 1:** Write the failing unit tests.
  - `git.test.ts`, using a fake `exec`:
    - `code 0 parses`;
    - `code 128 omits` (the "Not a repository" scenario);
    - `killed omits`;
    - `truncated omits`;
    - `throw omits`;
    - `slow exec omits after 500 ms`: the fake resolves at 2 s, the helper resolves `undefined` within 600 ms, and `Promise.race` is inside the helper.
  - `rich.test.ts`:
    - `only listed groups built`: the spy builders for unlisted groups are never called;
    - `a throwing group is omitted, others kept`;
    - `null percent omitted`.
  - `agents.test.ts`:
    - `listAgents merges project, global, builtin in name order`;
    - `project wins over global for the same name`.
- [ ] **Step 2:** Run `bun test tests/host/git.test.ts tests/host/rich.test.ts tests/host/agents.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the three units.
  - `gitCounts` runs `git diff HEAD --shortstat` and parses only when `code === 0 && !killed && !truncated`.
  - `listAgents` reuses the private `listAgentFiles` and `readAgent`.
- [ ] **Step 4:** Write the failing host tests.
  - `default request stays minimal` (`q5-q6-main.test.ts`, host harness, a git repo with changes, two prompts): the recorded Jev state has none of the five keys.
  - `last decision carried to the next prompt` (`main.test.ts`, with `rich.groups: ["last_decision"]`): prompt 2's state has `conversation.last_decision` equal to prompt 1's applied effort and strategy.
  - `last decision cleared on session start`.
  - `shipped git sent` (with `rich.groups: ["git"]` and a fake `git`).
- [ ] **Step 5:** Implement in `main.ts`.
  - Add `let lastDecided`. Set it in `write()` when `rec.answered`, from `rec.effective ?? rec.requested` and `rec.strategy`. Clear it in `sessionStart`.
  - In `decide`, start `const git = groups.includes("git") ? deps.rich.git(ctx.cwd) : undefined` before the first `await`, then `rich = await buildRichInputs(...)`. Task 6 extends the condition with the recorder.
  - Wire `setup.ts` with `git: (cwd) => gitCounts((c, a, o) => pi.exec(c, a, o), cwd)`, `tools` from `pi.getActiveTools()` joined with `pi.getAllTools()`, and `agents: (cwd) => listAgents({ cwd, agentDir: getAgentDir() })`.
- [ ] **Step 6:** Run `bun test tests/host && bun run lint && bun run typecheck`. Expected: PASS.
- [ ] **Step 7:** Commit: `feat(host): build shipped rich state inputs`.

## Task 6: Git count recorder — implements 3.2

**Files:**
- Create: `src/host/git-record.ts`
- Modify: `src/host/main.ts` (`MainDeps.record?`), `src/host/setup.ts`
- Test: `tests/host/git-record.test.ts` (new), `tests/host/main.test.ts`

**Interfaces:**
- Consumes the shared `git` promise from Task 5.
- Produces `recordGitCounts(i: { dir: string; at: number; session: string; turnId: string; counts: Promise<GitCounts | undefined> }): Promise<void>` and `MainDeps.record?: { on: () => boolean; dir: () => string; git: (cwd: string) => Promise<GitCounts | undefined> }`.
- In `setup.ts`: `on` is `process.env.JEV_REPLAY_GIT === "1"`, `dir` is `jevDir()`, and `git` is the same `gitCounts` wiring as `rich.git`.
- `decide` makes the git call once when either the `git` group is shipped or `record.on()` holds, and passes the same promise to both.

- [ ] **Step 1:** Write the failing unit tests in `git-record.test.ts`:
  - `line written`: the keys are exactly `v, at, session, turnId, changedFiles, diffLines`, with 2 and 9.
  - `no names stored`: neither `JEV-MARKER-DIR` nor `JEV-MARKER-FILE` appears, even with a real temp repo through `gitCounts`.
  - `owner-only`: modes `0600` and `0700`.
  - `unknown counts write nothing`.
  - `write failure swallowed`: a read-only directory; resolves, does not throw.
  - `cap reached`: 5000 lines, nothing appended.
  - `two appends give two whole lines`.
- [ ] **Step 2:** Write the failing host tests in `main.test.ts`:
  - `off by default`: `record.on()` is false; no file, and `git` is never called.
  - `no line without a request`: a child session.
  - `write failure keeps the decision`: the applied level equals the level without the recorder.
  - `session is the opaque id`: the line's `session` equals the harness session id, and the file contains no `/`.
- [ ] **Step 3:** Run the tests. Expected: FAIL.
- [ ] **Step 4:** Implement.
  - The line cap is counted by newlines. The file is read only when it is smaller than `5000 * 512` bytes; at that size or more, it counts as full.
  - Write with `appendFileSync(path, line, { mode: 0o600, flag: "a" })` after `mkdirSync(dir, { recursive: true, mode: 0o700 })`, all inside `try/catch`.
  - `main.ts` calls it with `void`, after a main request is sent, and never awaits it on the request path.
- [ ] **Step 5:** Run the tests. Expected: PASS.
- [ ] **Step 6:** Commit: `feat(host): opt-in git count recorder for replay`.

## Task 7: Session reader and corpus — implements 4.1, 4.2

**Files:**
- Create: `scripts/replay/sessions.ts`, `scripts/replay/corpus.ts`, and `tests/fixtures/replay/sessions/**.jsonl` (synthetic, no real text)
- Test: `tests/replay/sessions.test.ts`, `tests/replay/corpus.test.ts`

**Interfaces:** Produces:
- `readSessionFile(path): { header: { id: string; cwd: string }; entries: SessionEntryLike[] }`
- `branchTo(entries, entryId): SessionEntryLike[]`, which follows `parentId` back to the root
- `mainSamples(dir): MainSample[]`, where `MainSample = { session: string; cwd: string; entryId: string; prompt: string; branch: SessionEntryLike[]; startEffort?: string }`
- `readLedgerLines(dir): Map<string, { effective?: string; strategy?: string; from?: string }>`: a local line parser over `ledger.jsonl` and `ledger.1.jsonl` that keeps `kind: "main"` lines and skips invalid ones
- `workerSamples(dir): WorkerSample[]`, where `WorkerSample = { session: string; agent: string; brief: string; description?: string; parentPrompt?: string; runInBackground: boolean }`
- `sample<T>(items: T[], n: number, seed: number, stratum: (t: T) => string): T[]`

- [ ] **Step 1:** Write failing tests:
  - `skips corrupt lines`.
  - `branch follows parentId`.
  - `exclusions`: `/jev status`, `<skill` prompts, child sessions (a session whose header has `parentSession`) and duplicates are all excluded.
  - `ledger lines parsed, bad lines skipped`.
  - `same seed, same corpus`.
  - `different seed differs`.
  - `stratified`: each stratum's share is within one sample of proportional.
  - `worker samples come from subagent tool calls`.
- [ ] **Step 2:** Run `bun test tests/replay`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - Seeded PRNG: mulberry32.
  - Proportional allocation by stratum with largest remainder, then a shuffle within each stratum.
  - Main stratum: `${cwd}|${startEffort ?? "unknown"}`. `startEffort` is the `requested` of the `jev-pilot:effort` entry following the prompt, or the `from` of the ledger line matching the following `jev-turn`.
  - Worker kind: `review` when the agent name or description matches `/review|audit|verif/i`, `scout` for `/scout|explore|research/i`, otherwise `implementation`.
- [ ] **Step 4:** Run the tests and `bun run lint`. Expected: PASS, and lint shows no `scripts/` boundary errors.
- [ ] **Step 5:** Commit: `feat(replay): read sessions and sample the corpus`.

## Task 8: Replay inputs — implements 4.3

**Files:**
- Create: `scripts/replay/inputs.ts`
- Test: `tests/replay/inputs.test.ts`

**Interfaces:**
- Consumes `branchItems`, `scanPlatforms`, `scanLanguages`, `parseShortstat` and the Task 7 types.
- Produces:
  - `rebuildRich(sample: MainSample, ctx: { ledger: ReturnType<typeof readLedgerLines>; models: Map<string, number>; capabilities?: Snapshot; git?: Map<string, GitCounts> }): { rich: RichInputs; missing: RichGroup[] }`;
  - `readSnapshot(path): Snapshot`, where `Snapshot = { v: 1; tools: { name: string; description: string }[]; agents: AgentFacts[] }`;
  - `agentFacts(snapshot: Snapshot | undefined, name: string): AgentFacts | undefined`.

- [ ] **Step 1:** Write failing tests:
  - `last decision from the earlier port`: a `jev-pilot:effort` entry with `requested: "high"` and `decision.strategy: "direct"`.
  - `last decision from jev-turn and ledger`.
  - `context from usage`: `totalTokens` 50000 with a 200000 window gives 25.
  - `context unknown after compaction`.
  - `missing cwd`: languages is listed in `missing`.
  - `unmatched git count`.
  - `same state as live`: drive the host harness (`tests/host/harness.ts`, as in `q5-q6-main.test.ts`) with a session whose branch matches a fixture. The recorded Jev request `state` equals `mainState({ prompt, items: branchItems(fixture branch), platforms })` built by the script path.
  - `worker agent missing from snapshot`: `agentFacts` returns `undefined`.
  - `bad snapshot throws`: an unreadable file or `v` other than 1 throws `SnapshotError`, which the CLI maps to exit code 2.
- [ ] **Step 2:** Run `bun test tests/replay/inputs.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement as the design (D3) describes. The models map is parsed from saved `pi --list-models` output, whose columns are `provider`, `model` and `context`, with `1M` read as 1_000_000 and `200K` as 200_000.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(replay): rebuild rich inputs from local data`.

## Task 9: Variant plans — implements 4.4

**Files:**
- Create: `scripts/replay/variants.ts`
- Test: `tests/replay/variants.test.ts`

**Interfaces:**
- Consumes `mainState`, `mainQuestions`, `buildWorkerState`, `buildWorkerQuestions` and `offeredTiers`.
- Produces `planPass(pass: 1 | 2, input: { main: RebuiltMain[]; workers: RebuiltWorker[]; config: PlainConfig; hasSnapshot: boolean; kept?: readonly RichGroup[] }): Plan`, where:
  - In pass 1, `full` is all four pass 1 groups. In pass 2, `full` is `kept` (the groups shipped after Task 13) plus `git`, and `full-git` is `kept`. Pass 2 plans no worker variants and lists no worker skip.
  - `Plan = { requests: PlannedRequest[]; skipped: string[]; excluded: Record<string, number> }`;
  - `PlannedRequest = { variant: string; base: string; sample: number; kind: "main" | "worker"; state: unknown; questions: unknown; specs: Record<string, QuestionSpec> }`.

- [ ] **Step 1:** Write failing tests:
  - `add-one`: `+languages` equals minimal plus languages.
  - `leave-one-out`: `full-languages` equals full minus languages.
  - `reversed options`: `effort-reversed` criteria keys are `max, xhigh, high, medium, low`, and its state is minimal.
  - `reruns present`: `rerun-a` and `rerun-b` exist for the main and worker bases.
  - `no capabilities snapshot`: there is no `+capabilities`, no `full-capabilities` and no worker variant; `full` excludes capabilities; `plan.skipped` lists `capabilities` and `workers`.
  - `missing inputs excluded`: a sample whose `missing` holds `languages` is absent from `+languages` and `full-languages`, and `plan.excluded["+languages"]` is 1.
  - `pass 2 variants`: with `kept: ["languages"]`, the variants are exactly `minimal, rerun-a, rerun-b, full, +git, full-git`; `full` has `languages` and `git`, `full-git` has only `languages`, and `skipped` is empty.
  - `worker variants`: `parent-request` sets `parent_request`; `no-description` empties `agent.description`; `no-instructions` empties `instructions_excerpt`; nothing else differs.
  - `skills never asked`: the main questions have no `which`.
- [ ] **Step 2:** Run `bun test tests/replay/variants.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Main questions use `mainQuestions({ askEffort: true, askStrategy: true })`. Worker questions use the config's tiers, slots, mode and expert switch, read as plain JSON.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(replay): build variant plans`.

## Task 10: Runner and comparison — implements 4.5, 4.6

**Files:**
- Create: `scripts/replay/run.ts`, `scripts/replay/compare.ts`
- Test: `tests/replay/run.test.ts`, `tests/replay/compare.test.ts`

**Interfaces:**
- Consumes `askJev`, `readAnswers`, `decideEffort`, `CORRECTION_THRESHOLD`, `readWorkerOutcome` (`src/policy/worker.ts`), `routeLaunch` (`src/policy/route.ts`, for the final worker tier and effort) and `Plan`.
- Produces:
  - `estimate(plan): { requests: number; bytes: number; usd: number }`, at $0.042 per million input tokens and 4 bytes per token;
  - `runPlan(plan, opts: { url; apiKey; model; send: boolean; concurrency?: 8; timeoutMs?: 5000 }): Promise<Result[]>`;
  - `compare(plan, results): Aggregates`;
  - `writeOutputs(dir, aggregates, cases): void`.

- [ ] **Step 1:** Write failing tests, against the loopback fixture:
  - `dry run makes no request`: `fixture.requests.length === 0`, and the estimate has a request count and a cost.
  - `send makes counted requests`: the number of requests equals the estimate.
  - `retry succeeds`: 500, then ok; no miss.
  - `miss excluded`: 500 twice; the variant misses 1, and the pair is absent.
  - `within noise`: 3 flips with reruns at 2 and 4 is not beyond.
  - `beyond noise`: 12 strategy flips with reruns at 1 and 2 is beyond.
  - `aggregates hold no text`: `JEV-MARKER-PROMPT` is absent from `aggregates.json` and present in `cases.md`.
  - `owner-only outputs`.
  - `aggregates written only on completion`: a throw mid-run leaves no `aggregates.json`.
  - `nothing in the repository`: with `PI_CODING_AGENT_DIR` set to a temp directory, `git status --porcelain` shows no change after the run.
  - `exclusions and skips reported`: `plan.skipped` and `plan.excluded` are copied into `aggregates.json`, under `skipped` and per variant under `excluded`.
- [ ] **Step 2:** Run `bun test tests/replay/run.test.ts tests/replay/compare.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - Decided keys per kind:
    - main: `effort` from `decideEffort` with all five levels supported, `tier`, `strategy`, `risky>.7` and `corrects>=CORRECTION_THRESHOLD`;
    - worker: the final tier and effort from `routeLaunch` over `readWorkerOutcome`, using the config's tiers, slots and mode. The launch is built as unlocked, not forked, not resumed, with no model or thinking override, and `runInBackground` taken from the sample. Covered by a `compare` test, `worker keys from routeLaunch`.
  - Noise for a key is the larger rerun flip count.
  - Write `cases.md` entries with `cutCodePoints(text, 300)`.
  - Write `aggregates.json` with a temp file and a rename, mode `0600`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(replay): run requests and compare against noise`.

## Task 11: CLI, snapshot procedure, docs — implements 4.7, 4.8

**Files:**
- Create: `scripts/replay/cli.ts`, `tests/host/manual/capabilities-snapshot.ts`
- Modify: `docs/testing.md` (replay procedure, snapshot, `JEV_REPLAY_GIT`), `docs/privacy.md` (the recorder file under "What is stored locally"), `tests/host/manual-excluded.test.ts` (if it lists the manual files)
- Test: `tests/replay/cli.test.ts`

**Interfaces:** Consumes Tasks 7–10. Produces the CLI contract.

- [ ] **Step 1:** Write failing tests:
  - `parses flags with defaults`: seed 1, main 100, workers 46, pass required.
  - `rejects unknown flag`.
  - `dry run prints counts and cost`: spawn `bun scripts/replay/cli.ts --pass 1 --sessions <fixture> --url <loopback>` and check that stdout matches `/requests: \d+/` and `/\$\d+\.\d{2}/`.
  - `reads the config as plain JSON`.
  - `missing key with --send exits 2`.
- [ ] **Step 2:** Run `bun test tests/replay/cli.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
  - The key comes from the env var named in `config.classifier.apiKeyEnv`, defaulting to `TYPESAFE_API_KEY`.
  - Paths come from `PI_CODING_AGENT_DIR`, falling back to `~/.pi/agent`.
  - The snapshot script is a probe run through the host harness. It writes `{ v: 1, tools: active tools with descriptions, agents: listAgents(...) }` owner-only to the path given as `argv[2]`.
  - Document the snapshot as a manual procedure, the same way as `cli-review-real.ts`.
- [ ] **Step 4:** Run `bun test && bun run typecheck && bun run lint && bun run fmt:check`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(replay): CLI and manual snapshot procedure`.

## Task 12: Pass 1 run (operator-gated) — implements 5.1, 5.2, 5.3, 5.4

- [ ] **Step 1:** Save the inputs to a scratch directory outside the repository:
  - `pi --list-models > <scratch>/models.txt`
  - `bun tests/host/manual/capabilities-snapshot.ts <scratch>/cap.json`
- [ ] **Step 2:** Dry-run `bun scripts/replay/cli.ts --pass 1 --capabilities <scratch>/cap.json --models <scratch>/models.txt`. Send the operator, in the Inbox, the sample sizes, variant list, exclusions, request count and USD estimate. **Stop until they approve.**
- [ ] **Step 3:** Run the same command with `--send`. Attach `aggregates.json` and `cases.md` privately, from `<agentDir>/jev/replay/<run-id>/`. Ask one `:::question` per group and per worker field (Keep or Remove), and one for the effort order if it is beyond noise. **Stop until they answer.**
- [ ] **Step 4:** Write `docs/evidence/<date>-state-replay.md` from `aggregates.json`, in the style of `2026-11-07-replay.md`: data, variants, flips against noise, exclusions, and decisions. Commit: `docs: WG-16 pass 1 evidence`.

## Task 13: Apply pass 1 decisions — implements 5.5

Apply only the items the operator decided in Task 12. Each change carries its own test.

- [ ] **Step 1: Kept main group.**
  - Add it to `SHIPPED_MAIN_GROUPS`.
  - Update the `Field set` scenario in this change's `specs/main-state/spec.md` and its test. Also update `shipped list starts empty` (Task 2) and `default request stays minimal` (Task 5): they now assert exactly the kept groups.
  - Add the field to `docs/privacy.md`, and remove it from the IMPORTANT note in `docs/jev-contract.md`.
- [ ] **Step 2: Removed main group.**
  - Delete its builder, its `RichGroup` member, its `buildRichInputs` branch and its tests.
  - Delete its requirement from `specs/main-state/spec.md`, and its rule from `docs/jev-contract.md`.
- [ ] **Step 3: Changed worker field.**
  - Add `specs/worker-request/spec.md` (MODIFIED), edit `buildWorkerState` and its tests, and update `docs/jev-contract.md` (Worker state) and `docs/privacy.md`.
  - If `parent_request` should become the default, **ask first**, since it changes a documented default. Then update `src/store/defaults.ts`, `docs/configuration.md` and the `settings-resolution` delta.
- [ ] **Step 4: Effort order.** If the operator picked an order, fix it in `src/jev/questions.ts` with a test, and record it in `docs/jev-contract.md`.
- [ ] **Step 5:** Run `openspec validate wg-16-rich-state-replay --strict && bun test && bun run lint && bun run typecheck`. Commit: `feat: apply WG-16 pass 1 decisions`.

## Task 14: Pass 2, git (operator-gated) — implements 6.1, 6.2, 6.3, 6.4

- [ ] **Step 1:** Ask the operator to set `JEV_REPLAY_GIT=1` in their shell profile. After a few days, report the line count in `<agentDir>/jev/replay-git.jsonl`.
- [ ] **Step 2:** Dry-run `--pass 2 --kept <groups kept in Task 13>`, then send the counts, exclusions (unmatched `turnId`) and the cost. **Stop until they approve.** Then run with `--send`, and ask Keep or Remove for git. **Stop until they answer.**
- [ ] **Step 3:** Write `docs/evidence/<date>-git-replay.md`.
- [ ] **Step 4:** Apply the decision.
  - **Keep git:**
    - Add `git` to `SHIPPED_MAIN_GROUPS`, and keep `parseShortstat`, `gitCounts` and `MainDeps.rich.git`.
    - Remove `src/host/git-record.ts`, `MainDeps.record`, their tests, `JEV_REPLAY_GIT` from the docs, and `specs/git-count-record/`. They exist only for replay, and archiving would otherwise ship them.
  - **Remove git:**
    - Delete the `git` group, `gitCounts`, `MainDeps.rich.git`, `src/host/git-record.ts`, `MainDeps.record` and their tests, along with the "Git counts" requirement and `specs/git-count-record/`.
    - Keep `parseShortstat` only if `scripts/replay` still uses it. Otherwise delete it as well, together with the pass 2 code in `scripts/replay`.
  - If the operator wants the recorder kept for later replays, ask, and keep `specs/git-count-record/` as-is.
- [ ] **Step 5:**
  - Set WG-16 to Done in `docs/roadmap.md`.
  - Update the IMPORTANT note in `docs/jev-contract.md`.
  - Remove the "Pending validation" line from `docs/privacy.md`.
  - Run `openspec validate wg-16-rich-state-replay --strict && bun test && bun run lint`.
  - Commit: `docs: close WG-16`.

---

## Scenario → test

- Field set → `tests/jev/state.test.ts` existing `mainState` field-set test (updated in Task 13 if groups ship)
- Rich inputs ignored unless shipped → `tests/host/q5-q6-main.test.ts` `default request stays minimal`
- (host) Previous turn carried → `tests/host/main.test.ts` `last decision carried to the next prompt`
- One group alone → `tests/jev/state.test.ts` `one group alone`
- Every group → `tests/jev/state.test.ts` `every group`
- Previous turn known → `tests/jev/state.test.ts` `last decision kept`
- Unknown context → `tests/jev/state.test.ts` `context null omitted`
- Rounded percentage → `tests/jev/state.test.ts` `context rounded`
- Shortstat parsed → `tests/jev/state.test.ts` `parseShortstat` (3 files case)
- Insertions only → `tests/jev/state.test.ts` `parseShortstat` (insertions only)
- Not a repository → `tests/host/git.test.ts` `code 128 omits`
- Ranked languages → `tests/jev/workspace.test.ts` `ranked languages`
- Skipped directory (languages) → `tests/jev/workspace.test.ts` `skipped directory`
- Too deep → `tests/jev/workspace.test.ts` `too deep`
- First sentence → `tests/jev/state.test.ts` `first sentence`
- Caps → `tests/jev/state.test.ts` `tool cap 40 by name`
- Agent caps → `tests/jev/state.test.ts` `agent cap 30 by name, description 200 code points`
- Off by default → `tests/host/main.test.ts` `off by default`
- Line written → `tests/host/git-record.test.ts` `line written`
- No line without a request → `tests/host/main.test.ts` `no line without a request`
- No names stored → `tests/host/git-record.test.ts` `no names stored`
- Write failure → `tests/host/main.test.ts` `write failure keeps the decision`, plus `tests/host/git-record.test.ts` `write failure swallowed`
- Cap reached → `tests/host/git-record.test.ts` `cap reached`
- Lint boundary → `tests/boundaries.test.ts` plus `bun run lint` (existing `scripts/**` rule)
- Same state as live → `tests/replay/inputs.test.ts` `same state as live`
- Same seed, same corpus → `tests/replay/corpus.test.ts` `same seed, same corpus`
- Exclusions → `tests/replay/corpus.test.ts` `exclusions`
- Last decision from the earlier port → `tests/replay/inputs.test.ts` `last decision from the earlier port`
- Missing cwd → `tests/replay/inputs.test.ts` `missing cwd`, plus `tests/replay/variants.test.ts` `missing inputs excluded`, plus `tests/replay/compare.test.ts` `exclusions and skips reported`
- Unmatched git count → `tests/replay/inputs.test.ts` `unmatched git count`
- No capabilities snapshot → `tests/replay/variants.test.ts` `no capabilities snapshot`, plus `tests/replay/compare.test.ts` `exclusions and skips reported`
- Worker agent missing from snapshot → `tests/replay/inputs.test.ts` `worker agent missing from snapshot`, plus `tests/replay/variants.test.ts` `missing inputs excluded`
- Add-one variant → `tests/replay/variants.test.ts` `add-one`
- Reversed options → `tests/replay/variants.test.ts` `reversed options`
- Reruns present → `tests/replay/variants.test.ts` `reruns present`
- Dry run → `tests/replay/run.test.ts` `dry run makes no request`
- Send → `tests/replay/run.test.ts` `send makes counted requests`
- Miss excluded → `tests/replay/run.test.ts` `miss excluded`
- Retry succeeds → `tests/replay/run.test.ts` `retry succeeds`
- Within noise → `tests/replay/compare.test.ts` `within noise`
- Beyond noise → `tests/replay/compare.test.ts` `beyond noise`
- Aggregates hold no text → `tests/replay/compare.test.ts` `aggregates hold no text`
- Nothing in the repository → `tests/replay/compare.test.ts` `nothing in the repository`

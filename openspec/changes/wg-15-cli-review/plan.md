# CLI Review Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Ship `jev_review` and `/jev cli-review` (F4), running Codex or OpenCode read-only through `pi.exec`, absent in child sessions.

**Architecture:** Pure argument, catalog, tier and result logic in `src/host/review-cli.ts`; the Pi-facing tool, run loop and child hiding in `src/host/review.ts`; the command form in `src/host/commands.ts`; wiring in `src/host/setup.ts`. Every process runs through an injected `Exec` matching `pi.exec`, so unit tests use a fake and host tests use a fake CLI script on `PATH`.

**Tech Stack:** TypeScript, Bun test, Pi 1.5.0 (`pi.registerTool`, `pi.exec`, `before_agent_start`), `typebox` (provided by Pi), oxlint, oxfmt.

## Global Constraints

- No runtime `dependencies`; `typebox` is imported, not added. Pi's loader maps `typebox` and `typebox/value` for loaded extensions; Bun tests and `bun check` resolve it from `node_modules/typebox` (1.3.27, transitive through the pinned Pi devDependency). Adding it as a devDependency needs the operator's approval and is not planned.
- Only `host/` imports Pi; `review-cli.ts` imports nothing from Pi.
- Tests: no secrets, paid calls or network beyond loopback. The real-CLI run is manual and not in CI.
- Never store the brief, prompt or CLI output in the ledger, `state.json`, session entries or package files.
- English in code, docs and commits.
- Constants: attempt timeout `600_000` ms, `maxBuffer` `8 * 1024 * 1024`, catalog timeout `30_000` ms, brief max `20_000`, stderr tail 20 lines / 4000 chars, suggestions ≤ 5.

## Review Focus

1. Brief containing quotes, newlines, `$()`, or starting with `-` → passed verbatim as one argument, never interpreted (`shell: false`); Task 2 test `prompt keeps shell metacharacters`.
2. A tier stored as `Luna` with a catalog listing `gpt-6-luna` and `gpt-5.10-luna` → `gpt-5.10-luna` loses to `gpt-6-luna`, and `gpt-5.10-luna` beats `gpt-5.9-luna` (numeric, not lexical); Task 3 test `resolveTier compares numbers`.
3. A killed first attempt leaving a partial `-o` file → the retry never reads it; Task 5 test `removes the output file before each attempt`.
4. `codex debug models` printing JSON with extra fields or a non-JSON banner → parser returns `[]`, and the command falls back to accept-with-warning; Task 3 test `parseCodexCatalog tolerates junk`.
5. `/jev cli-review` in a child session → nothing happens, as with every `/jev` form; Task 7 test `cli-review is inert in a child`.

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `jev_review` tool | new | name `jev_review`; parameters `{ brief: string (1..20000), reviewer?: "codex" \| "opencode", model?: string /^[A-Za-z0-9._][A-Za-z0-9._:/-]{0,127}$/, effort?: string /^[A-Za-z0-9._-]{1,64}$/ }`; result `content: [{type:"text", text}]`, `isError?: true`, `details: ReviewDetails` | yes |
| `ReviewDetails` | new | `{ cli: "codex"\|"opencode"; model?: string; effort?: string; exitCode?: number; attempts: 1\|2; outcome: "ok"\|"timeout"\|"cancelled"\|"not-found"\|"exit-error"\|"truncated"\|"exec-error" }` | yes (visible to scripts) |
| `/jev cli-review` | new | `/jev cli-review <codex\|opencode> [<model>\|default] [<effort>\|default]`; reviewer case-sensitive; ≤ 4 words | yes |
| `state.json` `cliReview.model` | modified | `^[A-Za-z0-9._][A-Za-z0-9._:/-]{0,127}$`, not `default` (was `^[A-Za-z0-9._-]{1,64}$`) | yes |
| Codex command | modified (docs) | `codex exec [-m M] [-c model_reasoning_effort="E"] -s read-only --skip-git-repo-check --ephemeral -C <cwd> -o <out> <prompt>` | yes |
| OpenCode command | modified (docs) | `opencode run [-m P/M[#E]] --agent plan <prompt>`, cwd = session cwd | yes |
| Status report line | new | `cli review: <cli> (model <m>, effort <e>)`, with only the parts set, or `cli review: <cli> (CLI defaults)` | yes |
| Usage line | new | `  /jev cli-review <codex\|opencode> [model\|default] [effort\|default]` | yes |
| Success header | new | `<Codex\|OpenCode> review (model <m>, effort <e>):`, parts omitted when unset; `<Codex\|OpenCode> review (the CLI's default model and effort):` when both unset | yes |
| Failure text | new | `The <Codex\|OpenCode> review did not run: <reason>.` then ` Exit code <n>.` when the process exited by itself, then a blank line and the stderr tail. Reasons: `<cli> not found`, `exited with an error`, `timed out twice after 10 minutes`, `cancelled`, `output exceeded 8 MiB`, `could not start (<ErrorName>)` | yes |
| `ExecResult` | new (internal) | `{ stdout: string; stderr: string; code: number; killed: boolean; truncated: boolean }` (mirror of Pi's, declared in `review-cli.ts`) | no |
| `runJev` deps | modified (internal) | `{ dir: string; load: () => Snapshot; exec: Exec }` | no |
| `registerReviewTool` deps | new (internal) | `(pi, deps?: { load?: () => Snapshot; exec?: Exec })`, defaults `loadSnapshot(pi)` and `pi.exec` | no |
| `Exec` | new (internal) | `(command: string, args: string[], options: { cwd?: string; timeout?: number; signal?: AbortSignal; maxBuffer?: number }) => Promise<{ stdout: string; stderr: string; code: number; killed: boolean; truncated: boolean }>` | no |
| `ReviewChoice` | new (internal) | `{ cli: "codex"\|"opencode"; model?: string; effort?: string }` | no |
| `CodexModel` | new (internal) | `{ slug: string; name: string; efforts: string[] }` | no |
| `CheckResult` | new (internal) | `{ ok: true; model?: string; effort?: string } \| { ok: false; message: string; suggestions: string[] }` | no |
| `JevArgs` | modified (internal) | adds `{ kind: "cli-review"; cli: "codex"\|"opencode"; model?: string; effort?: string }` | no |

---

## Task 1: Widen the state model rule — implements 1.1

**Files:** Modify `src/store/state-file.ts`; Test `tests/store/state-file.test.ts`

**Interfaces:** Produces the `state.json` `cliReview.model` contract.

- [ ] **Step 1:** Add tests: `cliReview {"cli":"opencode","model":"ollama-cloud/gpt-oss:120b"}` reads `ok` with that model; `model: "-m"` reads malformed with a problem at `cliReview.model`; `model` of 129 characters is malformed; `effort: "a/b"` stays malformed. Keep existing `default` test.
- [ ] **Step 2:** Run `bun test tests/store/state-file.test.ts`; expect the OpenCode-id test to FAIL.
- [ ] **Step 3:** Split `cliValue` into `cliModel` (pattern above) and `cliEffort` (old pattern), both refusing `default`.
- [ ] **Step 4:** Run the file; expect PASS. Run `bun test tests/store`; expect PASS.
- [ ] **Step 5:** Commit `feat(state-file): accept OpenCode model ids in cliReview`.

## Task 2: Prompt and argument builders — implements 2.1, 2.2

**Files:** Create `src/host/review-cli.ts`; Modify `.oxlintrc.json`; Test `tests/host/review-cli.test.ts`, `tests/boundaries.test.ts` fixtures if needed

**Interfaces:** Produces `REVIEW_INSTRUCTIONS: string`, `buildPrompt(brief: string): string`, `codexArgs(c: { model?: string; effort?: string; cwd: string; out: string; prompt: string }): string[]`, `opencodeArgs(c: { model?: string; effort?: string; prompt: string }): string[]`, and the types `ReviewChoice`, `Exec`, `ExecResult`, `ReviewDetails` (Contracts).

- [ ] **Step 1:** Tests:
  - `instructions match the docs`: take the first ```` ```text ```` fence after `### CLI review instructions` in `docs/jev-questions.md`, without its final newline; `expect(REVIEW_INSTRUCTIONS).toBe(block)`.
  - `review-cli imports nothing from Pi`: lint fixture or a test reading `src/host/review-cli.ts` asserting no `@earendil-works/` import.
  - `prompt layout`: `buildPrompt("-rf everything")` equals `REVIEW_INSTRUCTIONS + "\n\nThe change:\n-rf everything"`; first line is `Review a code change in this repository, read-only: don't edit anything.`
  - `prompt keeps shell metacharacters`: brief `a "b" $(c)\nd` appears verbatim.
  - `codex with model and effort`: `["exec","-m","gpt-6-luna","-c",'model_reasoning_effort="high"',"-s","read-only","--skip-git-repo-check","--ephemeral","-C","/work/repo","-o","/t/out","P"]`.
  - `codex without model or effort`: `["exec","-s","read-only","--skip-git-repo-check","--ephemeral","-C","/w","-o","/t/out","P"]`.
  - `opencode with model and effort`: `["run","-m","ollama-cloud/glm-5.3#high","--agent","plan","P"]`.
  - `opencode effort without a model`: `["run","--agent","plan","P"]`.
- [ ] **Step 2:** Run `bun test tests/host/review-cli.test.ts`; expect FAIL (module missing).
- [ ] **Step 3:** Implement the constant and the three functions. Add an `.oxlintrc.json` override for `src/host/review-cli.ts` banning `@earendil-works/*` (message: `review-cli.ts stays free of Pi imports.`), placed after the `src/host/**` override.
- [ ] **Step 4:** Run; expect PASS. `bun run lint` and `bun test tests/boundaries.test.ts`; expect PASS.
- [ ] **Step 5:** Commit `feat(cli-review): prompt and command builders`.

## Task 3: Catalogs, tiers and checks — implements 2.3, 2.4, 2.5

**Files:** Modify `src/host/review-cli.ts`; Test `tests/host/review-cli.test.ts`

**Interfaces:** Produces `parseCodexCatalog(stdout: string): CodexModel[]`, `parseOpencodeModels(stdout: string): string[]`, `isTier(model: string): boolean`, `resolveTier(tier: string, catalog: CodexModel[]): string | undefined`, `checkCodexChoice(model: string | undefined, effort: string | undefined, catalog: CodexModel[]): CheckResult`, `checkOpencodeChoice(model: string | undefined, effort: string | undefined, ids: string[]): CheckResult`.

- [ ] **Step 1:** Tests (fixture JSON shaped like `{"models":[{slug,display_name,visibility,supported_reasoning_levels:[{effort}]}]}`):
  - `parseCodexCatalog keeps visible models`: `hide` entries dropped; missing `visibility` kept; efforts mapped.
  - `parseCodexCatalog tolerates junk`: `"banner\n{"` and `{"models":5}` return `[]`.
  - `parseOpencodeModels`: trims, drops blank lines and lines without `/`.
  - `isTier`: `luna`, `Sol` true; `gpt-5.6-luna`, `p/m`, `luna2` false.
  - `resolveTier compares numbers`: catalog `gpt-5.6-luna`, `gpt-6-luna`, `gpt-5.10-luna` → `gpt-6-luna`; without `gpt-6-luna` → `gpt-5.10-luna`; `Luna` same as `luna`; unknown tier → `undefined`.
  - `checkCodexChoice`: `luna`+`high` ok `{model:"luna",effort:"high"}`; `Luna` ok `{model:"Luna"}`; `GPT-5.6-Luna` ok `{model:"gpt-5.6-luna"}`; `nova` fails with suggestions like `luna (now gpt-6-luna)`, at most 5; `luna`+`ultra` fails with suggestions `["low","high"]`; hidden slug as pinned fails; `undefined` model + `high` ok unchecked.
  - `checkOpencodeChoice`: exact id ok; `glm-5.3` with one provider → full id; with two providers fails listing both; `default` model + effort fails with message naming that an OpenCode effort needs a model; unknown fails with ids containing the text, ≤ 5.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. Version compare: `slug.match(/\d+/g)` as numbers, element-wise, missing = 0.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(cli-review): model catalogs, tiers and checks`.

## Task 4: Effective choice and result shaping — implements 2.6, 2.7

**Files:** Modify `src/host/review-cli.ts`; Test `tests/host/review-cli.test.ts`

**Interfaces:** Produces `effectiveChoice(defaults: ReviewChoice, call: { reviewer?: "codex"|"opencode"; model?: string; effort?: string }): ReviewChoice`, `classifyAttempt(r: ExecResult, aborted: boolean): ReviewDetails["outcome"]`, `formatSuccess(choice: ReviewChoice, output: string): string`, `formatFailure(cli: "codex"|"opencode", outcome, r?: ExecResult): string`, `stderrTail(stderr: string): string`.

- [ ] **Step 1:** Tests:
  - `effectiveChoice`: default `{codex,luna,high}` + `{reviewer:"opencode"}` → `{cli:"opencode"}`; + `{model:"gpt-5.6-sol"}` → `{codex, gpt-5.6-sol}` (no effort); + `{effort:"low"}` on `{codex,gpt-5.6-luna}` → both; + `{reviewer:"codex"}` keeps model and effort.
  - `classifyAttempt`: `{code:0}` ok; `killed` not truncated not aborted → timeout; `truncated` → truncated (even with code 0); aborted → cancelled; `code:1, stdout:"", stderr:"spawn codex ENOENT"` → not-found; `code:1, stderr:"bad flag"` → exit-error.
  - `formatSuccess`: first line `Codex review (model gpt-6-luna, effort high):`; no model/effort → `Codex review (the CLI's default model and effort):`; output trimmed.
  - `formatFailure`: starts `The Codex review did not run:`; exit-error contains `Exit code 3.`; timeout contains `timed out twice after 10 minutes` and no `Exit code`; cancelled contains `cancelled` and no `Exit code`; not-found contains `codex not found`; truncated contains `output exceeded 8 MiB`; exec-error contains `could not start (TypeError)`.
  - `stderrTail`: 30 lines → last 20 only; 10 000 chars → last 4000.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(cli-review): choice merge and result text`.

## Task 5: Run loop — implements 3.1

**Files:** Create `src/host/review.ts`; Test `tests/host/review.test.ts`

**Interfaces:** Consumes Tasks 2–4. Produces `runReview(exec: Exec, input: { choice: ReviewChoice; brief: string; cwd: string; signal?: AbortSignal }): Promise<{ text: string; isError: boolean; details: ReviewDetails }>`.

- [ ] **Step 1:** Tests with a recording fake `Exec`:
  - `codex success reads -o`: fake writes `VERDICT: PASS` to the path after `-o`, stdout `noise` → text has `VERDICT: PASS`, not `noise`; `isError` false.
  - `empty -o falls back to stdout`.
  - `output directory placement and cleanup`: during the call the `-o` parent is under `os.tmpdir()` with mode `0o700`; after success, failure and timeout it no longer exists.
  - `removes the output file before each attempt`: attempt 1 writes `PARTIAL` then returns killed; attempt 2 checks the file is absent, then writes `OK` → text has `OK`, not `PARTIAL`.
  - `timeout then success`: 2 CLI calls, attempts 2. `two timeouts`: 2 calls, outcome `timeout`. `exit 2 not retried`: 1 call. `truncated not retried`: 1 call, outcome `truncated`. `cancelled`: abort during attempt 1 → 1 call, outcome `cancelled`.
  - `exec throws`: outcome `exec-error`, `isError` true, no throw.
  - `tier resolved per run`: model `luna`, fake `codex debug models` returns catalog with `gpt-6-luna` → CLI args have `-m gpt-6-luna`, header names `gpt-6-luna`. Catalog exit 1 → `-m luna`. Pinned `gpt-5.6-luna` → no `debug models` call.
  - `opencode uses cwd and stdout`: `exec` called with `"opencode"` and `options.cwd` = input cwd.
  - `failure does not switch reviewer`: codex exit 3 → no `opencode` call.
  - `details hold no text`: brief and output contain `JEV-MARKER-1`; `JSON.stringify(details)` lacks it.
  - Each attempt passes `timeout: 600000`, `maxBuffer: 8388608`, and the signal; the catalog call passes `timeout: 30000`.
  - `already aborted`: a signal aborted before the call → no CLI call, outcome `cancelled`.
  - Text assertions: `cancelled` result text contains `did not run` and `cancelled`; `exec-error` text contains `did not run`.
- [ ] **Step 2:** Run `bun test tests/host/review.test.ts`; expect FAIL.
- [ ] **Step 3:** Implement with `mkdtempSync(join(tmpdir(), "jev-review-"))`, `chmodSync(dir, 0o700)`, `rmSync(out, {force:true})` before each attempt, `rmSync(dir, {recursive:true, force:true})` in `finally`.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `feat(cli-review): run loop with timeout retry`.

## Task 6: Tool registration and child hiding — implements 3.2, 3.3, 5.1

**Files:** Modify `src/host/review.ts`, `src/host/setup.ts`, `tests/load.test.ts`; Test `tests/host/review.test.ts`, `tests/host/setup.test.ts`

**Interfaces:** Consumes `runReview`, `isChild`, `loadSnapshot`. Produces `registerReviewTool(pi: Pick<ExtensionAPI,"registerTool"|"exec"|"getAllTools">, deps?: { load?: () => Snapshot; exec?: Exec }): void`, `hideReviewInChild(event: BeforeAgentStartEvent, sessionId: string): void`, constant `REVIEW_TOOL = "jev_review"`.

- [ ] **Step 1:** Tests:
  - `tool schema`: registered definition rejects a 20 001-char brief and `model: "-x"` (validate with `typebox/value` `Value.Check`).
  - `description and guideline name jev_review` and say to call only when the user asks for a Codex or OpenCode review.
  - `refused in a child`: with the session id in the registry, `execute` returns `isError` true and the fake exec is never called.
  - `independent of key and switches`: injected `load` returns a snapshot with no key, `review` off, config invalid → codex runs.
  - `default from state reaches the CLI`: injected snapshot with `settings.review` `{cli:"opencode", model:"p/m"}`, call with only a brief → fake exec called with `opencode` and args containing `-m`, `p/m`.
  - `nothing set reaches the CLI`: snapshot `review` `{cli:"codex"}` → codex args have no `-m`.
  - Update `tests/host/setup.test.ts`: give its fake `pi` `registerTool` and `exec` stubs, and expect handlers `before_agent_start`, `session_shutdown`, `session_start`.
  - `hideReviewInChild` deletes `jev_review` from `selectedTools` for a child id, leaves it for the main id, tolerates a missing array.
  - `tests/load.test.ts`: handlers `["before_agent_start","session_shutdown","session_start"]`, tools `["jev_review"]`, commands `["jev"]`.
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement. `execute` wraps everything in `try`/`catch` → failure result. Settings from `loadSnapshot(pi).settings.review`. In `setup.ts`, call `registerReviewTool(pi)` and add `pi.on("before_agent_start", (e, ctx) => { try { hideReviewInChild(e, ctx.sessionManager.getSessionId()); } catch {} })`.
- [ ] **Step 4:** Run `bun test`; expect PASS.
- [ ] **Step 5:** Commit `feat(cli-review): register jev_review in the main session`.

## Task 7: `/jev cli-review` and status — implements 4.1, 4.2, 4.3

**Files:** Modify `src/host/commands.ts`, `src/host/setup.ts`; Test `tests/host/commands.test.ts`

**Interfaces:** Consumes Task 3 checks, `updateState`. `runJev` deps gain `exec: Exec`.

Order inside the command: parse → check the typed values against the state rules (run the state validator on the candidate `cliReview`, no write) → if the model or an OpenCode effort needs a check, read the list → a non-zero exit, `killed`, or a parse of `[]` means unreadable: skip the check functions and store with a warning → otherwise run `checkCodexChoice` / `checkOpencodeChoice` → `updateState`.

Split into two commits: 7a parse, usage and status; 7b checks and storing.

- [ ] **Step 1:** Tests (fake `exec` returning catalogs):
  - parse: `cli-review opencode` → `{cli:"opencode"}`; `cli-review codex default high` → `{cli:"codex", effort:"high"}`; `cli-review`, `cli-review claude`, `cli-review Codex`, `cli-review codex luna high now` → usage.
  - Every `jev-command` delta scenario: tier stored as typed, `Luna`, display name → slug, unknown model with suggestions, unsupported effort, Codex effort without a model (no list read), OpenCode by name, two providers, OpenCode effort without a model, list unreadable (warning, stored), OpenCode not on PATH (warning, stored), default clears (no list read), bare reviewer, `codex -m` refused naming `cliReview.model`.
  - `usageText` lists the `cli-review` line; `formatStatus` shows `cli review: codex (model luna, effort high)` and `cli review: codex (CLI defaults)`.
  - `cli-review is inert in a child`.
  - Update existing tests: `tests/host/commands.test.ts` "lists no later forms" now expects the `cli-review` line and still no `mode`, `tune` or slot forms; every `runJev` call passes `exec` (a stub that fails the test if called, for non-cli-review forms).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement; `exec` is a required dep; wire `exec: (c, a, o) => pi.exec(c, a, o)` in `setup.ts`.
- [ ] **Step 4:** Run `bun test`; expect PASS.
- [ ] **Step 5:** Commit `feat(jev-command): /jev cli-review with model checks`.

## Task 8: Host tests with a fake CLI — implements 5.2, 5.3, 5.4

**Files:** Create `tests/host/cli-review.test.ts`, `tests/fixtures/fake-cli/codex` (executable shell script)

**Interfaces:** Consumes `startFixture`, `startHostSession` with `env.PATH` prefixed by the fake-CLI directory.

- [ ] **Step 1:** Fake `codex` (POSIX `sh`): the test copies it into a per-test temp `bin/` and passes `env: { PATH: <bin>:<process.env.PATH>, TMPDIR: <tmp>, FAKE_CODEX_MODE: "ok"|"fail", FAKE_CODEX_LOG: <tmp>/codex.log }` to `startHostSession` (`isolatedEnv` spreads `opts.env` last). On `debug models` it prints a fixed catalog; on `exec`, mode `ok` writes `JEV-MARKER-OUT PASS` to the path after `-o` and exits 0, mode `fail` prints 30 stderr lines and exits 3. It appends its argument count and the `-m` value to `FAKE_CODEX_LOG`, never the prompt.
- [ ] **Step 2:** Tests:
  - `offered in main`: the first provider request's `toolNames` include `jev_review`.
  - `absent in child`: `executor: true`, a child agent file with no `tools` line (unrestricted), and a child task; the child's first request lists `read` (control: the child has built-in tools) and lacks `jev_review`, while the main request in the same run lists `jev_review`.
  - `success through the tool`: fixture replies with a `jev_review` tool call (brief `JEV-MARKER-BRIEF`); the next request's tool result contains `PASS` and names Codex.
  - `failure through the tool`: mode `fail` → tool result says `did not run` and `exit code 3`.
  - `nothing stored`: no file under the agent directory contains `JEV-MARKER-BRIEF` or `JEV-MARKER-OUT`; no `jev-review-*` directory remains in the test `TMPDIR`.
- [ ] **Step 3:** Run `bun test tests/host/cli-review.test.ts`; expect PASS (implementation exists).
- [ ] **Step 4:** Commit `test(cli-review): host tests with a fake codex`.

Timeout is proven at unit level (Task 5) against `pi.exec`'s documented `killed` contract, since a host-level timeout would need a 10-minute wait or a test-only knob in shipped code. `tasks.md` 5.3 says the same.

## Task 9: Docs and manual real run — implements 6.1, 6.2

**Files:** Modify `docs/workflow.md`, `docs/usage-guide.md`, `docs/configuration.md`, `docs/architecture.md`, `docs/privacy.md`, `docs/testing.md`, `docs/roadmap.md`; Create `docs/evidence/<date>-cli-review.md`, `tests/host/manual/cli-review-real.ts`

- [ ] **Step 1:** `workflow.md` §6: new command lines (D3), tiers, independence from Jev and switches. `usage-guide.md`: Reviews section (model forms, validation, OpenCode needs a model for an effort), remove `cli-review` from the WG-15 placeholder note, All commands line. `configuration.md`: `cliReview.model` rule. `architecture.md`: `review.ts`/`review-cli.ts` in the layout, `before_agent_start` child hiding in runtime contexts, CLI review seam marked verified by host test. `privacy.md`: brief visible in the local process list during a run; OpenCode `plan` allows shell commands; OpenCode keeps the prompt in its own history; Codex runs `--ephemeral`. `testing.md`: fake CLI host tests; manual real run. `roadmap.md`: WG-15 scope as built.
- [ ] **Step 2:** `tests/host/manual/cli-review-real.ts` (run with `bun`, never in CI): creates a throwaway git repo with one small committed change, calls `runReview` with an `Exec` built on `Bun.spawn` mirroring `pi.exec` (no stdin, timeout, kill), once for `codex` and once for `opencode` when installed; prints outcome, attempts and output length only.
- [ ] **Step 3:** Ask the operator before running it (uses their logins and paid models); record the result in `docs/evidence/` as counts and outcomes only.
- [ ] **Step 4:** `bun run typecheck && bun run lint && bun run fmt:check && bun test`; expect all PASS.
- [ ] **Step 5:** Commit `docs(cli-review): commands, privacy and evidence`.

---

## Scenario → test

**cli-review**
- Brief too long → Task 6 `tool schema`
- Model that looks like a flag → Task 6 `tool schema`
- No key, review switch off → Task 6 `independent of key and switches`
- Offered in the main session → Task 8 `offered in main`
- Absent in a child session → Task 8 `absent in child`
- Refused in a child session → Task 6 `refused in a child`
- Default from state → Task 4 `effectiveChoice` + Task 5 `opencode uses cwd and stdout`
- Override for one call → Task 4 `effectiveChoice`
- Same reviewer, new model → Task 4 `effectiveChoice`
- Effort only → Task 4 `effectiveChoice`
- Nothing set → Task 2 `codex without model or effort` + Task 6 `independent of key and switches`
- Codex without model or effort → Task 2
- Codex with model and effort → Task 2
- Result from the output file → Task 5 `codex success reads -o`
- Empty output file → Task 5 `empty -o falls back to stdout`
- Output file placement → Task 5 `output directory placement and cleanup`
- Temp directory removed → Task 5 `output directory placement and cleanup`
- OpenCode with model and effort → Task 2
- OpenCode effort without a model → Task 2
- Prompt layout → Task 2
- Instructions match the docs → Task 2
- Newest of a tier → Task 3 `resolveTier compares numbers` + Task 5 `tier resolved per run`
- Tier in another case (run time) → Task 3 `resolveTier compares numbers`
- Hidden models ignored → Task 3 `parseCodexCatalog keeps visible models`
- Catalog unreadable → Task 5 `tier resolved per run`
- Pinned id → Task 5 `tier resolved per run`
- One timeout, then success → Task 5
- Two timeouts → Task 5
- Failure is not retried → Task 5 `exit 2 not retried`
- Output over the limit → Task 5 `truncated not retried`
- Cancelled → Task 5
- Header names the resolved model → Task 5 `tier resolved per run`
- Success → Task 8 `success through the tool`
- Non-zero exit → Task 4 `stderrTail`, Task 5 `failure does not switch reviewer`, Task 8 `failure through the tool`
- CLI not installed → Task 4 `classifyAttempt`
- Exit 1 is not "not found" → Task 4 `classifyAttempt`
- Exec throws → Task 5 `exec throws`
- Details hold no text → Task 5 `details hold no text`
- Marker not stored → Task 8 `nothing stored`

**jev-command**
- Bare reviewer, Default clears the model, Unknown CLI, Value outside the state rules, Codex tier stored as a tier, Tier in another case, Codex display name stored as its slug, Unknown Codex model, Codex effort without a model, Unsupported Codex effort, OpenCode model by name, OpenCode name with two providers, OpenCode effort without a model, List unreadable, OpenCode list unreadable, No reviewer named, Reviewer name is case-sensitive → Task 7 (one test each, same names)
- Default status, CLI review default shown → Task 7 `formatStatus`
- No executor, Key name never value, Malformed state reported, Invalid config reported → existing `tests/host/commands.test.ts` and `tests/host/jev-base.test.ts`
- Command from a later work group, Unknown feature, Bad value, Extra words, Whitespace only → existing `tests/host/commands.test.ts`
- Extra words after cli-review → Task 7 parse

**state-file**
- Valid state read, Every documented feature accepted, Literal default rejected, Unknown feature → existing `tests/store/state-file.test.ts`
- OpenCode model id accepted, Model that looks like a flag → Task 1

**package-loading**
- Loaded extension registers only /jev and handlers → Task 6 `tests/load.test.ts`

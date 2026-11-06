## 1. State rule

- [x] 1.1 Widen `cliReview.model` in `src/store/state-file.ts` to `^[A-Za-z0-9._][A-Za-z0-9._:/-]{0,127}$` (not `default`); keep `effort` unchanged; tests in `tests/store/` for an OpenCode id, `-m`, and the existing cases

## 2. Pure review logic (`src/host/review-cli.ts`)

- [x] 2.1 `REVIEW_INSTRUCTIONS` constant and `buildPrompt(brief)`; test that the constant equals the block in `docs/jev-questions.md`; lint override keeping `review-cli.ts` free of Pi imports
- [x] 2.2 `codexArgs` and `opencodeArgs` builders per the spec argument orders
- [x] 2.3 `parseCodexCatalog` (visible models, slugs, names, efforts) and `parseOpencodeModels`
- [x] 2.4 `isTier`, `resolveTier` (newest by digit groups, case-insensitive)
- [x] 2.5 `checkCodexChoice` and `checkOpencodeChoice` with suggestions (at most five)
- [x] 2.6 `effectiveChoice(defaults, call)` override rules
- [x] 2.7 `classifyAttempt` (success, timeout, truncated, cancelled, not found, exit error) and `formatResult` / `formatFailure` (header, stderr tail of 20 lines / 4000 chars, no exit code when killed)

## 3. Tool (`src/host/review.ts`)

- [x] 3.1 `runReview(exec, input)` with temp directory lifecycle, `-o` removal before each attempt, timeout retry once, cancel stop, throw-to-failure, tier resolution from `codex debug models`; unit tests with a fake `exec`
- [x] 3.2 `registerReviewTool(pi)`: `jev_review` definition with typebox schema, description and prompt guideline; `execute` refuses in a child; reads settings through `loadSnapshot`
- [x] 3.3 Child hiding: `before_agent_start` handler removing `jev_review` from `selectedTools` in a child session; wire both into `src/host/setup.ts`

## 4. `/jev cli-review` (`src/host/commands.ts`)

- [x] 4.1 Parse `cli-review` forms (arity, case-sensitive reviewer, `default` placeholders); usage text line
- [x] 4.2 Run the catalog check through an injected `exec`, store through `updateState`, report warnings and errors, then status and status line
- [x] 4.3 Status report line for the CLI review default

## 5. Host and load tests

- [x] 5.1 Update `tests/load.test.ts` for the new registrations (one tool, `before_agent_start`)
- [x] 5.2 Host test: main session's first provider request lists `jev_review`; a child's does not
- [x] 5.3 Host test: fake `codex` script on `PATH` driven through a scripted `jev_review` tool call: success and failure; timeout and retry are covered by unit tests against `pi.exec`'s `killed` contract, without a test-only knob in shipped code
- [x] 5.4 Privacy test: marker in the brief not found under the agent directory; temp directory gone

## 6. Docs and manual check

- [x] 6.1 Update `docs/workflow.md` §6, `docs/usage-guide.md`, `docs/configuration.md`, `docs/architecture.md`, `docs/privacy.md`, `docs/testing.md`, `docs/roadmap.md`
- [x] 6.2 Manual script `tests/host/manual/cli-review-real.ts` and a real run with the operator's Codex and OpenCode (after the operator's go-ahead), recorded as counts and outcome only in `docs/evidence/`

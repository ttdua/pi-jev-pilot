## Why

The operator wants a second opinion from another vendor's coding agent on demand, such as "have Codex review this", without a relay agent's token cost and without Jev being involved. Feature F4 is planned for WG-15, and WG-06 has delivered the `/jev` base it builds on. The documented commands no longer match the installed CLIs: Pi's `pi.exec` gives no stdin, and OpenCode 2.2.5 dropped `--variant` and `--dir`.

## What Changes

- New `jev_review` tool, registered only in the main session. It runs Codex or OpenCode once through `pi.exec`, read-only, with the review instructions and brief as one argument, and returns the findings and verdict. On failure it says the review did not run, with the exit code and error tail. Timeout is 10 minutes, with one retry on timeout only. It never switches to the other reviewer.
- Codex model names: a tier (`luna`, `sol`, ...) means the newest model of that tier when the review runs; a full id is pinned.
- New `/jev cli-review <codex|opencode> [model|default] [effort|default]`. It checks the model, and Codex efforts, against the CLI's own model list and suggests correct names. If the list cannot be read, it accepts the value as typed, with a warning. The choice is kept in `state.json`.
- `/jev` status shows the CLI review default; the usage text lists the new form.

**Documented CLI commands**
- From: Codex reads the brief from stdin (`-`); OpenCode gets `--variant <effort>` and `--dir <cwd>`.
- To: both get the prompt as an argument; Codex writes its last message to a temp file (`-o`); OpenCode gets `-m <provider/model>[#<effort>]`, `--agent plan` and runs in the session's working directory.
- Reason: `pi.exec` has no stdin; OpenCode 2.2.5 removed the flags.
- Impact: documentation only, since nothing implemented these commands yet.

**`state.json` CLI review model**
- From: `cliReview.model` is 1–64 characters of letters, digits, `.`, `_`, `-`.
- To: it also accepts `/` and `:`, up to 128 characters, and must not start with `-`.
- Reason: OpenCode model ids are `provider/model`, such as `ollama-cloud/gpt-oss:120b`.
- Impact: non-breaking; every file valid before stays valid.

**Extension registrations**
- From: the extension registers no tools.
- To: it registers exactly one tool, `jev_review`, in the main session only.

## Capabilities

### New Capabilities
- `cli-review`: the `jev_review` tool: main-session-only registration, the Codex and OpenCode commands, Codex tier resolution at run time, timeout and retry, result and failure shape, and the privacy limits.

### Modified Capabilities
- `jev-command`: adds the `/jev cli-review` form with validation and suggestions; the status report shows the CLI review default; the usage text lists the new form.
- `state-file`: `cliReview.model` accepts OpenCode `provider/model` ids.
- `package-loading`: registrations allow exactly one tool, `jev_review`, in the main session.

## Impact

- Code: new `src/host/review.ts` (tool) and `src/host/review-cli.ts` (pure: arguments, model catalogs, tier resolution, result text); `src/host/commands.ts`, `src/host/setup.ts`, `src/store/state-file.ts`.
- Tests: unit tests with a fake `exec`; a host test with a fake `codex` on `PATH` and a child-session check; a manual real run, not in CI.
- No new dependency. `typebox` is imported for the tool schema; Pi maps that import to its own copy, so the package stays free of runtime dependencies.
- Docs: `docs/workflow.md` (§6 A CLI review), `docs/usage-guide.md` (Reviews, All commands, the WG-15 note), `docs/configuration.md` (`review` and state), `docs/architecture.md` (source layout, host seams, runtime contexts), `docs/privacy.md` (process list, OpenCode `plan` limits), `docs/testing.md` (fake CLI, manual real run), `docs/roadmap.md` (WG-15 entry: scope as built).

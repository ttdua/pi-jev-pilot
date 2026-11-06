## Context

The approach, goals and non-goals are in `brainstorm.md`. This document covers how it fits the code as of WG-06.

Current state:
- `state.json` already validates `cliReview` (`src/store/state-file.ts`), and `resolveSettings` already lets it replace the config's `review` as a whole (`src/store/settings.ts`). `/jev reset` already clears it.
- `/jev` parsing lives in `src/host/commands.ts` (`parseJevArgs`, `runJev`); `src/host/setup.ts` wires one command, two session handlers and the child registry.
- The child registry (`src/host/child.ts`) is verified to know a child before its `session_start` (Q4). Removing a tool through a child's `before_agent_start` `systemPromptOptions.selectedTools` is verified to remove it from the child's provider request (Q3).
- `pi.exec(command, args, { cwd, timeout, signal, maxBuffer })` spawns with `shell: false` and stdin ignored, kills on timeout or abort, and returns `{ stdout, stderr, code, killed, truncated }`; output over `maxBuffer` kills the process with `truncated: true` (`dist/core/exec.d.ts`, `exec.js`, Pi 1.5.0). A missing binary gives `code: 1` with `spawn <cmd> ENOENT` in `stderr`; it does not throw. An argument holding a NUL character makes `spawn` throw.
- Installed CLIs: Codex CLI 0.159.0 (`codex exec`, `codex debug models` emits `{"models":[{slug, display_name, description, visibility, supported_reasoning_levels:[{effort}]}]}`) and OpenCode 2.2.5 (`opencode run`, `opencode models` prints one `provider/model` per line; agent `plan` denies `edit:*` only).

Constraints: public Pi APIs only; only `host/` imports Pi; no runtime dependencies; nothing of the brief or output stored by us; tests use no network beyond loopback.

## Goals / Non-Goals

**Goals:**
- One `jev_review` tool, model-visible in the main session only, failing safe everywhere else.
- Deterministic, testable command building and result shaping, separated from the Pi-facing tool.
- `/jev cli-review` with validation against each CLI's model list, without blocking on a broken CLI.

**Non-Goals:**
- Streaming progress, ACP, a relay agent, automatic reviews, switching reviewer on failure, a stricter OpenCode sandbox, Codex `review` subcommand modes (`--uncommitted`, `--base`).

## Decisions

### D1. Two modules: pure `review-cli.ts`, Pi-facing `review.ts`

`src/host/review-cli.ts` holds pure functions: argument lists for each CLI, catalog parsing (`codex debug models`, `opencode models`), tier resolution, validation with suggestions, and the result text. It imports nothing from Pi, so unit tests cover it fully. `src/host/review.ts` registers the tool, runs `pi.exec`, manages the temp file and the retry. Both stay in `host/`: the logic is about external processes, not decisions, so it does not belong in `policy/`, and splitting it out of `host/` would add a layer for no reuse.

Alternative: one file. Rejected: the exec-free part is most of the logic and the most worth testing.

### D2. Absent in children: hide through `selectedTools`, refuse in `execute`

A child session binds the parent's extension set, so a load-time `registerTool` exists in children too. The extension registers `jev_review` at load and adds a `before_agent_start` handler that, in a child session (`isChild`), deletes `jev_review` from `event.systemPromptOptions.selectedTools`. This is the Q3-verified seam, already planned for WG-14's tool assessment. As defence in depth, `execute` returns an error result without running anything when `isChild(ctx.sessionManager.getSessionId())`.

Alternatives: register the tool from `session_start` only when the session is not a child. Rejected: whether the child's extension instance shares the tool registry with the parent's is not verified, while the `selectedTools` removal is (Q3). `pi.setActiveTools` in a child's `session_start`: not verified as a seam, and it touches the child's whole tool set.

### D3. Command lines

Codex:
```text
codex exec [-m <model>] [-c model_reasoning_effort="<effort>"] -s read-only --skip-git-repo-check --ephemeral -C <cwd> -o <out> <prompt>
```
`--ephemeral` keeps the review out of the operator's Codex session history. The prompt always starts with the fixed instructions (`Review a code change ...`), so it can never be read as a flag, whatever the brief holds. `<out>` is a fresh file in a fresh `mkdtemp` directory under the OS temp dir, mode `0700`, removed after the run whatever happens.

OpenCode:
```text
opencode run [-m <provider/model>[#<effort>]] --agent plan <prompt>
```
with `cwd` set to `ctx.cwd`. The result is stdout. `#<effort>` follows OpenCode 2.2.5's `provider/model#variant`.

`<prompt>` is the [CLI review instructions](../../../docs/jev-questions.md#cli-review-instructions), a blank line, `The change:`, and the brief. The instructions text moves into `review-cli.ts` as a constant, and a test checks it matches the docs block.

### D4. Codex tier resolution at run time

A stored Codex model that contains no `-` and is all letters (`luna`, `Sol`) is a tier. Before each Codex run the tool reads `codex debug models` (timeout 30 s). From models whose `visibility` is `list` (or absent), it groups slugs by the last `-`-separated part and picks the one whose digit groups compare highest (`gpt-6-luna` beats `gpt-5.6-luna`). If the tier is found, `-m` gets that slug. If the catalog cannot be read or the tier is not in it, the tier is passed to `-m` as typed and the CLI's own error reaches the result. A model with a `-` is pinned and passed as is.

Alternative: resolve once in `/jev cli-review` and store the slug. Rejected: the operator chose tiers so the newest model is taken up by itself.

### D5. Validation in `/jev cli-review`

Grammar: `/jev cli-review <codex|opencode> [<model>|default] [<effort>|default]`, at most four words. Each command replaces the whole CLI review default: a field whose word is omitted or `default` is left unset, so the CLI uses its own. `default` exists as a placeholder, so `/jev cli-review codex default high` sets only an effort.

- Codex: the model must be a tier, a slug, or a display name (case-insensitive) in the catalog; a display name is stored as its slug. The effort, when given, must be in the resolved model's `supported_reasoning_levels`. Without a model, an effort is checked against nothing and stored; Codex applies it to its own default model.
- OpenCode: the model must be an exact `provider/model` line, or a bare `model` only one provider has (stored as the full id). An effort requires a model; effort names are not listed by `opencode models`, so the effort is stored without a check.
- Wrong names fail with an error naming up to five suggestions: the tiers with their current slugs for Codex; the ids containing the typed text for OpenCode. Nothing is written.
- The catalog command runs through `pi.exec` with a 30 s timeout. If it fails, times out or parses to nothing, the value is stored as typed, and a warning says it was not checked and why.

This makes `/jev cli-review` the one `/jev` form that runs a process. It still calls neither Jev nor any service of ours. The existing requirement "No command calls Jev" holds.

### D6. Timeout, retry, cancellation

Each attempt gets `timeout: 600_000` and the tool's `signal`. An attempt with `killed: true` and the signal not aborted counts as a timeout and is retried once. Abort (Esc) stops at once with no retry. A non-zero exit, a missing binary or a truncated output is a failure without retry. `maxBuffer` is 8 MiB, so a runaway CLI cannot fill memory.

### D7. Tool result

Success: `content` is one text block: a header line `Codex review (model gpt-6-luna, effort high):` (or `the CLI's default model and effort`), then the CLI's output trimmed. The verdict is whatever the CLI wrote; the tool does not parse it. Codex output with an empty `-o` file falls back to stdout.

Failure: `isError: true`, text `The <CLI> review did not run: <reason>. Exit code <n>.` (the exit code only when the process exited by itself) followed by the last 20 lines (at most 4000 characters) of stderr. Reasons: `timed out twice after 10 minutes`, `cancelled`, `<cli> not found`, `exited with an error`, `output exceeded 8 MiB`, `could not start (<ErrorName>)`. `details` holds only `{ cli, model, effort, exitCode, attempts, outcome }`, never output text.

The tool description and a `promptGuidelines` bullet tell the model to call `jev_review` only when the user asks for a CLI review by name, and to pass what changed and what to check as `brief`.

### D6a. Independent of Jev and switches

The review calls no Jev and decides nothing, so it is not one of the decision features: the `review` switch (which governs reviewer-slot routing), the key and an invalid config do not disable it. The operator asks for it by name; refusing because of an unrelated switch would only confuse. An invalid config contributes nothing, as in `buildSnapshot`, so the reviewer falls back to the state or `codex`.

### D6b. Failure classification

`not found` only when stdout is empty and stderr contains `ENOENT`, since `pi.exec` reports a missing binary as exit code 1. A cancelled or killed attempt omits the exit code. Any throw from `pi.exec` (such as a NUL in an argument) becomes a failure result, never an exception out of the tool. The `-o` file is deleted before each attempt, so a killed first attempt cannot leak a partial answer into the retry.

### D7a. Tool parameters

`brief` (string, 1–20 000 characters) is required. Optional `reviewer` (`codex` | `opencode`), `model` and `effort` (same character rules as the state) override the default for this call only. A per-call model is resolved the same way as at run time (D4), not checked against the catalog as in D5: the CLI reports a wrong one. The parameter schema rejects `default` nowhere, so a per-call `model: "default"` is passed to the CLI as a model name; the description tells the model to omit fields it does not want to set. 20 000 characters keeps the argument far below macOS `ARG_MAX` (1 MiB) and Linux's 128 KiB single-argument limit.

### D8. `cliReview.model` accepts OpenCode ids

The state rule widens for `model` only: `^[A-Za-z0-9._][A-Za-z0-9._:/-]{0,127}$` and not `default`. OpenCode ids contain `/` and `:` (`ollama-cloud/gpt-oss:120b`). The leading character excludes `-`, so a stored model can never be read as a flag; D3 covers the prompt. `effort` keeps the old rule.

### D9. Status and usage

The status report gains one line: `cli review: codex (model luna, effort high)` or `cli review: codex (CLI defaults)`. The usage text gains `/jev cli-review <codex|opencode> [model|default] [effort|default]`.

### D10. Public contracts

Public, per the working agreements, and the operator approved them in exploration: the `jev_review` tool name and parameters, the `/jev cli-review` grammar, the widened `state.json` `cliReview.model` rule, and the CLI command lines as documented in `docs/workflow.md`. Exact shapes are in `plan.md` Contracts.

## Risks / Trade-offs

- [The brief is visible in the local process list while the review runs] → Documented in `docs/privacy.md`. It never leaves the machine through us; on a shared host, other local users with process-list access could read it during the run.
- [OpenCode `plan` still allows shell commands, so read-only rests on the instructions] → Operator accepted; documented in `docs/privacy.md` and `docs/usage-guide.md`.
- [CLI flags change again (as OpenCode did)] → The failure path returns the CLI's own error text; a host test with a fake CLI pins our side; the real run is listed in `docs/testing.md` as a manual check per CLI upgrade.
- [A tier stored with an effort may later resolve to a newer model that does not take that effort] → Codex reports it and the review says it did not run; the operator re-runs `/jev cli-review`.
- [OpenCode keeps the prompt in its own session history; there is no `--ephemeral` for `opencode run`] → Documented in `docs/privacy.md`.
- [`codex debug models` may refresh over the network and be slow] → 30 s timeout; on failure the tier is passed as typed.
- [A tier passed as typed when the catalog fails is not a valid Codex model] → The review fails with Codex's error and says it did not run; no silent wrong model.
- [`before_agent_start` registration widens package-loading's bounded registration list] → The spec delta names it; the load test is updated.
- [Ten-minute runs hold the turn] → Expected for a review the user asked for; Esc cancels.

## Migration Plan

No data migration. Existing `state.json` files stay valid (D8 only widens). Rollback is removing the tool and command form; a stored `cliReview` stays valid for the older code only if its model matches the old rule, otherwise the older code reads the file as malformed and moves it aside on the next change, as it already does for any malformed state.

## Open Questions

None.

# cli-review Specification

## Purpose
TBD

## Requirements

### Requirement: Review tool parameters
The extension SHALL register one tool named `jev_review` with a required `brief` of 1 to 20000 characters and optional `reviewer` (`codex` or `opencode`), `model` (matching `^[A-Za-z0-9._][A-Za-z0-9._:/-]{0,127}$`) and `effort` (matching `^[A-Za-z0-9._-]{1,64}$`). Its description and prompt guideline MUST tell the model to call `jev_review` only when the user asks for a review by Codex or OpenCode.

#### Scenario: Brief too long
- **WHEN** `jev_review` is called with a `brief` of 20001 characters
- **THEN** the call is rejected by parameter validation and no process runs

#### Scenario: Model that looks like a flag
- **WHEN** `jev_review` is called with `model` `-x`
- **THEN** the call is rejected by parameter validation and no process runs

### Requirement: Independent of Jev and switches
`jev_review` MUST NOT call Jev. It SHALL stay offered and run whether or not the API key is set, whatever the feature switches (including `review`) say, and when `config.json` is invalid, in which case the config contributes nothing and the reviewer defaults to `codex` unless the state sets one.

#### Scenario: No key, review switch off
- **WHEN** the API key is not set, the `review` switch is off, and `jev_review` is called with a brief
- **THEN** the CLI runs and no request reaches Jev

### Requirement: Review tool in the main session only
In a child session `jev_review` MUST be removed from the session's selected tools before the child's first provider request. If it is called in a child session anyway, it MUST return an error result without running any process.

#### Scenario: Offered in the main session
- **WHEN** the package is loaded in a main session and the first provider request is sent
- **THEN** the request's tools include `jev_review`

#### Scenario: Absent in a child session
- **WHEN** the executor starts a child session with the package loaded
- **THEN** the child's first provider request has no tool named `jev_review`

#### Scenario: Refused in a child session
- **WHEN** `jev_review` executes with a session id the child registry holds
- **THEN** it returns an error result and runs no process

### Requirement: Reviewer, model and effort for a run
A review SHALL start from the effective CLI review default (the state's `cliReview`, else the config's `review.cli`, else `codex`). A call naming another `reviewer` MUST drop the default's model and effort. A call giving a `model` MUST drop the default's effort unless it also gives an `effort`. A call's `model` or `effort` replaces the default's. An unset model or effort MUST be omitted from the command.

#### Scenario: Default from state
- **WHEN** the state holds `cliReview` `{"cli":"opencode","model":"p/m"}` and `jev_review` is called with only a brief
- **THEN** `opencode` runs with `-m p/m`

#### Scenario: Override for one call
- **WHEN** the state holds `cliReview` `{"cli":"codex","model":"luna","effort":"high"}` and `jev_review` is called with `reviewer` `opencode`
- **THEN** `opencode` runs with no `-m` flag

#### Scenario: Same reviewer, new model
- **WHEN** the state holds `cliReview` `{"cli":"codex","model":"luna","effort":"high"}` and `jev_review` is called with `model` `gpt-5.6-sol`
- **THEN** Codex runs with `-m gpt-5.6-sol` and no `model_reasoning_effort` flag

#### Scenario: Effort only
- **WHEN** the state holds `cliReview` `{"cli":"codex","model":"gpt-5.6-luna"}` and `jev_review` is called with `effort` `low`
- **THEN** Codex runs with `-m gpt-5.6-luna` and `model_reasoning_effort="low"`

#### Scenario: Nothing set
- **WHEN** the state has no `cliReview`, the config has no `review`, and `jev_review` is called with only a brief
- **THEN** `codex` runs with no `-m` and no `model_reasoning_effort` flag

### Requirement: Codex command
A Codex review SHALL run `codex` through `pi.exec` with exactly these arguments in order: `exec`, `-m <model>` when a model is set, `-c` `model_reasoning_effort="<effort>"` when an effort is set, `-s` `read-only` `--skip-git-repo-check` `--ephemeral` `-C <cwd>` `-o <out>`, and the prompt last. `<cwd>` is the session's working directory. The result text SHALL be the content of `<out>`, or stdout when `<out>` is missing or empty.

#### Scenario: Codex without model or effort
- **WHEN** a Codex review runs with no model and no effort
- **THEN** the arguments are `exec -s read-only --skip-git-repo-check --ephemeral -C <cwd> -o <out> <prompt>`

#### Scenario: Codex with model and effort
- **WHEN** a Codex review runs with model `gpt-6-luna` and effort `high` in `/work/repo`
- **THEN** the arguments are `exec -m gpt-6-luna -c model_reasoning_effort="high" -s read-only --skip-git-repo-check --ephemeral -C /work/repo -o <out> <prompt>`

### Requirement: Codex output file
The Codex `-o` file MUST be in a new directory under the OS temp directory, created with mode `0700` for this run; the file MUST be absent when each attempt starts, and the directory MUST be removed after the run whatever its outcome.

#### Scenario: Result from the output file
- **WHEN** the fake Codex writes `VERDICT: PASS` to the `-o` file, `noise` to stdout, and exits 0
- **THEN** the tool result text contains `VERDICT: PASS` and does not contain `noise`

#### Scenario: Empty output file
- **WHEN** the fake Codex leaves the `-o` file empty, prints `PASS` to stdout, and exits 0
- **THEN** the tool result text contains `PASS`

#### Scenario: Output file placement
- **WHEN** a Codex review runs
- **THEN** the `-o` path's directory is under the OS temp directory and has mode `0700` while the CLI runs

#### Scenario: Temp directory removed
- **WHEN** a Codex review finishes, whether it succeeds, fails or times out
- **THEN** the directory that held `<out>` no longer exists

### Requirement: OpenCode command
An OpenCode review SHALL run `opencode` through `pi.exec` in the session's working directory with exactly these arguments in order: `run`, then `-m <model>` when a model is set, with `#<effort>` appended to the model when an effort is also set, then `--agent` `plan` and the prompt as the last argument. An effort without a model MUST be dropped from the command. The result text SHALL be stdout.

#### Scenario: OpenCode with model and effort
- **WHEN** an OpenCode review runs with model `ollama-cloud/glm-5.3` and effort `high`
- **THEN** the arguments are `run -m ollama-cloud/glm-5.3#high --agent plan <prompt>` and the working directory is the session's

#### Scenario: OpenCode effort without a model
- **WHEN** an OpenCode review runs with an effort and no model
- **THEN** the arguments are `run --agent plan <prompt>`

### Requirement: Review prompt
The prompt SHALL be the CLI review instructions from `docs/jev-questions.md`, a blank line, the line `The change:`, and the brief, and MUST start with the instructions so it can never be read as a command-line flag.

#### Scenario: Prompt layout
- **WHEN** a review runs with the brief `-rf everything`
- **THEN** the prompt's first line is `Review a code change in this repository, read-only: don't edit anything.`, a line `The change:` follows the instructions after a blank line, and the brief is the rest

#### Scenario: Instructions match the docs
- **WHEN** the instructions constant is compared with the `CLI review instructions` block in `docs/jev-questions.md`
- **THEN** they are identical

### Requirement: Codex tier resolution at run time
A Codex model made only of letters SHALL be treated as a tier and resolved before each run from `codex debug models`, read through `pi.exec` with a 30-second timeout: among models whose `visibility` is `list` or absent and whose last `-`-separated part equals the tier ignoring case, the slug whose digit groups compare highest, number by number, is passed to `-m`. Without such a slug, or when the catalog cannot be read, the tier MUST be passed as stored. Any other model MUST be passed unchanged.

#### Scenario: Newest of a tier
- **WHEN** the catalog lists `gpt-6-luna` and `gpt-5.6-luna`, and the model is `luna`
- **THEN** Codex runs with `-m gpt-6-luna`

#### Scenario: Tier in another case
- **WHEN** the catalog lists `gpt-6-luna` and the model is `Luna`
- **THEN** Codex runs with `-m gpt-6-luna`

#### Scenario: Hidden models ignored
- **WHEN** the catalog lists `gpt-7-luna` with `visibility` `hide` and `gpt-6-luna` with `visibility` `list`, and the model is `luna`
- **THEN** Codex runs with `-m gpt-6-luna`

#### Scenario: Catalog unreadable
- **WHEN** `codex debug models` exits non-zero and the model is `luna`
- **THEN** Codex runs with `-m luna`

#### Scenario: Pinned id
- **WHEN** the model is `gpt-5.6-luna`
- **THEN** `codex debug models` is not run and Codex runs with `-m gpt-5.6-luna`

### Requirement: Timeout and retry
Each attempt SHALL run with `pi.exec`'s `timeout` of 600000 ms, `maxBuffer` of 8 MiB and the tool call's abort signal. An attempt reported as killed, not truncated, with the signal not aborted, is a timeout and SHALL be retried once. A truncated attempt is a failure whatever its exit code. No other failure MUST be retried, and a cancelled call MUST NOT start another attempt.

#### Scenario: One timeout, then success
- **WHEN** the first attempt times out and the second succeeds
- **THEN** the CLI ran twice and the tool returns the second attempt's result

#### Scenario: Two timeouts
- **WHEN** both attempts time out
- **THEN** the CLI ran twice and the tool returns a failure that says the review timed out twice

#### Scenario: Failure is not retried
- **WHEN** the first attempt exits with code 2
- **THEN** the CLI ran once

#### Scenario: Output over the limit
- **WHEN** the fake CLI writes more than 8 MiB and is killed with `truncated` true
- **THEN** the CLI ran once and the failure says the output exceeded 8 MiB

#### Scenario: Cancelled
- **WHEN** the abort signal fires during the first attempt
- **THEN** no second attempt starts and the failure says the review was cancelled

### Requirement: Result and failure
On success the tool SHALL return one text block: a header naming the CLI and the model and effort actually passed (or that the CLI's defaults were used), then the CLI's output trimmed. On failure it SHALL return an error result saying `The <Codex|OpenCode> review did not run`, the reason, the exit code when the process exited by itself, and at most the last 20 lines and 4000 characters of stderr. A failure MUST NOT run the other reviewer.

#### Scenario: Header names the resolved model
- **WHEN** a Codex review with tier `luna` resolves to `gpt-6-luna` with effort `high` and succeeds
- **THEN** the result text's first line names Codex, `gpt-6-luna` and `high`

#### Scenario: Success
- **WHEN** the fake CLI prints findings and `PASS` and exits 0
- **THEN** the result is not an error, its text names the CLI and contains the findings and `PASS`

#### Scenario: Non-zero exit
- **WHEN** the fake Codex writes 30 lines to stderr and exits 3
- **THEN** the result is an error, says `The Codex review did not run`, names exit code 3, holds the last 20 stderr lines and not the first, and `opencode` was not run

### Requirement: Failure classification
The reason SHALL be `<cli> not found` exactly when stdout is empty and stderr contains `ENOENT`. A throw from `pi.exec` MUST become a failure result, never an exception out of the tool.

#### Scenario: CLI not installed
- **WHEN** `codex` is not on `PATH`
- **THEN** the result is an error saying the Codex review did not run and that `codex` was not found

#### Scenario: Exit 1 is not "not found"
- **WHEN** the fake Codex writes `bad flag` to stderr and exits 1
- **THEN** the result is an error naming exit code 1, and it does not say `not found`

#### Scenario: Exec throws
- **WHEN** `pi.exec` throws
- **THEN** the result is an error saying the review did not run

### Requirement: Result details hold no text
The result's `details` MUST hold only the CLI, model, effort, exit code, attempt count and outcome, never the brief or output text.

#### Scenario: Details hold no text
- **WHEN** a review succeeds with output containing a marker string
- **THEN** the result's `details` does not contain the marker

### Requirement: Nothing stored
A review MUST NOT write the brief, the prompt or the CLI's output to the ledger, `state.json`, the session's custom entries or any file of the package's other than the per-run temp file. What the CLI itself keeps (OpenCode's session history) is the CLI's, and is documented in `docs/privacy.md`.

#### Scenario: Marker not stored
- **WHEN** a review runs with a marker in the brief and the fake CLI echoes it
- **THEN** no file under the agent directory contains the marker, and the temp directory is gone

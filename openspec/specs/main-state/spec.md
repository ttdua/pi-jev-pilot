# main-state Specification

## Purpose
The minimal main state sent to Jev with a main request: request signals computed in code, a bounded window of recent conversation text and tool counts, the turn index and the workspace platforms, built from plain inputs and never carrying tool arguments, tool output or injected context.

## Requirements

### Requirement: Minimal main state
The `state` of a main request SHALL have exactly `request`, `conversation` and `workspace`. `conversation` MUST have exactly `recent`, `recent_tools` and `turn_index`; `workspace` MUST have exactly `platforms`. The fields `last_decision`, `context_used_percent`, `workspace.git`, `workspace.languages` and `capabilities` MUST NOT be sent. The current model and thinking level, diffs and file contents MUST NOT be sent. The state MUST be built by a module with no Pi import, from plain inputs.

#### Scenario: Field set
- **WHEN** a main request is sent
- **THEN** its `state` keys are exactly `request`, `conversation`, `workspace`, with `conversation` keys `recent`, `recent_tools`, `turn_index` and `workspace` keys `platforms`

### Requirement: Request signals
`request` SHALL carry `text` (the prompt), `prompt_chars` (trimmed length), `files_mentioned`, `has_code_or_error` and `is_question`, computed in code by the rules in `docs/jev-contract.md` (`request` table): `files_mentioned` counts distinct paths or file names with a known extension; `has_code_or_error` and `is_question` match the listed English patterns, case-insensitive.

#### Scenario: Question with a file
- **WHEN** the prompt is `  why does src/a.ts fail?  `
- **THEN** `prompt_chars` is 23, `files_mentioned` is 1, `has_code_or_error` is false (`fail` is not `failed`) and `is_question` is true

#### Scenario: Error text
- **WHEN** the prompt is `the build failed with TypeError`
- **THEN** `has_code_or_error` is true

#### Scenario: Same file twice
- **WHEN** the prompt mentions `README.md` twice
- **THEN** `files_mentioned` is 1

#### Scenario: Plain instruction
- **WHEN** the prompt is `rename foo to bar`
- **THEN** `files_mentioned` is 0, `has_code_or_error` is false and `is_question` is false

### Requirement: Recent conversation
`conversation.recent` SHALL hold at most 4 messages and 2000 characters from the current branch before the current prompt, oldest first, each `{ role, text, tools }` with role `user` or `assistant`. Text MUST come only from user and assistant text parts; thinking, images, tool arguments, tool results and custom messages MUST be excluded. `tools` MUST list each assistant tool call by name, with `failed: true` when its result is an error.

#### Scenario: Short history
- **WHEN** the branch holds one user message `hi` and one assistant reply `hello`
- **THEN** `recent` is `[{ role: "user", text: "hi", tools: [] }, { role: "assistant", text: "hello", tools: [] }]`

#### Scenario: Tool arguments never sent
- **WHEN** an assistant message called `bash` with argument `JEV-MARKER-ARG` and its result failed
- **THEN** that message's `tools` is `[{ name: "bash", failed: true }]` and `JEV-MARKER-ARG` appears nowhere in the state

#### Scenario: Injected context excluded
- **WHEN** the branch holds a custom message with `display: false`
- **THEN** its content appears nowhere in `recent`

### Requirement: Recent conversation budget
The newest assistant message SHALL get about 55% of the 2000-character budget and keep both its start and its end, with 72% of its cap taken from the end. Other messages MUST share the rest, at least 200 characters each; when the budget runs out the oldest messages MUST be dropped, not shortened below 200.

#### Scenario: Long assistant reply keeps both ends
- **WHEN** the newest assistant reply is 5000 characters starting with `START` and ending with `END?`
- **THEN** its `text`, including any elision marker, is at most 1100 characters and contains both `START` and `END?`

#### Scenario: Budget drops the oldest
- **WHEN** the branch holds 6 messages of 900 characters each
- **THEN** `recent` holds at most 4 messages, total text at most 2000 characters, and the newest message is present

### Requirement: Recent tool counts and turn index
`conversation.recent_tools` SHALL count over the last 10 message entries of the branch before the current prompt, of any role: tool calls from the assistant messages among them, by the tool groups in `docs/jev-contract.md` (`reads` includes tools whose name starts with `web_`), and `failed` from the error tool results among them. `conversation.turn_index` SHALL be the number of user messages on the branch before the current prompt.

#### Scenario: Counts
- **WHEN** the last 10 entries hold one `edit`, two `bash` calls of which one failed, and one `read`
- **THEN** `recent_tools` is `{ edits: 1, commands: 2, reads: 1, subagents: 0, failed: 1 }`

#### Scenario: First prompt
- **WHEN** the prompt is the first in the session
- **THEN** `turn_index` is 0 and `recent` is empty

### Requirement: Workspace platforms
`workspace.platforms` SHALL list, in the order of the marker table in `docs/jev-contract.md`, each platform whose marker exists at the working directory or one level below, judged from names only. Symlinks and the skipped directories listed there MUST be skipped. With no marker found it MUST be `["none found"]`. An unreadable directory MUST be skipped without failing the request.

#### Scenario: Docker and GitHub Actions
- **WHEN** the working directory holds `Dockerfile` and `.github/workflows/`
- **THEN** `platforms` is `["Docker", "GitHub Actions"]`

#### Scenario: Marker one level down
- **WHEN** the only marker is `web/vercel.json`
- **THEN** `platforms` is `["Vercel"]`

#### Scenario: Marker two levels down
- **WHEN** the only marker is `apps/web/vercel.json`
- **THEN** `platforms` is `["none found"]`

#### Scenario: Path-shaped marker
- **WHEN** the only marker is `.github/workflows/` at the working directory
- **THEN** `platforms` is `["GitHub Actions"]`; a path-shaped marker (`.github/workflows/`, `supabase/config.toml`, `amplify/`, `.vercel/`) counts only relative to the working directory or to a directory one level below it

#### Scenario: Skipped directory
- **WHEN** the only marker is `node_modules/fly.toml`
- **THEN** `platforms` is `["none found"]`

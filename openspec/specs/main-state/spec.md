# main-state Specification

## Purpose
The minimal main state sent to Jev with a main request: request signals computed in code, a bounded window of recent conversation text and tool counts, the turn index and the workspace platforms, built from plain inputs and never carrying tool arguments, tool output or injected context.

## Requirements

### Requirement: Minimal main state
The `state` of a main request SHALL have exactly `request`, `conversation`, `workspace` and `capabilities`. `conversation` MUST have `recent`, `recent_tools` and `turn_index`, plus `last_decision` when a previous decision is known. `workspace` MUST have exactly `platforms`. The rich field groups are `last_decision` and `capabilities`, both shipped, decided by the WG-16 replay. `context_used_percent`, `languages` and `workspace.git` MUST NOT be sent. The current model and thinking level, diffs and file contents MUST NOT be sent. The state MUST be built by a module with no Pi import, from plain inputs.

#### Scenario: Field set
- **WHEN** a main request is sent on the second answered turn of a session
- **THEN** its `state` keys are exactly `request`, `conversation`, `workspace`, `capabilities`, with `conversation` keys `recent`, `recent_tools`, `turn_index`, `last_decision` and `workspace` keys `platforms`

#### Scenario: First turn has no last decision
- **WHEN** a main request is sent on the first turn of a session
- **THEN** `conversation` has no `last_decision` key, and `capabilities` is present

#### Scenario: Unshipped groups never sent
- **WHEN** a host test runs in a git repository with changes, with an earlier answered turn
- **THEN** the recorded provider-side Jev request carries none of `context_used_percent`, `git`, `languages`, even though the working tree has changes

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

### Requirement: Rich field groups
`mainState` SHALL accept an optional input for each rich group and add the group only when its input is given. The groups MUST be placed as follows:
- `last_decision` goes under `conversation`;
- `capabilities` goes at the top level.

#### Scenario: One group alone
- **WHEN** `mainState` gets only the `last_decision` input `{ effort: "high" }`
- **THEN** the state is the minimal state plus `conversation.last_decision` `{ effort: "high" }`, and nothing else

#### Scenario: Every group
- **WHEN** `mainState` gets both inputs
- **THEN** `conversation` has `last_decision`, and `capabilities` has `tools` and `subagents`

### Requirement: Last decision
`last_decision` SHALL be `{ effort, strategy }` from the previous answered main turn in the session, with a key omitted when that turn decided none. The field MUST be omitted on the first turn, and when no previous decision is known.

#### Scenario: Previous turn known
- **WHEN** the previous turn applied `high` and Jev chose strategy `direct`
- **THEN** `last_decision` is `{ effort: "high", strategy: "direct" }`

### Requirement: Capabilities
`capabilities.tools` SHALL list the active tools in name order, at most 40, each as `{ name, summary }`. `summary` MUST be the first sentence of the description, at most 200 code points. `capabilities.subagents` SHALL list the available agents in name order, at most 30, each as `{ name, description, tools }`, with `description` cut to 200 code points. An agent's `model` and `thinking` MUST NOT be sent.

#### Scenario: First sentence
- **WHEN** a tool's description is `Read a file. Supports images.`
- **THEN** its `summary` is `Read a file.`

#### Scenario: Caps
- **WHEN** 50 tools are active
- **THEN** `capabilities.tools` has the first 40 by name

#### Scenario: Agent caps
- **WHEN** 35 agents are available and one has a 300-code-point description
- **THEN** `capabilities.subagents` has the first 30 by name, and that description, if among them, has 200 code points

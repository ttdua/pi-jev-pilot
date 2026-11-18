## Why

Tool assessment lets Jev remove a worker's default tools and grant it any parent tool. That makes a child's tool set non-deterministic and can widen it past what the agent author declared, for example granting a file-writing extension tool to a read-only agent; `disallowed_tools` cannot close that gap. Tool access should be decided by the agent definition alone, with `ask_parent` as the way to get more (issue #81).

## What Changes

**Worker tools**
- From: the launch policy asks `tool::<name>` / `grant::<name>` per candidate and, in `enforce`, returns `removeTools` / `addTools`.
- To: the launch policy never asks about tools and never returns `removeTools` or `addTools`; it adjusts only model and thinking.
- Reason: tool access belongs to the agent author.
- Impact: non-breaking for the default `observe` users (tools were never changed); users on `enforce` lose removals and grants.

**`tools` config section**
- From: `tools.mode` (`observe` | `enforce`) and `tools.grantAt` (0.5–1) are validated and resolved into settings.
- To: a `tools` section is accepted and ignored (any content) and is no longer in the resolved settings; `/jev` status reports it as deprecated.
- Reason: an old config must not become invalid, which would turn every Jev feature off.
- Impact: non-breaking.

**`tools` feature switch**
- From: `tools` is one of eight feature switches, set by `/jev tools on|off` and by `/jev all on|off`.
- To: seven feature switches; a boolean `switches.tools` in `state.json` is accepted and dropped like the retired `switches.review`; `/jev tools on|off` is an unknown form and prints usage text.
- Reason: the switch has nothing left to control.
- Impact: non-breaking for files; the command form is removed.

**Worker ledger counts**
- From: `worker` lines carry `toolsScored`, `toolsFlagged`, `toolsGranted` when assessed.
- To: new lines never carry them; old lines that carry them stay valid.
- Reason: no assessment, no counts.
- Impact: non-breaking for readers.

**Removed**: the whole `tool-assessment` capability, its Jev questions and their wording in `docs/jev-questions.md`.

Not changed: the executor's launch-policy seam in `packages/pi-subagents`, the worker rubric version, worker routing decisions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tool-assessment`: every requirement is removed.
- `config-file`: the `tools.mode` / `tools.grantAt` rules become "a `tools` section is accepted and ignored".
- `settings-resolution`: resolved settings no longer hold `tools`; `tools` leaves the feature list.
- `state-file`: a boolean `switches.tools` is accepted and dropped; the documented features are seven.
- `jev-command`: status lists seven features, reports the deprecated config section, and drops "and tool assessment" from the executor lines; `tools` leaves the feature and `all` forms and the usage text.
- `status-line`: `Jev · off` depends on five decision features.
- `worker-ledger`: no `tools*` counts on new lines.
- `decision-ledger`: the `tools*` fields stay readable but are no longer written.
- `worker-routing`: routing's no-op no longer has a tool-assessment exception.
- `readiness-checks`, `worker-modes`, `tuning-host`: references to tool assessment are dropped.
- `release-metadata`: tool assessment leaves the README feature list and the decision features are five.

## Impact

- Code removed: `src/policy/tools/`, `src/host/tools/`, the tool part of `src/jev/state.ts`, `src/jev/questions.ts` and `src/jev/rubrics.ts`.
- Code changed: `src/host/worker/policy.ts`, `outcomes.ts`, `launches.ts`, `routing.ts`; `src/policy/worker/worker-line.ts`; `src/store/defaults.ts`, `config.ts`, `settings.ts`, `settings-sections.ts`, `state-file.ts`; `src/host/commands/status-format.ts` and `jev.ts`.
- Tests: remove `tests/policy/tools/`, `tests/host/tools/`, `tests/host/tool-assessment.test.ts`; update store, ledger, routing, command and status tests.
- Docs: `README.md`, `docs/configuration.md`, `docs/usage-guide.md`, `docs/jev-questions.md`, `docs/jev-contract.md`, `docs/architecture.md`, `docs/domain-model.md`, `docs/glossary.md`, `docs/privacy.md`, `docs/workflow.md`, `docs/roadmap.md`, `docs/project-brief.md`, `CHANGELOG.md`. Historical evidence and decision records are left as written.

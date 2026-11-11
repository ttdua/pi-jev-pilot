# Changelog

All notable changes to pi-jev-pilot are listed here, newest first.

## [Unreleased]

## [0.2.0] - 2026-11-11

Tag: v0.2.0

### Breaking

- **Uninstall `@gotgenes/pi-subagents` before installing this version.** The executor is now vendored in `packages/pi-subagents/` and one `pi install` loads both extensions. Pi refuses to start when two extensions register the `subagent` tool.

### Added

- Vendored executor (from `@gotgenes/pi-subagents` 25.0.5, see [ADR 0009](docs/decisions/0009-vendored-executor.md)) with seams: launch policy provider (one slot, 10 s watchdog, fails open), launch identity on events, effective model and thinking per launch, an agent registry, checked tool grants and `disallowed_tools` in agent files.
- Worker routing through the launch policy for every main-session launch, including service `spawn()`. A model named by a service caller is kept. Launches from a worker, and `resume`, are untouched.
- Tool assessment at launch for every agent: declared tools are kept, disallowed tools are never added, Jev decides blocks (`tool::` at 0.5 or more) and grants (`grant::` at `tools.grantAt`, default 0.8).
- Worker ledger lines gain `effectiveModel`, `effectiveThinking` and `toolsGranted`.
- `/jev` reports `duplicate executor` when Jev's extension runs with the original executor but without the vendored one.
- `bun run test:executor` for the vendored package's own tests.

### Changed

- With the `tools` switch on, each launch with candidates costs one extra Jev request, sent concurrently with the worker request under one `classifier.timeoutMs` deadline.
- Tool assessment moved from the child session to the launch, in the main session. The child only keeps the guard that hides `jev_review`.
- Agent facts come from the executor's registry instead of parsed agent files.
- Workers still running at a reload or session switch get no ledger line.
- `RUBRIC_VERSION` is unchanged (2).

### Removed

- The `message_end` pre-classification and `tool_call` input rewriting. ADR 0006 is superseded; Q1, Q2 and Q7 of the host seams report are superseded.

### Internal

- Routing, main session, settings, the Jev client, the CLI review, `/jev` and setup are split into single-responsibility units in capability folders, with a resolved-path import check and function-size lint rules enforced as errors. No behavior change.

## [0.1.0] - 2026-11-08

Tag: v0.1.0

### Added

- Main effort: Jev picks the thinking level for each prompt, and `/jev effort off` hands control back to you.
- Effort hold: providers listed in `effort.holdProviders` keep the decided level until a compaction or a provider or model switch, to protect the prompt cache.
- Skill pick: at most one matching skill is attached per prompt.
- Strategy advice: Jev can attach a short hint to delegate work.
- Worker routing: each worker launch gets a model tier by difficulty, shaped by `/jev mode budget|standard|premium`, with an `expert` tier for very hard work. The mode applies to the current directory (`/jev mode <m>`); `/jev mode <m> global` sets the global mode, used by every directory without its own mode, and keeps any directory mode in place; `/jev mode clear` removes the directory mode.
- Slots and fallback: `/jev reviewer <model> when <description>` defines a named slot, and routing falls back to tiers when a slot cannot run.
- Tool assessment: Jev flags tools a worker does not need and records them, observe only.
- CLI review: off by default. Turn it on or off with `/jev cli-review on|off` (`off` keeps the reviewer choice), by choosing a reviewer (`/jev cli-review codex|opencode`), or with `review.enabled` in `config.json`. Once on, ask in words, such as "have Codex review this change", to run a read-only `jev_review` with `codex` or `opencode`.
- Tally and log: `/jev` shows a session tally, and `/jev verbose on` logs each decision.
- Auto-tuning: bounded, reversible changes to timeouts, with `/jev tune` to inspect, undo, reset or turn off.
- `/jev` commands and a status line above the editor, with per-feature switches such as `/jev skills off` and `/jev all off`.

### Changed

- `/jev mode <m>` now sets the mode for the current directory only, stored in `<cwd>/.pi/jev-mode.json`. Use `/jev mode <m> global` for the old effect: it changes the global mode, and directories with their own mode keep it.
- `jev_review` is off until you turn it on with `/jev cli-review on`.
- The `review` feature switch is removed. `/jev all on|off` now sets six decision features.

### Notes

- Replaces `naicoi92/pi-jev-pilot` and cannot run beside it: remove that package first.
- The two changes under Changed affect only unreleased `main` builds; they are listed here for anyone who ran one.

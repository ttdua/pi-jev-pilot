# Changelog

All notable changes to pi-jev-pilot are listed here, newest first.

## [Unreleased]

## [0.6.0] - 2026-11-20

Tag: v0.6.0

### Changed

- **Breaking: the executor is installed separately.** Install `pi install git:github.com/ttdua/pi-subagents@v0.1.1` first, then `pi install git:github.com/ttdua/pi-jev-pilot@v0.6.0`. This package no longer ships a vendored executor and `packages/` is gone ([ADR 0011](docs/decisions/0011-executor-as-installed-package.md)).
- `/jev` reports the executor from the capabilities its service publishes: `executor: @ttdua/pi-subagents`, `executor: no executor; worker routing is off`, or `executor: <impl>; no launch policy, worker routing is off`, with `; no agent registry` when the registry is missing. The `duplicate executor` state is gone.
- **Breaking:** model tiers now describe how much the model knows, and effort how hard it works ([ADR 0010](docs/decisions/0010-knowledge-tiers.md)). Renamed:
  - `tiers.fast` → `tiers.basic`, `tiers.balanced` → `tiers.broad`, `tiers.expert` → `tiers.frontier` in `config.json` (`tiers.deep` is unchanged).
  - The feature switch `expert` → `frontier`: `/jev expert on|off` → `/jev frontier on|off`, and `switches.expert` → `switches.frontier` in `state.json`.
  - Ledger worker lines: `expertOffered` → `frontierOffered`, targets `fast`/`balanced`/`expert` → `basic`/`broad`/`frontier`, and reason `expert` → `frontier`.
  - The `/jev` mix line names the new tiers: `mix (last <n>, <mode>): basic … / broad … / deep … / frontier …`.
- Deprecated, kept for one minor release: `tiers.fast`, `tiers.balanced`, `tiers.expert`, `switches.expert` and `/jev expert on|off` are still accepted, with a notice in `/jev`. A `config.json` that sets an old key and its new key is invalid. Older ledger lines still load.
- At the first main session start after the upgrade, `config.json` is rewritten once with the old tier keys renamed in place (other keys, values, order and file mode kept; one notification names the renames), and `switches.expert` in `state.json` moves to `switches.frontier`. An invalid or conflicting file is left alone; if the write fails, the old keys keep working and the next start retries.
- `frontier` is a reserved slot name. An existing slot named `frontier` still routes, with a notice to rename it; slot commands refuse to write until it is renamed in `config.json` by hand.
- Worker rubric version 3: the tier question asks for the least knowledgeable tier that has the knowledge the task needs; the effort question rates the amount of work and care. Older worker lines leave the cut-point window, so the built-in seed applies again for the first 100 launches.
- The difficulty score reads only the `tier` answer (range 0–3); the effort term is gone. The `frontier` tier needs only a score at or above the frontier cut, counted over every window entry; effort is no longer read.
- `risky` above .7 raises worker effort to at least `high` and no longer lifts the tier to `deep`. The `medium` effort cap on the lowest tier is removed.
- Frontier caps: `standard` 1% (was 2%), `premium` 3% (was 5%); the difference goes to `deep` (26% and 47%). `budget` is unchanged.
- Strategy advice: the main request no longer asks `tier`. With `strategy` on it asks `effort`, also when the effort result will not apply; that answer only feeds the gate and is not recorded. `delegate` and `parallel` need effort at least `medium`, `graph` at least `xhigh`.
- New seed cut points from a rubric-3 replay ([evidence](docs/evidence/2026-11-20-knowledge-tier-mix.md)).

### Removed

- The executor-only tests and `bun run test:executor`; they run in the executor repository. Q3 and service-escalation host evidence moved there too.

### Migration

From 0.5.x: remove the old install of this package, install the executor, then reinstall `pi-jev-pilot@v0.6.0`. Uninstalling `@gotgenes/pi-subagents` is no longer a documented step; if it is the only executor loaded, worker routing stays off.

**Rollback (knowledge tiers):** an older build rejects the new keys. Before rolling back, rename `tiers.basic`, `tiers.broad` and `tiers.frontier` back to `tiers.fast`, `tiers.balanced` and `tiers.expert` in `config.json`, and `switches.frontier` back to `switches.expert` in `state.json`, by hand. Ledger lines with new names are skipped by the older read.

## [0.5.0] - 2026-11-19

Tag: v0.5.0

### Added

- Executor service launches (`SubagentsService.spawn()`) gain:
  - `metadata`: a string map the caller gets back on child events, record events, record snapshots and the launch policy request. `SubagentsService.childSession(sessionId)` tells a child session which launch it belongs to ([#83](https://github.com/ttdua/pi-jev-pilot/issues/83), [#93](https://github.com/ttdua/pi-jev-pilot/pull/93)).
  - Per-launch resources: `skills`, `excludeExtensionPackages`, `cwd` and `contextFiles: false` decide what a child sees and where it runs. Invalid values refuse the launch instead of falling back. An agent file can pin `inherit_skills: false` ([#84](https://github.com/ttdua/pi-jev-pilot/issues/84), [#94](https://github.com/ttdua/pi-jev-pilot/pull/94)).
  - `SubagentsService.wait(id)` waits for one launch. While a caller waits, the child's completion, `notify_parent` updates and `ask_parent` questions go to the caller only, not the main session. New event `subagents:asked`; `subagents:update` carries `toolCallId` and `metadata` ([#85](https://github.com/ttdua/pi-jev-pilot/issues/85), [#95](https://github.com/ttdua/pi-jev-pilot/pull/95)).
  - `resultSchema`: the child gets a `submit_result` tool that validates its result against a JSON Schema subset before the run ends. The record carries `structuredResult` or `structuredResultError` ([#86](https://github.com/ttdua/pi-jev-pilot/issues/86), [#96](https://github.com/ttdua/pi-jev-pilot/pull/96)).
- Fork launches: `context: fork` clones the parent's real conversation, system prompt and tools, so the fork reuses the parent's prompt cache ([#88](https://github.com/ttdua/pi-jev-pilot/issues/88), [#90](https://github.com/ttdua/pi-jev-pilot/pull/90)).
- Six built-in role agents (`general`, `implementer`, `explore`, `scout`, `reviewer`, `verifier`) in the vendored executor, loaded from Markdown files. Each body states the role only; the process and task come from the launch ([#82](https://github.com/ttdua/pi-jev-pilot/issues/82), [#87](https://github.com/ttdua/pi-jev-pilot/issues/87), [#91](https://github.com/ttdua/pi-jev-pilot/issues/91)).
- Package agents: an installed Pi package can add agents through `pi.subagents.agents` in its `package.json`. Only packages in the configured package list are read, and paths must stay inside the package ([#91](https://github.com/ttdua/pi-jev-pilot/issues/91)).

### Changed

- **Breaking:** a subagent's starting context is one setting, `context: fresh | fork` (default `fresh`), on the `subagent` tool, agent frontmatter and service `spawn`. A fresh child gets Pi's own prompt for its session with the agent body last, and no longer inherits the parent identity. `prompt_mode` is ignored and `inherit_context` maps to `context: fork`; both warn and are removed in the next minor release. The `twin` label is replaced by `fork` ([#88](https://github.com/ttdua/pi-jev-pilot/issues/88), [#90](https://github.com/ttdua/pi-jev-pilot/pull/90)).
- **Breaking:** the jev setting `subagents.forkedLaunch` is renamed `subagents.forkLaunch`. The old key still works with a warning for one minor release; a file with both keys is invalid ([#88](https://github.com/ttdua/pi-jev-pilot/issues/88), [#90](https://github.com/ttdua/pi-jev-pilot/pull/90)).
- Agent names match case-insensitively, and a later source overrides an earlier one: built-in, package, global, then project ([#87](https://github.com/ttdua/pi-jev-pilot/issues/87)).
- An agent's name is its frontmatter `name:`, falling back to the file name ([#87](https://github.com/ttdua/pi-jev-pilot/issues/87)).
- Unknown agent types fall back to `general`, and `general-purpose` is accepted as an alias while no agent has that name. A missing or disabled `general` refuses the launch ([#82](https://github.com/ttdua/pi-jev-pilot/issues/82)).

### Fixed

- A run stopped by its turn limit settled `error` on real providers; it now settles `aborted` as documented ([#96](https://github.com/ttdua/pi-jev-pilot/pull/96)).

### Removed

- Built-in agents `Plan` and `Explore`'s pinned model, and the TypeScript built-in agent definitions. Built-ins are now the Markdown role agents above ([#82](https://github.com/ttdua/pi-jev-pilot/issues/82)).
- Tool assessment: Jev no longer removes or grants worker tools; a worker's tools come from its agent definition. The `tools` switch and `/jev tools` are gone. A `tools` section in `config.json` and `switches.tools` in `state.json` are ignored, and existing ledger lines with tool counts remain readable ([#81](https://github.com/ttdua/pi-jev-pilot/issues/81)).

## [0.4.1] - 2026-11-16

Tag: v0.4.1

### Fixed

- `classifier.model` in `config.json` now accepts router-style model ids such as `openrouter/perplexity/pplx-decider-v1.3:free`, which a Jev-compatible proxy like 9router needs. The rule is now 1–128 characters of letters, digits, `.`, `_`, `-`, `:`, `/`, not starting with `-`, `:` or `/`. Before, such an id made the whole `config.json` invalid, which also disabled `tiers`, `crew` and every other setting. A value starting with `-`, accepted before, is now rejected ([#78](https://github.com/ttdua/pi-jev-pilot/issues/78), [#79](https://github.com/ttdua/pi-jev-pilot/pull/79)).

## [0.4.0] - 2026-11-15

Tag: v0.4.0

### Changed

- Main-session effort now rates a reply to the assistant's own question, proposal, review or approval request by the work it approves or starts, read from the recent conversation, whatever the reply's length. Before, only a "short" reply got this treatment, so long replies (such as inbox answers) were rated by their own text and often started at `low`. Measured on 300 real prompts before shipping ([evidence](docs/evidence/2026-11-15-effort-reply-replay.md), [#75](https://github.com/ttdua/pi-jev-pilot/pull/75)). Effort is raised for some turns, so token use may rise slightly.

### Fixed

- The replay tool read the decision ledger from the sessions directory instead of `<agentDir>/jev`, so samples lost their recorded start effort ([#75](https://github.com/ttdua/pi-jev-pilot/pull/75)).
- The `main-effort` spec now states the shipped `effort` option order (`high`, `medium`, `xhigh`, `low`, `max`) ([#76](https://github.com/ttdua/pi-jev-pilot/pull/76)).

### Added

- Replay pass 1: a `no-prompt-chars` variant on the shipped state, and a counts-only `size` measure that compares effort with the real tool calls of each turn ([#75](https://github.com/ttdua/pi-jev-pilot/pull/75)).

## [0.3.1] - 2026-11-12

Tag: v0.3.1

### Fixed

- The blocked tool count `⊘M` on subagent rows was always 0 for agents that restrict themselves with a `tools:` allowlist, so it stayed hidden. It now counts every tool in the run's total (the parent's tools plus the child's own `ask_parent` and `notify_parent`) that the subagent cannot call, so `🔧N + ⊘M` equals the total. Tools outside the allowlist and the orchestration tools (`subagent`, `get_subagent_result`, `steer_subagent`) count as blocked, so `⊘` now shows on almost every row ([#73](https://github.com/ttdua/pi-jev-pilot/pull/73)).

## [0.3.0] - 2026-11-12

Tag: v0.3.0

### Added

- Run facts on every subagent row: the widget bracket, the inline result and the fleet list show `provider/id · thinking: <level> · 🔧N · ⊘M` (available and blocked tool counts), each part omitted while unknown ([#63](https://github.com/ttdua/pi-jev-pilot/issues/63)).
- Below-editor fleet list in the vendored executor: `main` and the subagents with a transcript, `↓` or `←` on an empty prompt to enter, `Enter` to open the session pane. Turn it off with `Fleet view` in `/subagents:settings` (ADR 0013, [#62](https://github.com/ttdua/pi-jev-pilot/issues/62)).

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

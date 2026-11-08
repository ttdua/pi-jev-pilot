# Changelog

All notable changes to pi-jev-pilot are listed here, newest first.

## [0.1.0] - 2026-11-08

Tag: v0.1.0

### Added

- Main effort: Jev picks the thinking level for each prompt, and `/jev effort off` hands control back to you.
- Effort hold: providers listed in `effort.holdProviders` keep the decided level until a compaction or a provider or model switch, to protect the prompt cache.
- Skill pick: at most one matching skill is attached per prompt.
- Strategy advice: Jev can attach a short hint to delegate work.
- Worker routing: each worker launch gets a model tier by difficulty, shaped by `/jev mode budget|standard|premium`, with an `expert` tier for very hard work. The mode applies to the current directory (`/jev mode <m>`); `/jev mode <m> global` sets it for every directory, and `/jev mode clear` removes the directory mode.
- Slots and fallback: `/jev reviewer <model> when <description>` defines a named slot, and routing falls back to tiers when a slot cannot run.
- Tool assessment: Jev flags tools a worker does not need and records them, observe only.
- CLI review: off by default. Turn it on with `/jev cli-review on`, by choosing a reviewer (`/jev cli-review codex|opencode`), or with `review.enabled` in `config.json`. Once on, ask in words, such as "have Codex review this change", to run a read-only `jev_review` with `codex` or `opencode`.
- Tally and log: `/jev` shows a session tally, and `/jev verbose on` logs each decision.
- Auto-tuning: bounded, reversible changes to timeouts, with `/jev tune` to inspect, undo, reset or turn off.
- `/jev` commands and a status line above the editor, with per-feature switches such as `/jev skills off` and `/jev all off`.

### Changed

- `/jev mode <m>` now sets the mode for the current directory only, stored in `<cwd>/.pi/jev-mode.json`. Use `/jev mode <m> global` for the old effect of changing every directory.
- `jev_review` is off until you turn it on with `/jev cli-review on`.
- The `review` feature switch is removed. `/jev all on|off` now sets six decision features.

### Notes

- Replaces `naicoi92/pi-jev-pilot` and cannot run beside it: remove that package first.
- The two changes under Changed affect only unreleased `main` builds; they are listed here for anyone who ran one.

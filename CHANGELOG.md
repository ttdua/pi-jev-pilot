# Changelog

All notable changes to pi-jev-pilot are listed here, newest first.

## [0.1.0] - 2026-11-07

Tag: v0.1.0

### Added

- Main effort: Jev picks the thinking level for each prompt, and `/jev effort off` hands control back to you.
- Effort hold: your manual thinking level lasts until the next prompt.
- Skill pick: at most one matching skill is attached per prompt.
- Strategy advice: Jev can attach a short hint to delegate work.
- Worker routing: each worker launch gets a model tier by difficulty, shaped by `/jev mode budget|standard|premium`, with an `expert` tier for very hard work.
- Slots and fallback: `/jev reviewer <model> when <description>` defines a named slot, and routing falls back to tiers when a slot cannot run.
- Tool assessment: Jev flags tools a worker does not need and records them, observe only.
- CLI review: ask in words, such as "have Codex review this change", to run a read-only `jev_review` with `codex` or `opencode`; set the default with `/jev cli-review`.
- Tally and log: `/jev` shows a session tally, and `/jev verbose on` logs each decision.
- Auto-tuning: bounded, reversible changes to timeouts, with `/jev tune` to inspect, undo, reset or turn off.
- `/jev` commands and a status line above the editor, with per-feature switches such as `/jev skills off` and `/jev all off`.

### Notes

- Replaces `naicoi92/pi-jev-pilot` and cannot run beside it: remove that package first.

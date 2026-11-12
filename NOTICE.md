# Notice

pi-jev-pilot adapts behavior and classifier question wording from these MIT-licensed projects:

- [jev-pilot](https://github.com/Akramovic1/jev-pilot) 0.12.1 at commit `5d27135b34edf81b40c0bf1df01ae401f6b72ea7`, by Ahmed Akram. Effort rubric, strategy and quality questions, skill selection logic, review instructions, tuning rules.
- [claude-code-templates](https://github.com/davila7/claude-code-templates) by Daniel (San) Ávila, the base of jev-pilot's model router and skill suggestion.
- [naicoi92/pi-jev-pilot](https://github.com/naicoi92/pi-jev-pilot). The `expert` criterion and the `expert_needed` question.
- [gotgenes/pi-packages](https://github.com/gotgenes/pi-packages) `packages/pi-subagents` 25.0.5 (`pi-subagents-v25.0.5`), by Chris Lasher, a friendly fork of tintinweb/pi-subagents (Copyright (c) 2026 tintinweb). Vendored in `packages/pi-subagents`; license: MIT (`packages/pi-subagents/LICENSE`).
- [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents) 0.23.2 at commit `83fdf77f918e37c0b0116cade493569d7e745ae1`, Copyright (c) 2026 tintinweb, MIT. The fleet list behavior in `packages/pi-subagents/src/ui/fleet-roster.ts` and `packages/pi-subagents/src/ui/fleet-list.ts`.

The upstream license texts must ship with any release that contains adapted wording.

Jev and System One are products of TypeSafe. Claude is a trademark of Anthropic. This project is not affiliated with TypeSafe, Anthropic or the Pi project.

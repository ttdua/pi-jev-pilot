# 0003: Modes select a rubric, not thresholds

**Status:** Superseded by [0008](0008-mode-target-cutpoints.md)

## Context

The operator wants one setting that shifts work toward cheaper or stronger models. Two ways were measured on 45 real briefs: different tier descriptions per mode, or one rubric with shifted probability thresholds.

Jev is often already sure of `balanced`, so thresholds barely moved workers, and low bars produced nonsense such as scouting on Fable. Different rubrics moved work in sensible directions. See the [evidence](../evidence/2026-11-05-replay.md#routing-by-mode).

## Decision

`budget`, `standard` and `premium` each define a rubric and an expert gate, as data. No other rule varies by mode. A mode affects workers only.

`premium` uses its own expert gate, because the `expert_needed` gate never fired in replay.

## Consequences

- Same request count and latency in every mode.
- Rubric text becomes a tunable surface, changed only with replay evidence.
- Tuning signals must be kept per mode.
- Mode names are reserved, and cannot be slot names.
- The routing is measured; the quality of each mode is not. `budget` carries the most risk.

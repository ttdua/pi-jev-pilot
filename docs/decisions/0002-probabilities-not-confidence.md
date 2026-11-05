# 0002: Decide on probabilities, never on confidence

**Status:** Accepted, 2026-11-05

## Context

Upstream gates decisions on `confidence`. TypeSafe documents it as a statistic of the distribution: `(p − 1/n) / (1 − 1/n)`. Its value for the same top probability changes with the number of options, so adding a slot or the `expert` tier silently changes what a bar means.

On the operator's ledger, upstream's bars would have blocked 53% of effort changes, and confidence did not predict which `low` turns grew large. See the [evidence](../evidence/2026-11-05-replay.md#main-session). The port had already found effort stuck near its default and removed the veto.

## Decision

- Effort uses Jev's choice directly, within the risk floor, ceiling and clamp.
- Other gates compare `probabilities` or `noul`.
- `confidence` may be logged, and policy never reads it.

## Consequences

- Adding options does not change the meaning of a bar.
- Low-probability effort answers still apply. If that causes harm, the ledger will show it, since whole distributions are stored, and any bar can be replayed offline.

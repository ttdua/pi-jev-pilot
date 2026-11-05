# 0005: Tuning applies itself, within limits

**Status:** Accepted, 2026-11-05

## Context

Upstream proposes tuning and waits for `/jev tune apply`, which the operator expects to forget. Asking at idle would interrupt. On 500 real turns, upstream's rules also never fired, so remembering was not the only problem. See the [evidence](../evidence/2026-11-05-replay.md#main-session).

## Decision

Tuning applies itself with these limits:

- One parameter and one step at a time, at least 40 decisions apart, in a fixed range.
- A visible line on every change, with undo.
- Automatic revert if the next 40 decisions are worse.
- Stored separately from `config.json`.
- Never touches the risk floor, ceiling, expert rules or tool threshold.

Phase 1 changes only `timeoutMs`. Other signals are observed and displayed, and each earns automatic adjustment only from evidence, after about 200 decisions. Spending increases may apply automatically; decreases need two windows in a row or a question at idle.

## Consequences

- Nothing to remember.
- In practice, little will change early, since timeouts are rare here. That is deliberate: lowering bars until rules fire would tune on noise.
- If no signal proves useful, threshold tuning is dropped and only `timeoutMs` remains.

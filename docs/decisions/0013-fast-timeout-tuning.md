# 0013: Fast timeout tuning

**Status:** Accepted, 2026-11-23. Amends [ADR 0005](0005-bounded-auto-tuning.md) for `timeoutMs`.

## Context

On the local ledger, answered main latency p50 rose from about 500 ms (11-15) to 840–1260 ms (11-22 and 11-23). Main timeouts went from 0 per day to 29 of 72 (11-22) and 37 of 124 (11-23), all cut at the effective 1700 ms. `tuning.json` shows three raise-and-revert cycles (1700→1900→1700, 1700→1800→1700, 1700→1900→1700). In two of the three reverted raises, the first 40 decisions held 2 and 3 answers with `ms` between the old and new value. Those answers would have been timeouts without the raise. The revert still fired, because the overall timeout share kept rising with upstream latency.

Causes in the rules before this change:
- The window rule waits a full 40 decisions, so every change is late.
- The step uses p90 of answered `ms` only, which stays below the timeout, so steps are +100 to +200 ms.
- Judging compares the timeout share only, so upstream drift reverts a raise that helped.
- A revert blocks the value for 200 decisions, which keeps the timeout below real latency for hundreds of turns.
- Tuning never lowers, so a spike leaves the timeout high.

## Decision

Tuning moves `timeoutMs` up faster and down gradually. The step still applies at most one change, in this order: burst, window rule, lowering, then band floors ([ADR 0012](0012-tuned-turn-floors.md)).

- **Burst:** when 3 of the latest 5 asked decisions after the latest `timeoutMs` history entry timed out, raise to `ceil100(current × 1.25)`, clamped to 5000. It ignores the 40-decision cooldown and any block, and clears the block. It replaces a pending change that is not yet judgeable.
- **Window rule:** unchanged trigger (over 10% timeouts in 40 asked). Its p90 counts timed-out decisions at the timeout in force, so steps reflect real latency.
- **Judging:** a raise is kept when an answer among the 40 decisions after it has `ms` above the old value. Otherwise it is reverted when the share is worse. A lowering is reverted on any timeout among at least 20 asked.
- **Lowering:** after 200 decisions with at least 100 asked and no timeout, lower to `max(base, ceil100(p90 × 1.5), ceil100(current × 0.8))`, never below base.
- **Block direction:** a raise block holds back raises for 200 decisions. A lowering block holds back lowerings for 400 decisions. Direction comes from the reference value, so no file change is needed.
- **Undo:** skips a `rule` entry that a later undo of the same parameter reversed, so repeated undo walks back instead of alternating.
- **Storage:** burst and window raises share the `rule` history cause. No new field, cause, event kind or file version.

## Consequences

- A latency jump now produces a raise within 3 timed-out decisions, instead of after 40 or more.
- Risk: a burst raises the timeout, so a real outage costs up to 5000 ms per miss. Lowering, undo and `reset` bring it back, and the ceiling stays 5000.
- Risk: an undo can be overridden by the next burst. `/jev tune off` stops it.
- Risk: raise and lowering can oscillate. The 200-decision lowering wait, the 20% step cap and the 400-decision lowering block limit that.
- The thresholds (3 of 5, ×1.25, 200 and 100 decisions, ×1.5, ×0.8, 400) are first estimates. Review them once the ledger shows several cycles.

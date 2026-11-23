## Design Summary

**Intent.** When the classifier gets slower, `timeoutMs` tuning reacts too late and then locks itself at a value that is too low. As a result, the status line shows `Jev · no answer` on a large share of main turns. This change makes tuning react as soon as timeouts start to cluster, judge a raise by whether it actually rescued answers, and come back down once latency recovers.

**Evidence (local ledger, 2026-11-14 to 2026-11-23).**
- Answered main p50 latency rose from about 500 ms (11-15) to 840–1260 ms (11-22/23). Main timeouts went from 0 per day to 29 of 72 (11-22) and 37 of 124 (11-23), all cut at the effective 1700 ms.
- `tuning.json` history shows three cycles of raise and revert: 1700→1900→1700, 1700→1800→1700 and 1700→1900→1700. The last revert left a block at 1900 for 200 decisions.
- In two of the three reverted raises, the first 40 decisions after the raise held answers with `ms` between the old and the new value (2 and 3 answers). Those answers would have been timeouts without the raise. The revert still fired because the overall timeout share kept rising with upstream latency.

**Root causes in the current rules.**
1. **Slow to react.** The rule needs a full window of 40 decisions after the latest `timeoutMs` entry, so every change waits at least 40 decisions.
2. **Steps too small.** The new value uses the p90 of answered `ms` only. Answered values are always below the current timeout, so `p90 × 1.25` barely exceeds it and the step is +100 to +200 ms. While latency is above the timeout, timed-out decisions carry the real signal, and the rule ignores them.
3. **Revert blames the raise for upstream drift.** "Evaluating a pending change" compares the timeout share before and after. When latency keeps rising, the share rises even though the raise helped, so the raise is reverted.
4. **Long lockout.** A revert blocks the reverted value for 200 decisions. With the cooldown, the effective timeout stays below real latency for hundreds of turns.
5. **No way down.** Tuning only raises. A value raised during a latency spike stays there after recovery.

**Goals**
- React within a few decisions when timeouts cluster, without waiting for a 40-decision window or a block to expire.
- Raise in steps large enough to catch up with real latency.
- Keep a raise that rescued answers, and revert only a raise that did not help.
- Lower a tuned value gradually back toward its base once latency has recovered for a long stretch.

**Non-goals**
- No retry of a timed-out classifier call within the same turn. Fail-open stays: a timeout means the turn goes on as if the package were not installed.
- No background continuation of a timed-out request to measure its true latency (possible later change).
- No change to band floor tuning (`turnFloor.*`), the config key, or the 300–5000 hard range.

**Anti-goals** (failure even if it works)
- A timeout that keeps climbing toward 5000 on a short burst and never comes down, making every miss cost several seconds.
- Oscillation: fast raise, slow-path revert, fast raise again, every few turns.
- A Jev or network call from the tuning step.

**Behaviour agreed**
1. **Fast trigger.** When 3 of the latest 5 asked decisions timed out (including 3 in a row), tuning raises `timeoutMs` at once to `ceil100(current × 1.25)`, clamped to 5000. The fast trigger ignores the 40-decision cooldown and any active block. After a fast raise, the next fast raise needs 3 more timeouts after it, so it can step again (for example 1700 → 2200 → 2800 → 3500) while timeouts continue.
2. **Normal rule stays.** The existing 40-decision window rule (more than 10% timeouts) still runs for slow drift. It keeps its cooldown and the block. Its new value also counts timed-out decisions as at least the timeout in force when they were asked, so its step reflects real latency.
3. **Evaluation by evidence.** A pending raise is kept when at least one answered decision after it has `ms` above the raise's `from`. It is reverted only when no answer used the extra time and the timeout share got worse.
4. **Gradual lowering.** After a long stretch of decisions with no timeout and a p90 far below the tuned value, tuning lowers the tuned value one step toward its base, never below the base. A lowered value is judged like a raise: if timeouts return, it is reverted.
5. **Operator surface unchanged in shape.** Change lines, `/jev tune`, `undo`, `reset` and `off` keep working. New causes or event kinds get a readable line of their own.

**Specified requirements this change alters** (stated explicitly)
- `tuning-rules` "The timeout rule": adds the fast trigger beside the 40-decision window rule.
- `tuning-rules` "The new value": timed-out decisions count in the percentile; the fast trigger uses `current × 1.25`.
- `tuning-rules` "Cooldown": the fast trigger is exempt from it.
- `tuning-rules` "Evaluating a pending change": keep on evidence of rescued answers; revert only without that evidence and with a worse share.
- `tuning-rules` "Block after a revert or an undo": the block no longer limits the fast trigger.
- `tuning-rules` "Pure tuning step" and "Step order across parameters": a new event or cause for lowering and for fast raises.
- `tuning-file` "Tuning file values": new history causes, if design adds them.
- `tuning-host` "Change line texts" and `tune-command` "Tune report history": texts for the new causes.

## Alternatives Considered

### Alternative A: Evidence-based judging with larger steps, only
- **Approach**: Keep the 40-decision window rule. Judge a raise by rescued answers and count timeouts in the percentile so steps are larger.
- **Pros**: smallest change to the specs; fixes the false reverts and small steps.
- **Cons**: still waits at least 40 decisions per change; a sudden latency jump still produces dozens of `no answer` turns first.
- **Why not chosen**: the user wants tuning to act as soon as timeouts appear, not after 40 or 200 turns.

### Alternative B: Revert aware of the latency trend
- **Approach**: Skip a revert when the median latency of the judged window also rose compared with the window before.
- **Pros**: small change to one requirement.
- **Cons**: a 40-decision median is noisy; steps stay small and the 40-decision wait stays; the tuning can still lock itself.
- **Why not chosen**: does not address reaction time or step size.

### Alternative C: Bigger constants only
- **Approach**: Raise the step to +400 and shorten the block to 100 decisions.
- **Pros**: trivial diff.
- **Cons**: the revert logic still misreads upstream drift, and there is still no way down.
- **Why not chosen**: the same lockout comes back with the next latency rise.

### Alternative D: Retry within the turn or measure in the background
- **Approach**: Retry a timed-out call once with a longer timeout, or let the timed-out request finish in the background to record its real latency.
- **Pros**: the true latency is known; a retry may still answer the turn.
- **Cons**: a retry delays the prompt by up to two timeouts, against fail-open; background requests add load and complexity.
- **Why not chosen**: out of scope; background measurement may come in a later change.

## Agreed Approach

Alternative A, extended with a fast trigger and gradual lowering (behaviour 1–5 above). The user asked tuning to "do something right away" on timeouts instead of waiting 200 turns, and accepted the proposed thresholds. The fast trigger fixes reaction time. Counting timeouts in the percentile fixes the step size. Evidence-based judging fixes the false reverts. Lowering keeps a spike from leaving a permanently high timeout.

## Key Decisions

- Fast trigger: 3 timeouts among the latest 5 asked decisions; raise to `ceil100(current × 1.25)` (proposed, accepted by the user).
- The fast trigger bypasses the 40-decision cooldown and the block (user: avoid waiting 200 turns).
- Keep the 40-decision window rule for slow drift (proposed, accepted).
- A raise is kept when an answer after it used the extra time (`ms` above `from`) (proposed, accepted).
- Lowering back toward the base is in scope for this change (proposed, accepted).
- No retry and no background measurement (proposed, accepted).
- Ceiling 5000 and floor 300 unchanged (proposed, accepted).
- Immediate config relief applied outside this change: the operator's local `classifier.timeoutMs` set to 3000 (user).

## Open Questions

Left to design; none needs the user:
- How the fast trigger counts decisions across a change: only decisions after the latest `timeoutMs` entry, so one burst cannot fire twice.
- How a fast raise interacts with a pending change still being judged: whether it replaces the pending change, or is judged on its own.
- Lowering thresholds: stretch length (for example 200 decisions), how far below the tuned value p90 must be, and step size (for example one step back along history, or `ceil100(p90 × 1.5)`, never below base).
- Whether lowering, fast raise and evidence-based keep need new history causes or event kinds, and the `tuning.json` version impact.
- Change line texts and `/jev tune` report lines for the new causes.
- How worker decisions, which use their own routing budget, count toward the fast trigger: probably only decisions that carry the classifier `timeoutMs` as their limit.

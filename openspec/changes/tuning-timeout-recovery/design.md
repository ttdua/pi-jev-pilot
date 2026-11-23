## Context

`timeoutMs` tuning lives in the pure step `stepTuning` (`src/policy/tuning/rules.ts`), fed by ledger lines through `src/policy/tuning/window.ts`, persisted by the host at `agent_settled` (`src/host/tuning/step.ts`), and shown by `/jev tune` (`src/host/tuning/command.ts`, texts in `src/policy/tuning/text.ts`). `brainstorm.md` records the evidence, the agreed behaviour and the alternatives. This document settles the open questions it left to design.

Both main decisions (`src/host/main/start.ts`) and worker routing (`src/host/worker/policy.ts`, `end = now() + classifier.timeoutMs`) use the tuned `classifier.timeoutMs`. Both kinds of line therefore count as decisions for every timeout rule, as they already do for the window rule.

## Goals / Non-Goals

**Goals:**
- Raise within 3 timed-out decisions of a latency jump.
- Steps large enough to catch up with real latency.
- Keep raises that rescued answers.
- Lower a tuned value after a long, clean stretch.

**Non-Goals:**
- No new `tuning.json` field, cause, event kind or file version.
- No change to band floor tuning, the 300–5000 range, the config key, the Jev request or the ledger line format.

## Decisions

### D1. Three timeout rules, tried in a fixed order
After supersede and judging, and only when nothing was reverted, the step tries: the **burst rule**, then the **window rule** (today's rule), then **lowering**, then the band floors. The first that applies a change ends the step, so the step still returns at most one `applied` event. Burst comes first because it is the one that reacts to an emergency. Lowering comes last because it is the least urgent.

### D2. Burst rule
- **Window:** the latest 5 *asked* decisions after the latest `timeoutMs` history entry (any cause). The window may hold fewer than 5 decisions.
- **Fires:** when at least 3 of them timed out. So 3 timeouts in a row right after a change fire it, and so do 3 of the latest 5.
- **Value:** `ceil100(current × 1.25)`, clamped to 5000; no change when that is not above `current`. A burst raise is not limited by the window rule's p90 formula; ×1.25 is the agreed step.
- **Ignores** the 40-decision cooldown and any block, and **clears** the block. A block exists to stop the window rule from walking back into a reverted value. Once 3 timeouts arrive within 5 asks, that judgement is out of date. Clearing the block also keeps block direction unambiguous (D5).
- **Pending change:** a burst may fire while a change is pending and not yet judgeable (fewer than 40 decisions after it); it replaces that change without judging it: the old pending change is dropped with no event, and the burst raise becomes the new pending change. A pending change with 40 decisions after it is judged first (D1), and a revert stops the burst in that step. Waiting 40 decisions to judge the old one is exactly the delay this change removes.
- **`before`:** counts over the latest 40 decisions in the ledger, regardless of time, so the file limit of 40 holds.
- **Repeats:** the burst adds a `rule` history entry, which resets its own window. The next burst needs 3 more timeouts after it, which gives 1700 → 2200 → 2800 → 3500 → 4400 → 5000 under sustained timeouts.
- **History cause:** `rule`, the same as the window rule. Undo, the session-start line and the history report work unchanged. A burst cannot be told apart from a window raise in the history; the report does not need that distinction.

### D3. Measured p90
`p90` becomes the nearest-rank 90th percentile of `ms` over decisions that are answered **or** have `miss` `timeout`, and carry a finite `ms`. A timed-out decision's `ms` is about the timeout in force, which is a lower bound of its real latency, so it pulls p90 up when timeouts are frequent. Lines without `ms`, including older seeded lines, are left out as today. The window rule keeps `max(current + 200, ceil100(p90 × 1.25))`.

### D4. Judging with rescue evidence
When 40 decisions follow a pending change, judge the first 40 as today, with one addition. A **raise** (`to > from`) is kept when at least one answered decision among those 40 has `ms > from`. That answer would have been a timeout under the old value. Otherwise, the existing rule applies: revert when at least 20 are asked and the timeout share is strictly above `before`. A **lowering** (`to < from`) has no rescue: it is reverted when the share is worse than `before`. A lowering's `before` has no timeout (D6), so any timeout among at least 20 asked reverts it. This is deliberately strict.

When a change is kept and the tuned value equals its base, the tuned value is removed, so the record does not keep a "tuned" value that equals the base.

A lowering is judged on its own terms: with at least 20 asked, any timeout reverts it, whatever `before` holds. A lowering's `before` can be `0/0` when its latest 40 decisions were unasked, and cross-multiplying against an empty sample would never revert it.

Keeping a raise only clears the pending change; the same step may still apply a further raise when a rule fires.

### D5. Block direction and lifetime
A block still holds `{ value, at }`. Its direction is derived, not stored, from the **reference value**: the record's tuned `timeoutMs` value when it has one, else the untuned value.
- A block **above** the reference holds back raises for 200 decisions: a raise to the blocked value or above is lowered to `value − 100`, as today.
- A block **below** the reference holds back lowerings for **400** decisions: a lowering to the blocked value or below is raised to `value + 100`. 400 because lowering waits 200 decisions after the revert or undo entry, so a 200-decision block would expire before it could ever apply.
- A block **equal** to the reference holds back nothing and is not shown. This happens when the operator sets the config to the blocked value.

When the adjusted value does not move away from `current`, there is no change. The reference uses the record, not the effective value, so an invalid config does not flip the direction shown in the report. This needs no file change: a revert or an undo always leaves the reference on the far side of the blocked value, and a burst clears the block.

### D6. Lowering
It applies only when all of the following hold:
- a tuned `timeoutMs` applies (`base` equals the untuned value);
- no change is pending;
- at least 200 decisions follow the latest `timeoutMs` history entry;
- the latest 200 decisions hold at least 100 asked decisions and no timeout;
- p90 (D3) over those 200 is defined.

**Value:** `max(base, ceil100(p90 × 1.5), ceil100(current × 0.8))`, then the lowering block (D5). No change when the result is not below `current`. The 1.5 factor keeps headroom above recent latency. The 0.8 floor limits one step to 20%, so returning from 5000 to 1500 takes several clean stretches of 200 decisions. `before` is the counts of the latest 40 decisions. History cause `rule`; event `applied`.

**Why 200 and 100:** a lowering is the risky direction, since it brings back `no answer`. 200 decisions is the existing block length and the existing signal window, so the numbers stay familiar.

**Ledger check:** on 11-14 to 11-20 (p90 about 570–1270 ms, few timeouts) and a tuned 3000, the first lowering would be `max(1500, ceil100(1270 × 1.5) = 2000, 2400) = 2400`.

### D7. Texts
- **Change line, reverted lowering** (`to > from` on a `reverted` event): `Jev tune: timeoutMs <from>→<to>, reverted: timeouts came back · /jev tune`. A reverted raise keeps its current text.
- **Undo message:** a timeout undo that moves the value down keeps `The same raise is held back for 200 decisions.`; one that moves it up says `The same lowering is held back for 400 decisions.`

### D7b. Undo skips undone rules
Undo looks up the latest `rule` entry whose `to` equals the tuned value. After a lowering, that lookup alternates forever between two values (3000 → 2400 → 3000 …). An undo now skips a `rule` entry that a later `undo` entry of the same parameter reversed (`undo.from == rule.to` and `undo.to == rule.from`), matched newest first and one to one, so a transition repeated in history is undone once per undo. Repeated undos then walk back through the history, and no file change is needed.
- **Report block line:** a raise block keeps `block: raises to <v> or above held back for <k> more decisions`; a lowering block reads `block: lowerings to <v> or below held back for <k> more decisions`. The direction and remaining count come from the same `activeBlock` helper the policy uses (reference from the record, D5), not from the effective value.

### D8. Module layout
- `rules.ts` is already 282 lines. The burst and lowering rules go into a new pure module `src/policy/tuning/timeout-rules.ts`, which exports `burstRule` and `lowerRule`, each `(input, record) => StepResult`.
- `rules.ts` keeps orchestration (`stepTuning`), judging, revert, undo and reset.
- A leaf module `src/policy/tuning/timeout-change.ts` holds what both need: the step types, `applyChange`, rounding, and the block reference, direction and lifetime helpers. It keeps the import graph acyclic (`timeout-rules.ts` never imports `rules.ts`).
- `ruleOrigin` in `floor-step.ts` skips undone rules (D7b), for every parameter.
- `window.ts` gains `latestAsked(ds, n)` and the measured `p90`.
- Constants go into `TUNING` in `record.ts`: `burstWindow: 5`, `burstTimeouts: 3`, `burstFactor: 1.25`, `lowerAfter: 200`, `lowerMinAsked: 100`, `lowerFactor: 1.5`, `lowerStep: 0.8`, `lowerBlockFor: 400`.

## Risks / Trade-offs

- **[Risk]** A short burst raises the timeout, so a real outage costs up to 5000 ms per miss. → Lowering brings it back after 200 clean decisions, `/jev tune undo` and `reset` still work, and the hard ceiling stays 5000.
- **[Risk]** A burst ignores a block set by undo, so an operator's undo can be overridden by the next 3 timeouts. → Accepted by the user (react at once). `/jev tune off` stops it. The undo message is unchanged and still true for the window rule.
- **[Risk]** Oscillation between burst raises and lowering. → A lowering needs 200 clean decisions and is capped at 20% per step, and a reverted lowering blocks the same lowering for 400 decisions.
- **[Trade-off]** Burst and window raises share the cause `rule`. → Avoids a `tuning.json` version bump. History cannot tell them apart, which no reader needs.
- **[Trade-off]** The burst's `before` covers decisions before the change. → It only matters when no answer was rescued. Then a worse share after the raise is real evidence against the raise.
- **[Risk]** Worker routing shares the tuned timeout, so worker timeouts can trigger a burst. → Intended: they wait on the same classifier.

## Migration Plan

No data migration: `tuning.json` keeps version 1 or 2 and the same fields. An existing record with a raise block below its effective value cannot occur, since revert and undo always set the block on the far side. A record edited by hand is read with the derived direction. Rollback: an older package reads the same file.

## Open Questions

None.

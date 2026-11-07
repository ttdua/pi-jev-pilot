## Design Summary

**Intent.** On some providers, changing the thinking level between turns invalidates the prompt cache, so every per-prompt effort change from WG-07 costs a full cache rewrite. On those providers (A5, `effort.holdProviders`, default `["9router"]`) the package keeps the first effort decision for the rest of the session's context and only decides again when the context is rebuilt anyway: after a compaction, or after the operator switches model or provider.

**Behaviour.**

- A prompt on a held provider whose current context already has a decided turn for the same provider and model is *held*: the package does not ask `effort` or `risky`, does not touch the thinking level, and still asks `corrects`.
- The first decided turn after the start of the session, after the latest compaction, or after a model or provider change is the *anchor*. It is decided exactly as in WG-07.
- A turn counts as decided only when it produced an effective level: the level was applied, was already the target, or `max` was kept. A Jev miss, a discarded result (manual change during the wait) or an Esc before the first request does not count, so the next prompt asks again.
- Held turns are visible: the ledger line says the turn was held, and the status line keeps showing the level in force.
- Providers not in `holdProviders` behave exactly as in WG-07.

**Goals.** No thinking change after the anchor on a held provider; exactly one new decision after each compaction; correction tracking keeps working while held.

**Non-goals.** Detecting cache loss automatically; changing the default hold list (`claude-code` stays out per WG-02 Q8); skill and advice questions (WG-09, WG-10); tuning.

**Anti-goals.** A reload, resume, fork or `/tree` move that silently re-decides and loses the cache; a hold that sticks to a level from a different model; a Jev failure that locks the session at an undecided level.

**Done when.** A host test on a held provider shows no thinking change after the anchor, and exactly one decision after a compaction.

## Alternatives Considered

### Alternative A: In-memory hold flag
- **Approach**: a flag set on the first decision, cleared on `session_compact` and `session_start`.
- **Pros**: smallest code; no session data change.
- **Cons**: lost on reload or resume, so the session re-decides and loses the cache it was meant to protect; wrong after a fork or `/tree` move to a branch with a different history.
- **Why not chosen**: fails the main anti-goal on every resume.

### Alternative B: Ask everything, ignore the effort answer while held
- **Approach**: keep the WG-07 request unchanged and drop `effort` and `risky` at policy time.
- **Pros**: no change to question building; probabilities still logged for later analysis.
- **Cons**: pays for questions whose answers are never used; contradicts A5 ("questions omitted while held").
- **Why not chosen**: contradicts the roadmap item.

### Alternative C: Derive the hold from the current branch (chosen)
- **Approach**: the turn marker the package already writes to the session records that the turn was decided, for which provider and model; at each prompt the package looks for such a marker after the latest compaction on the current branch.
- **Pros**: survives reload and resume; follows forks and `/tree`; compaction releases the hold by construction.
- **Cons**: extends the session marker's content; one more branch scan per prompt.
- **Why not chosen**: chosen.

## Agreed Approach

Alternative C, chosen by the operator in the explore thread. The session history is the source of truth, so hold state is always consistent with the context the provider actually caches.

## Key Decisions

- Hold state is derived from the current branch, not kept in memory (operator).
- Only turns with an effective level start a hold; misses and discards do not (operator).
- The anchor is tied to provider and model; switching either decides again once (operator).
- While held, `corrects` is still asked and correction lines still work (from A5 and the workflow doc).
- Held turns are recorded as held in the ledger (my call; the ledger schema already reserves the flag).

## Open Questions

None blocking. Exact ledger fields for a held turn and the marker format are left to design.

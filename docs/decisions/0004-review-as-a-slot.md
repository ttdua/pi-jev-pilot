# 0004: Review routing is an ordinary slot Jev chooses

**Status:** Accepted, 2026-11-05

## Context

The operator wants reviews on `gpt-6.1-sol`. The first proposal was a dedicated `review` setting matching agent names. The operator proposed a plain crew slot named `reviewer`, with a model and a description, chosen by Jev.

Replay supported the operator's version: 18 of 18 review briefs chose the slot at probability ≥ .85 and none of the 28 others, and it still held when every agent was renamed `general-purpose`. A name list would miss those.

## Decision

No review-specific routing. Reviews route through a slot, the same mechanism as any custom model. The CLI review tool (`jev_review`) stays separate, on demand, and its command is `/jev cli-review`, leaving `reviewer` free as a slot name.

## Consequences

- One mechanism, not two.
- Review work is caught whichever agent performs it.
- All reviews use one model: a whole-branch review no longer rises to `deep`. To vary this, add a second slot.
- Depends on a well-written `when`.
- Quality of reviews on this model is not yet measured.

## Why

Skill pick (WG-09, issue #10) mixes pure rules with host seams and is sized L. Building the parts that need no running Pi first (skill criteria, batching, the skill questions, the pick rule, the delivery texts and the duplicate check) lets them be table-tested and reviewed alone, with their new wording, and leaves `wg-09-skill-host` with wiring only.

## What Changes

- Add skill criteria: each catalog entry becomes the option text Jev reads, `<description> — <first 300 characters of the body>`, with fallbacks.
- Add batching: a catalog over 254 skills is split into even batches in catalog order; each batch has its own `which` question with `(none)`.
- Extend the main question builder: `which` and the three `gate::*` questions are added when skill questions are asked, on the first batch only; further batches carry only `which`. With no skill questions asked, the output is unchanged.
- Add the pure pick rule: each batch's leader (a batch led by `(none)` offers nothing), the best leader across batches, picked at probability ≥ .5, or ≥ .3 with gate mean ≥ .3; any failed batch means no skill.
- The three gates are sent with `instructions` only, as upstream measured them.
- Add the delivery texts for `skills.inject: "content"` and `"suggest"`, and the one-line reference used when the same body is already in context.
- Add the pure duplicate check: given the skills already in context since the latest compaction (name and body fingerprint), choose full delivery or the reference.

**Skill pick details**
- From: the contract names the thresholds but not ties, missing gates, batch sizes, the gate wire form or the delivery wording.
- To: ties go to the earlier option; the gate mean uses the gates read, and with none only the .5 rule applies; batches are near-equal under 254; gates carry no criteria; the delivery wording is written in the docs.
- Reason: decisions made in the brainstorm, so the host change does not invent them.
- Impact: non-breaking; nothing calls the new code until `wg-09-skill-host`.

Docs updated: `docs/jev-questions.md` (delivery texts, gate wire exception), `docs/jev-contract.md` (criteria fallback, batch sizes, batch leader wording, ties, missing gates, gate wire form, duplicate rule), `docs/roadmap.md` (WG-09 split into two changes).

## Capabilities

### New Capabilities
- `skill-pick`: skill criteria, batching, the skill questions in a main request, how their answers become at most one pick, the delivery texts, and the duplicate check, as Pi-free functions.

### Modified Capabilities
- `main-effort`: the question wire format requirement gains the exception for the three skill gates. Eligibility, the main question set and `main-ledger` change in `wg-09-skill-host`, where the request starts carrying skill questions and the ledger records the pick.

## Impact

- New code: `src/policy/skill.ts`; additions to `src/jev/questions.ts` and `src/jev/rubrics.ts`; unit tests under `tests/policy/` and `tests/jev/`.
- No change to Pi wiring, `config.json`, `state.json` or the ledger. No new dependency.

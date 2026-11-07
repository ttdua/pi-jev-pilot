## Design Summary

WG-09 (issue #10) picks at most one skill per main prompt and attaches it to the model's context. It ships as two changes. This first change, `wg-09-skill-policy`, builds every part that can be tested without a running Pi host, so the second change, `wg-09-skill-host`, only wires them into Pi.

This change covers:

- **Skill criteria.** Turns each catalog entry (name, description, body) into the text Jev reads for that option: `<description> — <first 300 characters of the body>`, with fallbacks when a part is missing.
- **Batching.** A catalog of more than 254 skills is split into batches, each with its own `which` question and its own `(none)` option. Only the first batch carries the other main questions and the three skill gates.
- **Main questions.** `which` and the three `gate::*` questions join the main question set, behind a switch, so a request can ask skill questions, effort questions, or both.
- **Pick rule.** From the answers of every batch, pick at most one skill: the best leader across batches, kept when its probability is at least .5, or when both its probability and the gate mean are at least .3. A failed batch means no skill.
- **Delivery text.** The text of the hidden message for `skills.inject: "content"` (the whole body, with the skill's directory so relative references resolve), for `"suggest"` (the name and path only), and the one-line reference used when the same body is already in context.
- **Duplicate check.** Given what is already in context since the latest compaction (skill name and body fingerprint), decide whether to send the body, the suggestion, or only the reference.
- **Docs.** Wording for the delivery texts is added to `docs/jev-questions.md`, so it is reviewed here and not invented in the host change.

The host change keeps: reading the catalog from `pi.getCommands()`, reading skill files and computing fingerprints, skipping skill questions after an explicit `/skill:name`, sending a request when only `skills` is on, reading the branch since the latest compaction, the hidden message, ledger fields, and the host test that the body reaches the provider exactly once.

## Alternatives Considered

### Alternative A: One change for all of WG-09
- **Approach**: Build pick, delivery and host wiring together.
- **Pros**: One review; no interface fixed before the host code exists.
- **Cons**: A large diff mixing pure rules with host seams; the size is L on the roadmap.
- **Why not chosen**: The operator chose two changes during exploration (issue #10 comment).

### Alternative B: Pick only, delivery in the host change
- **Approach**: This change holds criteria, batching, questions and the pick rule; the delivery texts and the duplicate check go to the host change.
- **Pros**: Smallest first change.
- **Cons**: The delivery texts and the duplicate decision have no host dependency; leaving them to the host change moves new user-visible wording into a change whose review is about wiring.
- **Why not chosen**: The operator chose to include delivery, so the wording is reviewed with the rules.

### Alternative C: Rank skills with a second request
- **Approach**: Ask Jev once for a shortlist, then once more to rerank.
- **Pros**: Possibly sharper picks on large catalogs.
- **Cons**: Doubles latency and cost; C4 in the project brief rejected it.
- **Why not chosen**: Out of scope by an earlier decision.

## Agreed Approach

Alternative choice: two changes, this one holding the criteria, batching, questions, pick rule, delivery texts and duplicate check. It follows the architecture's split (`policy/` pure, `jev/` free of Pi) and the WG-11 precedent, and leaves the host change with wiring only.

## Key Decisions

- Two changes for WG-09; this is the first, and #10 closes when both are merged.
- The delivery texts and the duplicate check are part of this change (operator's answer in the brainstorm).
- A failed batch means no skill, but does not discard answers from the first batch: effort still applies when the first batch answered (operator's answer during exploration).
- The duplicate check matches on skill name plus a body fingerprint, so an edited skill is sent again (operator's answer during exploration). Only what is in context since the latest compaction counts; this change receives that list as input.
- The skill questions are asked only when the skill feature is on; effort questions only when effort is asked. A request may carry only skill questions (operator's answer during exploration; the host change wires it).
- The content form follows the block Pi itself uses for an explicit `/skill:name` (name, location, base directory, body), so a skill the operator loaded and a skill this package attached look the same to the model and to the duplicate check. My call, for consistency.
- Ties: the earlier skill in catalog order wins, within a batch and across batches. My call; the docs do not say.
- The gate mean averages the gate answers that were read, with `prose_suffices` inverted. When none was read, only the .5 rule applies (operator's answer, 2026-11-07; upstream instead treats no gate as passing).
- The three `gate::*` questions are sent with `instructions` only and no `criteria`, as upstream sends them and as the .3 threshold was measured. This is an exception to the rule that every question carries `criteria`, recorded in the docs (operator's answer, 2026-11-07). Writing new true/false wording would need a replay.
- A batch holds at most 254 skills plus `(none)`, since TypeSafe refuses a choice with more than 255 options. The catalog is split into as few batches as fit, of near-equal size, in catalog order (302 skills become 151 and 151), as upstream does.
- Workers get no skill selection, as the docs already say.

## Open Questions

- None blocking this change. The host change decides how an explicit `/skill:name` is detected and whether `corrects` is asked when only `skills` is on.

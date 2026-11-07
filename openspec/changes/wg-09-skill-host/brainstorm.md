## Design Summary

WG-09 (issue #10) picks at most one skill per main prompt and attaches it to the model's context. The first change, `wg-09-skill-policy` (#33), shipped the Pi-free parts: criteria, batches, the `which` and gate questions, the pick rule, the delivery texts and the duplicate lookup. This second change, `wg-09-skill-host`, wires them into Pi so that the operator sees a skill attached to a prompt. With it merged, #10 closes.

This change covers:

- **Catalog.** The skills Pi reports through `pi.getCommands()` with `source: "skill"`, each read from its file. Skills marked `disable-model-invocation: true`, unreadable files, and names the ledger cannot record are left out.
- **When skill questions are asked.** On an eligible main prompt with the `skills` feature on, a non-empty catalog, and no explicit `/skill:name` in the prompt. A main request is now sent when effort applies or skills apply. With only `skills` on and nothing to ask about skills, no request is sent.
- **Explicit `/skill:name`.** The operator already chose a skill, so the skill questions are skipped for that prompt. The effort questions still run.
- **Batches.** The first batch rides on the main request with the main questions. Later batches go out in parallel. Effort still applies when the first batch answers, even if a later batch fails. Any failed batch means no skill.
- **Delivery.** A picked skill reaches the model through a hidden message: the whole body (`content`), or only its name and path (`suggest`), as `skills.inject` says.
- **No duplicates.** When the same skill with the same body is still in the model's context, from an earlier pick or an explicit `/skill:name`, only a one-line reference is sent. Anything that a compaction dropped from the context does not count, so a skill picked again after a compaction is sent again in full.
- **Ledger.** The `main` line records the pick, its probability and the gate mean.
- **Host test.** Across repeated picks of the same skill on one branch, the body reaches the provider exactly once. The `(none)` path and the path where the gate is too low attach nothing.

The status line does not show the skill in this change; that is a follow-up.

## Alternatives Considered

### Alternative A: A separate skill request
- **Approach**: A second `before_agent_start` handler sends its own Jev request with only the skill questions, next to the existing main request.
- **Pros**: The skill and effort flows stay independent in code; no change to main-request eligibility.
- **Cons**: Two requests per prompt, about twice the cost and more waiting; Jev sees the same state twice. It goes against the agreed rule that the first batch carries the main questions.
- **Why not chosen**: Costs a request per prompt for no gain in accuracy.

### Alternative B: Detect `/skill:name` from the `input` event
- **Approach**: Note in the `input` event that the raw text starts with `/skill:`, and skip skill questions in the following `before_agent_start`.
- **Pros**: Sees the operator's literal command.
- **Cons**: Needs state carried between two events. It misses text that another extension rewrote. The duplicate check would still have to parse the expanded block for skills loaded on earlier prompts.
- **Why not chosen**: The operator chose parsing the expanded block (brainstorm answer). It is stateless and is the same parse the duplicate check uses.

### Alternative C: Ask skill questions even with an empty catalog or an explicit skill
- **Approach**: Whenever `skills` is on, send a request, even if it asks only `corrects`.
- **Pros**: Simpler eligibility rule.
- **Cons**: A Jev call per prompt whose only use is `corrects`.
- **Why not chosen**: The operator chose no request in that case (brainstorm answer). It matches "when every applicable feature is off, no request is made".

## Agreed Approach

One main request per prompt that carries the skill questions of the first batch, with later batches in parallel (not Alternative A). An explicit `/skill:name` is detected from the expanded prompt (not Alternative B). `skills` counts as applying only with a catalog and no explicit skill (not Alternative C). The wiring sits in the host layer, so the rules shipped in #33 stay pure and unchanged.

## Key Decisions

- `corrects` is asked on every main request, including one where only skills apply (operator's answer).
- An explicit `/skill:name` is detected from the leading skill block of the expanded prompt (operator's answer).
- No status-line change in this change; showing the skill is a follow-up (operator's answer).
- `skills` counts as an applying feature only when the catalog is non-empty and the prompt has no explicit skill. Otherwise, with no other feature applying, no request is sent (operator's answer).
- Effort applies when the first batch answers; any failed batch gives no skill (decided during exploration, issue #10).
- Duplicates are matched on skill name plus a body fingerprint, so an edited skill is sent again (decided during exploration).
- "Still in context" means what Pi would send to the model now, so entries kept across a compaction count and dropped ones do not. My call: it is closer to the intent than "after the latest compaction", and it gives the same result when nothing was kept.
- Skills whose names the ledger cannot record are left out of the catalog. My call: otherwise a pick would make the whole `main` line invalid.
- WG-10 (#31) returns its advice from the same hook, and the hook carries one hidden message. Whichever change merges second combines the skill text and the advice into that one message. My call: build on `main` now and reconcile at rebase.
- Workers get no skill selection, as the docs already say.

## Open Questions

- None blocking. The order of skill text and advice inside the combined message is settled at the WG-10 rebase.

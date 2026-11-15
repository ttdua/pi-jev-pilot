## Design Summary

**Intent.** Main-session effort should follow the work a prompt sets in motion, read from the conversation, never from how long the prompt is. Today the main effort instruction ties its follow-up rule to length: "A **short** reply that approves, continues or picks an option … takes the size of the work it approves". In the operator's ledger (one week, 991 main decisions), 488 of the 787 main turns started at `low` were replies to the agent's own questions sent through the review inbox. Those replies are about 800 characters long because of their fixed header, so the "short reply" rule plausibly does not apply to them. Jev rated the reply text instead of the work it approved. Jev's probability of `high` or above barely separated replies that led to large turns (median 0.18, 74 turns) from those that led to small ones (0.13, 414 turns).

**What changes.**

1. **Role-based follow-up rule.** The main `effort` instruction rates a reply to the agent's own question, review or gate by the size of the work it approves, read from the recent conversation, whatever the reply's length. Inbox answers and long approvals with notes are covered. The word "short" and length-based examples go away. The worker `effort` instruction and the five level criteria do not change.
2. **No length signal.** `request.prompt_chars` is removed from the main state, so nothing sent to Jev invites a length-based judgement. The other request signals stay.
3. **Measured before shipping.** Each change is a separate replay variant against the current wording and state, with the existing plain reruns as the noise floor. A variant wins only when:
   - effort flips exceed noise,
   - a side measure shows the new effort tracks the real size of the turn, and
   - the operator reads the changed cases and prefers the new answers.

   The side measure joins each replayed sample to its own ledger line and compares the new effort with the tool calls that turn really made. It reports aggregate counts only.

**Goals.**
- Replies that approve large work are rated by that work.
- No part of the main request rates a prompt by its length.
- Evidence of the shift, committed as aggregates only.

**Non-goals.**
- No change to worker requests, tier rubrics, risk floor, effort ceiling or effort option order.
- No automatic tuning of effort. `tuning-signals` stays observe-only.
- No code-computed "reply" flag and no change to the `conversation.recent` budget (alternatives B and C below).

**Anti-goals.**
- Raising effort across the board. A rubric that sends most `low` turns to `high` costs more without evidence of better work, and counts as a failure even if replies are caught.
- Detecting replies by a prefix such as the inbox header. The rule must hold for any reply, typed or relayed.

**Constraints.**
- A wording or state change needs a replay with plain reruns. The run needs the operator's approval of data and estimated cost. Only aggregates are committed, and private case files are deleted after the decision.
- Never store prompt text. The side measure keeps counts only.
- Public repository: wording, docs and evidence in English, with no real prompts.

**Existing requirements involved.**
- `main-state` / **Request signals**: lists `prompt_chars` among the `request` fields. This change **alters** that requirement by removing `prompt_chars`, if the variant wins.
- `main-effort` / main request questions: "Wording follows `docs/jev-questions.md`". The requirement stays; the wording it points to changes.
- `worker-request` / **Question wording**: worker `effort` keeps its own instruction. Unchanged.
- `docs/testing.md` replay rules: followed as written.

## Alternatives Considered

### Alternative A: Rubric only (chosen)
- **Approach**: Rewrite the follow-up rule by role. Jev reads the previous assistant message already present in `conversation.recent` and judges whether the prompt replies to it.
- **Pros**: Smallest change. No heuristic in code. Decides from context, as asked. The newest assistant message already keeps most of its end, where questions and next steps usually sit.
- **Cons**: Depends on Jev applying the wording. The newest assistant message is still capped.
- **Why chosen**: See Agreed Approach.

### Alternative B: Rubric plus a code-computed `replies_to_agent` flag
- **Approach**: Code marks the prompt as a reply when the previous assistant message ends with a question or a list of choices.
- **Pros**: Jev sees the prompt's role explicitly.
- **Cons**: An English-pattern heuristic misreads Vietnamese and relayed inbox replies. Adds a contract field and another replay variant.
- **Why not chosen**: Puts a guess in code where the rule asks for context. Kept as a follow-up only if A falls short.

### Alternative C: Rubric plus a larger tail of the previous assistant message
- **Approach**: Change the `conversation.recent` budget so the end of the newest assistant message is always kept in full.
- **Pros**: Jev always sees what is being approved.
- **Cons**: Changes a specified budget. Takes room from older messages. Adds a replay variant.
- **Why not chosen**: The current budget already keeps 72% of the cap from the end. Kept as a follow-up only if the replay shows truncated questions.

## Agreed Approach

Alternative A, chosen by the operator. Rewrite the main follow-up rule by role and remove `prompt_chars`, each measured as its own replay variant. Ship each only if it wins by the three-part test above. A variant that does not win is recorded in the evidence and left out. B and C stay as follow-ups that only a measured shortfall of A would justify.

## Key Decisions

- **The principle (operator):** effort is decided from context, not from message length.
- **Two independent variants (operator):** a role-based rubric and no `prompt_chars`. Each is measured alone, and each ships alone.
- **Win test (operator):** beyond noise, plus the side measure against real tool calls from the ledger, plus the operator's reading of changed cases.
- **Reply detection (operator):** by Jev from the conversation (A). No code flag, no budget change.
- **Scope (proposal):** main request only. The worker instruction is left alone because worker briefs are not replies.
- **Privacy (proposal):** the side measure stores only aggregate counts. Prompt-level joins stay in the private replay output and are deleted after the decision.

## Open Questions

- **Sample shape.** Should the replay draw extra reply samples so enough of them are present, or keep the stratified 100-sample default, where about a third are replies? This is left to design. The default is to keep the sampler and report reply and non-reply samples separately.
- **Thresholds of the side measure.** What counts as "tracks the real size": for example, how many large turns moved up against how many small turns moved up. This is left to design, and the operator judges the result at the read-out.

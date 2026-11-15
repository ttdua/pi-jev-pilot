## Why

Main effort is meant to follow the work a prompt sets in motion, read from the conversation. The main effort instruction ties its follow-up rule to length ("a short reply…"). In one operator's ledger, 488 of 787 main turns started at `low` were long inbox replies approving the agent's own proposal. Jev rated the reply text instead of the approved work, and barely separated replies that led to large turns from those that led to small ones. `request.prompt_chars` also puts a length signal in front of Jev. Decide from context, never from length, and measure it before shipping.

## What Changes

**Replay variants for the two changes**
- From: pass 1 has no variant for the main effort instruction or for `request` signals, and reports no link to the real size of a turn.
- To: pass 1 adds `role-rule` (the main effort instruction with the candidate role-based rule) and `no-prompt-chars` (`request` without `prompt_chars`), each based on the shipped state. It also reports a turn-size side measure that joins each sample to the tool calls its turn really made, in counts only.
- Reason: wording and state changes ship only with replay evidence.
- Impact: non-breaking. The operator CLI accepts two more `--only` names, and the replay aggregates gain fields.

**Main effort follow-up rule** (ships only if `role-rule` wins)
- From: "A short reply that approves, continues or picks an option (…) takes the size of the work it approves."
- To: a reply to the agent's own question, review or gate, of any length, takes the size of the work it approves, read from the recent conversation. No length wording.
- Reason: inbox replies and long approvals were rated by their text.
- Impact: non-breaking. It changes the main `effort` instruction sent to Jev. Worker requests are unchanged.

**`request.prompt_chars`** (removed only if `no-prompt-chars` wins)
- From: `request` carries `text`, `prompt_chars`, `files_mentioned`, `has_code_or_error`, `is_question`.
- To: `request` carries the same fields without `prompt_chars`.
- Reason: no part of the main request should invite a length-based judgement.
- Impact: changes the main state sent to Jev. No stored format changes.

**Outcome (2026-11-15 replay, [evidence](../../../../docs/evidence/2026-11-15-effort-reply-replay.md)):** `role-rule` won and ships. `no-prompt-chars` stayed within noise and does not ship: `prompt_chars` is still sent, and the variant stays in the replay.

A variant that does not win is recorded in the evidence and stays in the replay. Its product delta (`main-effort` or `main-state`) and its shipping task are dropped before verify. A variant that wins ships and is removed from the replay, together with its bullet in the `state-replay` delta.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `state-replay`: pass 1 gains the `role-rule` and `no-prompt-chars` variants, based on the shipped state. A new requirement adds the turn-size side measure.
- `main-effort`: adds a requirement that the main `effort` instruction rates a reply by the work it approves, with no length wording.
- ~~`main-state`: the **Request signals** requirement drops `prompt_chars`.~~ Dropped after the replay: `no-prompt-chars` did not win, so this change modifies no `main-state` requirement.

## Impact

- **Code:**
  - `src/jev/rubrics.ts` (`MAIN_EFFORT_INSTRUCTION`)
  - `src/jev/state.ts` (`RequestSignals`, `requestSignals`)
  - `scripts/replay/` (`variants.ts`, `corpus.ts`, `sessions.ts`, `compare.ts`, `cli.ts`)
- **Tests:**
  - `tests/jev/questions.test.ts`, `tests/jev/state.test.ts`
  - `tests/replay/*`, with fixtures under `tests/fixtures/replay/sessions/`
  - host tests that pin the main request
- **Docs:**
  - `docs/jev-questions.md` (main instruction)
  - `docs/jev-contract.md` (main state and `request` table)
  - `docs/testing.md` (new variants and side measure)
  - a new `docs/evidence/<date>-effort-reply-replay.md` (aggregates only)
  - `docs/roadmap.md` (the "Effort rubric revision" row)
- **Operations:** one replay run with `--send` against real Jev. It needs the operator's approval of data and estimated cost, at a few US cents.
- **Dependencies:** none.

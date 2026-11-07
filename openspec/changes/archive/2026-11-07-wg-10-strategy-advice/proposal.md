## Why

Roadmap D1 (WG-10, issue #11) is the last missing piece of milestone M1. The main session gets effort per prompt, but never a hint that a request is better split across subagents. Jev can read that cheaply in the request the package already sends. Today the `strategy` switch exists and does nothing, and the WG-07 specs forbid the questions and ledger fields that advice needs.

## What Changes

**Main eligibility**
- From: a main request is sent only when `effort` is on.
- To: a main request is sent when `effort` or `strategy` is on. `effort` and `risky` are asked only when `effort` is on and the model supports levels. `tier` and `strategy` are asked only when `strategy` is on. `corrects` is asked on every main request.
- Reason: each switch controls only its own feature.
- Impact: non-breaking. With both features on, the request gains two questions. With `effort` off and `strategy` on, requests and `main` lines now happen.

**Strategy advice (new)**
- Two new main questions:
  - `tier`: `fast`, `balanced`, `deep`, with plain `standard` criteria.
  - `strategy`: `direct`, `delegate`, `parallel`, `graph`.
- Fixed probability gates:
  - `delegate` ≥ .6
  - `parallel` ≥ .6 and `tier` is not `fast`
  - `graph` ≥ .8 and `tier` is `deep`
  - `direct`, an unanswered `strategy`, and an unanswered `tier` for `parallel` and `graph` attach nothing.
- An advice that passes is attached as one hidden `<execution_strategy>` message through `before_agent_start`, with the wording of `docs/jev-questions.md` and without upstream's `junior`.
- Advice is independent of the effort result: a manual level change during the wait does not drop it.
- User and project instructions and a loaded skill take precedence over advice.

**Main ledger line**
- From: `advised`, `strategy` and `strategyP` MUST be absent.
- To: when `strategy` was answered, the line records `strategy`, `strategyP` and `advised`. No schema change; no main `tier` field.

**Status line**
- From: the suffix shows only the effort level or `no answer`.
- To: when advice was attached on the latest decided turn, ` · <strategy>` follows. Example: `Jev · standard · high · delegate`, or `Jev · standard · delegate` with `effort` off.

## Capabilities

### New Capabilities
- `strategy-advice`: the main `tier` and `strategy` questions, the probability gates, the advice block text and how it reaches the model, and precedence.

### Modified Capabilities
- `main-effort`: eligibility now depends on `effort` or `strategy`; the main question set becomes per-feature; the effort result no longer covers every answer of the request.
- `main-ledger`: `main` lines carry `strategy`, `strategyP` and `advised` when `strategy` was answered; the "Ineligible prompt" scenario follows the new eligibility.
- `status-line`: the suffix can add the attached strategy, and it is shown when `effort` is off.

## Impact

- **Code.**
  - New `src/policy/strategy.ts`: the gates and the block text, pure.
  - `src/jev/rubrics.ts` and `src/jev/questions.ts`: the main `tier` and `strategy` questions, and per-feature main questions.
  - `src/host/main.ts`: eligibility, the returned hidden message, and the ledger fields.
  - `src/host/status.ts`: the `Decision` suffix.
- **Tests.**
  - New `tests/policy/strategy.test.ts`.
  - Extended `tests/jev/questions.test.ts`, `tests/host/main.test.ts`, `tests/host/status.test.ts` and `tests/host/main-effort.test.ts`, or a new host test for advice.
- **Docs.**
  - `docs/jev-questions.md`: the main `tier` has no display-name prefix.
  - `docs/jev-contract.md`: eligibility, the gate note on an unanswered `tier`, and precedence that includes skills.
  - `docs/domain-model.md`: the Advice row.
  - `docs/usage-guide.md`: the status line with advice.
  - `docs/roadmap.md`: WG-10 status at finalize.
- **No change.** Dependencies, config keys, ledger schema, worker routing and the Jev wire format stay as they are.

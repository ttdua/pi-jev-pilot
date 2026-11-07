## Design Summary

WG-10 (roadmap D1, issue #11) adds **strategy advice** to the main session. On each eligible main prompt, the same single Jev request that already carries `effort`, `risky` and `corrects` also asks `tier` and `strategy` when the `strategy` feature is on. Fixed probability gates turn the answers into either nothing or one hidden `<execution_strategy>` block that the model may ignore.

- **Intent.** Give the main model an occasional, cheap hint that a request is better split across subagents (`delegate`, `parallel`, `graph`). Never enforce it; `direct`, the common answer, attaches nothing.
- **Who it serves.** The operator, through the main model's context. In replay, advice was attached on about 5 of 500 turns.
- **Goals.**
  - The `tier` and `strategy` questions, with the wording in `docs/jev-questions.md`.
  - Gates on probability, each boundary tested.
  - The block text without upstream's `junior`.
  - The ledger fields `strategy`, `strategyP` and `advised`.
  - Advice shown on the status line.
- **Non-goals.**
  - The main `tier` never picks a model.
  - No new ledger fields.
  - No change to skill selection (WG-09).
  - No change to worker routing.
  - No new config keys or thresholds.
- **Anti-goals.**
  - Advice that blocks, rewrites or delays work beyond the existing request.
  - Advice that overrides user or project instructions or a loaded skill.
  - A second Jev request per prompt.
  - Any prompt text in the ledger.
- **Constraints.**
  - Fail open.
  - Probabilities only, never `confidence`.
  - `policy/` stays pure.
  - Public Pi APIs only: a hidden message through `before_agent_start`, proven by WG-02 Q5.
  - The block wording must not change without a replay.

## Alternatives Considered

### Alternative A: Extend the existing main decision
- **Approach**:
  - Main eligibility becomes "`effort` or `strategy` is on".
  - Questions are built per feature.
  - A pure `src/policy/strategy.ts` holds the gates and the block text.
  - `src/host/main.ts` returns the hidden message from `before_agent_start` and records the ledger fields and status suffix.
- **Pros**:
  - One Jev request per prompt, as the contract says.
  - Matches the module layout in `docs/architecture.md`.
  - Reuses answer reading, the ledger line and status drawing.
- **Cons**:
  - The eligibility and ledger specs of WG-07 change.
- **Why not chosen**: chosen.

### Alternative B: A separate advice handler with its own request
- **Approach**: A second `before_agent_start` handler asks only `tier` and `strategy`.
- **Pros**:
  - Leaves WG-07 untouched.
- **Cons**:
  - Two requests per prompt, which adds latency and cost and contradicts the Jev contract.
  - Two `main` ledger lines or a merge problem.
  - Two status writers.
- **Why not chosen**: breaks the single-request contract and the one-line-per-turn ledger rule.

### Alternative C: Gate logic inline in `host/main.ts`
- **Approach**: Same as A, but the gates and text live in the host handler.
- **Pros**:
  - Fewer files.
- **Cons**:
  - Breaks "policy is pure".
  - Boundary tests would need host fakes.
- **Why not chosen**: the boundary tests asked for in the Done-when belong in pure unit tests.

## Agreed Approach

Alternative A. It is the only option that keeps one Jev request and one ledger line per turn, and that tests the gates as pure policy.

## Key Decisions

Agreed with the operator in the WG-10 Inbox thread:

1. **Eligibility.** A main request is sent when `effort` **or** `strategy` is on, with the other existing conditions unchanged. `effort` and `risky` are asked only when `effort` is on (and the model supports levels). `tier` and `strategy` are asked only when `strategy` is on. `corrects` is asked whenever a request is sent.
2. **Gates.**

   | Strategy | Probability | Also |
   |---|---|---|
   | `direct` | | Never attaches |
   | `delegate` | ≥ .6 | |
   | `parallel` | ≥ .6 | `tier` is not `fast` |
   | `graph` | ≥ .8 | `tier` is `deep` |

   The probability is the chosen option's. An unanswered `strategy` attaches nothing. An unanswered `tier` makes `parallel` and `graph` attach nothing (fail closed).
3. **Main `tier` question.** Plain `standard` criteria for `fast`, `balanced` and `deep`, with no model display-name prefix and no slots or `expert`. The docs line that implies a prefix is clarified.
4. **Manual level change during the wait.** It discards only the effort result. Advice is still attached.
5. **Status line.** It shows the attached strategy as a suffix. Advice that was not attached leaves no suffix.
6. **Ledger.** It records only the existing `strategy`, `strategyP` and `advised` fields. There is no schema change, and no main `tier` is logged.
7. **Precedence.** Docs and spec state that user and project instructions and a loaded skill take precedence over advice. The block text stays as written in `docs/jev-questions.md`, without `junior`.

My calls, which the operator can correct:

- **Status format.** The suffix follows the level, as in `Jev · standard · high · delegate`. With `effort` off it is `Jev · standard · delegate`. A turn whose advice was not attached drops the strategy part.
- **Hidden message.** One hidden custom message per advised turn, with `display: false` and a package-specific `customType`. It is not de-duplicated, because each turn's advice is about that turn.
- **Esc before any provider request.** It restores the previous status text, as WG-07 already does. Nothing is written to the ledger.

## Open Questions

None blocking. The exact status-line wording when the effort suffix is `no answer` and advice is attached cannot happen, because a miss means no advice. This is recorded in design.

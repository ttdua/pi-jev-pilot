## Context

WG-07 shipped the main decision in `src/host/main.ts`. One `before_agent_start` handler builds the main state, asks Jev `effort`, `risky` and `corrects` in one request, applies the level, and writes one `main` ledger line when the run settles. The status suffix comes from a single `Decision` value (`level` or `no-answer`). The handler returns `undefined`, and nothing is injected yet. WG-02 Q5 proved that a `before_agent_start` `message` with `display: false` reaches that turn's provider request and survives until a compaction. `branchItems` already ignores custom messages, so injected advice never feeds back into `conversation.recent`.

The brainstorm fixed the behavior. This file records only how the code is shaped.

## Goals / Non-Goals

**Goals:**
- Gates and block text in a pure `src/policy/strategy.ts`, testable at every boundary without Pi.
- One Jev request and one `main` line per turn, as today.
- Effort and advice handled as independent results of the same answers.

**Non-Goals:**
- Merging advice with a skill message (WG-09 will need it; see Risks).
- Any change to worker routing, the ledger schema or the Jev wire format.

## Decisions

0. **`Strategy` type in policy.** `src/policy/strategy.ts` declares its own `Strategy` union, because the lint boundary forbids `policy/` importing `store/`. A type-level test pins it equal to the ledger's union.
1. **Pure advice function.** `adviseStrategy(input) → { strategy, strategyP, advised, block? }` in `src/policy/strategy.ts`, with the thresholds as named constants there (`STRATEGY_THRESHOLD = 0.6`, `GRAPH_THRESHOLD = 0.8`), following `RISK_FLOOR` in `effort.ts`.
   - The input is the read `strategy` answer (choice and probabilities) and the optional `tier` choice. `strategyP` is the probability of the chosen option.
   - The block text is built there from constants copied verbatim from `docs/jev-questions.md`.
   - *Alternative:* gates in `host/main.ts`. Rejected, because the boundary tests would need host fakes.
2. **Question wording stays in `rubrics.ts`.** `STRATEGY_QUESTION` and `MAIN_TIER_QUESTION` sit beside the other questions. `MAIN_TIER_QUESTION` reuses `TIER_INSTRUCTION` and `STANDARD_TIER_CRITERIA` for `fast`, `balanced` and `deep`, without a name prefix.
   - `mainQuestions` takes `{ askEffort, askStrategy }`, so the question set follows the switches. `corrects` is always asked.
3. **Eligibility in `decide()`.** The early return becomes `!(switches.effort || switches.strategy)`. `askEffort` becomes `switches.effort && canAskEffort(supported)`.
   - When neither `effort` nor `risky` nor `tier` nor `strategy` is asked, the request still asks `corrects`. That matches today's non-reasoning model path, and the ledger needs it.
4. **Order inside `decide()`.** After the answers are read, the advice is computed **before** the effort block, because the effort block has early returns (effort unanswered, discarded, `max` kept). The advice is recorded on the `TurnRecord` (`strategy`, `strategyP`, `advised`) and becomes the handler's return value.
   - So the operator's manual change discards only the level, and a `max` level or an unanswered `effort` never drops advice.
   - `beforeAgentStart` returns `{ message: { customType: "jev-advice", content: block, display: false } }` when `advised`, otherwise `undefined`.
5. **Status state splits into two parts.** `Decision` becomes `{ effort?: { kind: "level"; level } | { kind: "no-answer" }; advice?: Strategy }`.
   - `statusText` appends the effort part only when `effort` is on (as today), then ` · <strategy>` when `advice` is set and `strategy` is on.
   - Updates per decided turn:
     - **Effort part:** follows the WG-07 rules unchanged.
     - **Advice part:** a turn that asked `strategy` sets it to the attached strategy or clears it. A miss clears it. A turn that did not ask `strategy` leaves it.
     - **Cancelled turn:** restores the whole previous `Decision` (the existing `undo`).
   - *Alternative:* a separate widget. Rejected; the spec says one line with key `jev`.
6. **Ledger.** `write()` adds `strategy`, `strategyP` and `advised` when `strategy` was answered. The schema already validates them. No `tier` field, as agreed.

## Risks / Trade-offs

- **[WG-09 also needs the single `message` slot]** → Keep advice in a separate `content` builder, so WG-09 can merge skill and advice into one message, or return the skill and send advice differently. Out of scope here; noted for WG-09.
- **[A replay-tuned wording drifts from the docs]** → The question and block strings are copied verbatim, and a unit test compares them with the text extracted from `docs/jev-questions.md`. If no such test exists for the current rubrics, add one for the new strings only.
- **[Requests with `effort` off and `strategy` on cost money and up to 1.5 s per prompt]** → Accepted. The operator chose it. `/jev strategy off` with `/jev effort off` still sends nothing.
- **[Esc after Jev answered but before any provider request]** → The status and ledger are restored. Whether Pi keeps the returned hidden message in the session file after such an abort is Pi's behavior. It is not tested here, and it is harmless: the message is advice the model may ignore.
- **[Advice that piles up in history on long sessions]** → It is rare (about 1%), and a compaction drops it (Q5).

## Migration Plan

None. No stored data changes. Old ledger lines stay valid. Turning `strategy` off returns WG-07's behavior, except that `effort` off with `strategy` on now sends requests.

## Open Questions

None.

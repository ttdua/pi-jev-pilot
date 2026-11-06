## Why

The package is ready (stores, Jev client, ledger, status line) but decides nothing. WG-07 makes the first real decision, the main session's thinking level per prompt (A1, with the minimal E2 state), and proves the whole path end to end: Pi event, Jev request, pure policy, host effect, ledger line. WG-08, WG-09, WG-10 and WG-18 build on this path and on the lines it writes.

## What Changes

- Before each eligible main prompt with `effort` on, one Jev request with the questions `effort`, `risky` and `corrects` and the minimal main state (`request`, `conversation.recent`, `conversation.recent_tools`, `conversation.turn_index`, `workspace.platforms`).
- A pure effort policy: Jev's choice, at least `high` when `risky > .7`, capped at `xhigh`, clamped to the model's supported levels, and a current `max` never lowered.
- The level is applied in `before_agent_start`, so it reaches the turn's first provider request. A result is discarded when the operator changes the level while Jev answers.
- **Esc during classification:** Pi gives `before_agent_start` no abort signal. When the run settles aborted with no provider request, the package restores the level it replaced, unless the operator changed it since. A Pi issue asking for a signal is drafted and posted only with the operator's go-ahead.
- One `main` ledger line per decided turn, completed with the turn outcome, plus a `correction` line for the previous turn when `corrects ≥ .7`. A session custom entry records each turn's id on its branch.
- The status line shows the decided level (`Jev · standard · high`) or `Jev · no answer`.

**Package registration**
- From: `/jev` plus `session_start` and `session_shutdown` handlers, and executor event subscriptions.
- To: also `before_agent_start`, `before_provider_request`, `turn_end` and `agent_settled` handlers. Still no tools, flags or shortcuts.
- Reason: the decision and its outcome need these events.
- Impact: non-breaking; nothing is released.

**Status line text**
- From: base state only.
- To: base state, then ` · <level>` or ` · no answer` after a decision in this session.
- Reason: makes the first decision visible without reading the ledger.
- Impact: display only.

## Capabilities

### New Capabilities

- `main-effort`: when a main prompt is classified, what is asked, how answers become a thinking level, when it is applied, discarded or restored, and how Jev failure and cancellation behave.
- `main-state`: the minimal main state sent to Jev and how each field is built from the branch, the prompt and the workspace.
- `main-ledger`: which ledger lines a main turn writes, when, with which fields, and how correction lines find the previous turn.

### Modified Capabilities

- `status-line`: the line gains the decision suffix (`· <level>` or `· no answer`) and is refreshed after each main decision.
- `package-loading`: the bounded registration requirement lists the new event handlers.

## Impact

- **Code**: new `src/policy/effort.ts`, `src/jev/questions.ts`, `src/jev/state.ts`, `src/host/context.ts`, `src/host/main.ts`; changes to `src/host/setup.ts` and `src/host/status.ts`. Stores, client, answer reading and ledger are used as they are.
- **Tests**: unit tests for the effort policy, question and state builders, and the turn bookkeeping; host tests through the real CLI with loopback Jev and provider fixtures (level on the first request, Jev down, Esc, discard, ledger lines with no prompt text).
- **Dependencies**: none added. `pi.setThinkingLevel` already clamps to the model; the effective level is read back with `pi.getThinkingLevel()`, so nothing is imported from `@earendil-works/pi-ai`.
- **Schema**: ledger schema unchanged.
- **docs/ updated**: `docs/evidence/2026-11-05-host-seams.md` (the `before_agent_start` signal finding), `docs/architecture.md` (host seams table: `before_provider_request`, `agent_settled` for the Esc restore; failure model row for Esc), `docs/workflow.md` (main prompt flow: restore on Esc, status line), `docs/usage-guide.md` (status line decision text), `docs/roadmap.md` (WG-07 status), `docs/jev-questions.md` (wire format: `instructions` and `criteria`).

## Design Summary

WG-07 ([#8](https://github.com/ttdua/pi-jev-pilot/issues/8)) makes the package's first real decision: before each eligible main prompt, ask Jev how much reasoning the work needs and set Pi's thinking level for that turn (A1), using minimal recent context and request signals as state (E2). It is also the first end-to-end proof that the whole path works: Pi event, Jev request, pure policy, host effect, ledger line.

**Why now.** WG-02 to WG-06 built the seams, client, ledger, stores and status line without deciding anything. WG-08 (hold), WG-09 (skills), WG-10 (advice) and WG-18 (tuning) all build on this main-prompt path and on the ledger lines it writes.

**Goals**

- On an eligible main prompt with `effort` on, send one Jev request carrying `effort`, `risky` and `corrects`, with the minimal main state: `request`, `conversation.recent`, `conversation.recent_tools`, `conversation.turn_index`, `workspace.platforms` (`docs/jev-contract.md#main-state`).
- Turn the answers into a level with the documented rules: Jev's choice, raised to at least `high` when `risky > .7`, capped at `xhigh`, clamped to what the model supports, and a current `max` never lowered.
- Apply the level before the turn's first provider request.
- Discard the result when the operator changes the level while Jev is answering; the next prompt decides again.
- Write one `main` ledger line per decided turn, completed with the turn outcome, and a `correction` line for the previous turn when `corrects ≥ .7`.
- Show the decided level, or `no answer`, on the status line.
- Done when: the real CLI with a local Jev fixture sets the expected level on the first provider request; with Jev down nothing changes; Esc during classification starts nothing and leaves the level as it was.

**Non-goals**

- Effort hold (WG-08), skills (WG-09), strategy advice and the main `tier` question (WG-10), worker routing (WG-11), tally and log lines (WG-17), tuning (WG-18).
- The state fields that ship off until WG-16: `last_decision`, `context_used_percent`, `workspace.git`, `workspace.languages`, `capabilities`.
- Mid-turn effort changes (ADR 0007).

**Anti-goals**

- Any delay or behaviour change when Jev fails beyond the timeout: the turn must look as if the package were absent.
- Changing the main model, or starting at `max`, or lowering an operator's `max` (invariants 3 and 4).
- Prompt text, tool arguments or output in the ledger or in any session entry this package writes (invariant 7).
- A thinking-level change that survives a turn cancelled before its first provider request.

**Constraints**

- Public Pi APIs only. `policy/` pure, `jev/` free of Pi, only `host/` touches Pi.
- No new dependency, no ledger schema change.
- Tests use loopback fixtures only: no secrets, paid calls or outside network.

**What we found in Pi 1.5.0 that shapes this.** `before_agent_start` runs before the run exists, so `ctx.signal` is always undefined there. Esc during that time only marks the run for abort; Pi then aborts it at `agent_start`, before any provider request. So the host already guarantees "no provider request after Esc", but the package cannot see the Esc while it waits for Jev, and a level it sets afterwards would stay on the session. Setting the level later, at `agent_start`, is too late: the loop has already read the level.

## Alternatives Considered

### Alternative A: Decide and apply inside `before_agent_start`, repair after a cancelled start

- **Approach**: the handler builds the state, awaits Jev within the timeout, applies the level with `setThinkingLevel`, and remembers the level it replaced. If the run then settles as aborted with no provider request seen, the replaced level is put back.
- **Pros**: uses only documented seams; WG-02 Q6 verified that a level set here reaches the first request; the repair covers the one gap Pi leaves.
- **Cons**: on Esc the wait still lasts until Jev answers or times out (≤ 1.5 s); the repair writes a second thinking-level entry to the session.
- **Why chosen**: see Agreed Approach.

### Alternative B: Accept the gap and document it

- **Approach**: as A, without the repair.
- **Pros**: least code.
- **Cons**: a cancelled turn would leave a changed level behind, which breaks invariant 2 ("a cancelled turn starts nothing") in spirit and the Done-when test.
- **Why not chosen**: the operator chose the repair.

### Alternative C: Wait for Pi to expose a signal in `before_agent_start`

- **Approach**: block WG-07 until upstream adds it.
- **Pros**: the cleanest cancellation.
- **Cons**: blocks M1 on an outside project with no date.
- **Why not chosen**: the repair is small and can be removed once Pi provides a signal; an upstream issue asks for it.

## Agreed Approach

Alternative A, the operator's choice in the explore thread. One handler on `before_agent_start` decides and applies; turn-end events complete the ledger line; a settled-and-aborted run with no provider request restores the replaced level and writes no ledger line. An issue drafted for Pi asks for a signal in `before_agent_start`; it is posted only with the operator's go-ahead.

## Key Decisions

Decided by the operator in the explore thread:

1. **Esc:** restore the replaced level when the run settles aborted with no provider request; covered by a host test; draft an upstream issue for a `before_agent_start` signal.
2. **Discarded result:** a normal `main` line with `effortP` and `requested` and no `effective`; no schema change.
3. **`corrects`** is asked only while `effort` is on, so WG-07 has a single switch.
4. **Status line:** shows the decided level (`Jev · standard · high`) or `Jev · no answer`; nothing more.
5. **`turnId`** is kept as a session custom entry through `pi.appendEntry`, holding ids only, so a correction points at the previous turn on the current branch even after resume or `/tree`.

Proposed by the agent; correct these at the gate:

6. **Non-reasoning models** (or one supported level): `effort` and `risky` are not asked, but `corrects` still is, so correction lines keep coming. The request is then small.
7. **A current `max`** is left alone, but Jev is still asked, so the ledger keeps the distribution; `requested` records the policy's level and `effective` the unchanged `max`.
8. **Cancelled before any provider request:** no ledger line, matching the lifecycle in `docs/domain-model.md`. Esc after a provider request started is a normal turn with `outcome: aborted`.
9. **Jev miss:** level unchanged, a `main` line with `answered: false` and `miss`, and `Jev · no answer` on the status line until the next decision.
10. **No key, invalid config, child session, custom-message run, empty prompt, or `effort` off:** no request, no ledger line, no status change.
11. **Status line between turns** keeps the last decision until the next prompt; a session start shows the base line as today.
12. **Restore guard:** the replaced level is put back only if the current level still equals the one the package applied, so an operator change after the apply is never overwritten.
13. **The upstream issue** is drafted in the change and posted only after the operator approves the text.

## Open Questions

None that block the design. The exact split of turn-outcome counting (which events count tool calls, failures and tokens) is left to the builder within `docs/domain-model.md#ledger-entry`.

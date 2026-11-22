## Design Summary

Let Jev raise a worker's turn limit when the main model set one that is too tight for the brief, so the run is not stopped at the ceiling and its work lost (issue #102). This is a preventive guard: in the last two weeks no run was stopped at its limit, but a wrong cut is the costly failure mode, and `@ttdua/pi-subagents` v0.2.0 now accepts a raise-only `maxTurns` from a launch policy.

Behaviour:

- **When Jev is asked.** Only for a launch that has a turn limit (`requested.maxTurns` is set) and whose agent does not lock `max_turns`. About 99% of launches have no limit; they get no new question and behave exactly as today.
- **The question.** A new worker question, `turns`, asks for the expected workload as a choice over four bands: `short`, `medium`, `long`, `very_long`. Its wording is about the number of steps and tool calls the brief needs, held apart from `effort` (amount of care) and `tier` (knowledge).
- **Launches routing leaves untouched today.** A launch with a limit whose agent locks both `model` and `thinking`, or a fork with the setting `untouched`, now gets a request with `turns` only. This changes the specified requirement "Launches left untouched" (`worker-decision`), which today says such a launch sends no worker request. Model and thinking stay untouched for those launches.
- **The floor.** Each band maps to a turn floor taken from the ledger's `toolUses` distribution (p50 18, p90 56, p99 127): `short` none, `medium` 40, `long` 100, `very_long` 200. The floor is decided on the band probabilities, never on confidence.
- **The write.** Jev writes `maxTurns` equal to the floor only when the floor is greater than `requested.maxTurns`; it never lowers a limit and never adds one. The executor enforces raise-only too; Jev's own rule keeps the ledger honest and avoids debug-note noise from the executor.
- **The bound.** The highest band floor (200) is the ceiling. No ratio cap and no new config key.
- **Switch.** Part of the existing `subagents` switch (`/jev subagents off` turns it off with the rest of worker routing). No new switch.
- **Ledger.** The worker line gains the requested limit, the `turns` probabilities and the written floor. No prompt text.
- **Fail-open.** If Jev fails, times out, or leaves `turns` unanswered, no `maxTurns` is written and the launch keeps the caller's limit. Model and thinking routing behave as today. Resumes never reach the policy (unchanged). An executor without `requested.maxTurns` (older than v0.2.0) looks like an unlimited launch, so no turn question is asked.
- **Dependency.** Bump the `@ttdua/pi-subagents` pin and the README install line from `v0.1.1` to `v0.2.0`.

Goals: a launch whose limit is too tight for its brief gets a higher one; every other launch is unchanged.
Non-goals: lowering limits, adding a limit to an unlimited launch, tuning bands from live data (later), changing tier or effort decisions.
Anti-goals: a raise that silently costs a lot on most launches (the question is asked only for limited launches, which are about 1%); any change to a launch whose agent locks `max_turns`.

## Alternatives Considered

### Alternative A: Reuse the `effort` answer
- **Approach**: Map `effort` probabilities to a turn floor; no new question.
- **Pros**: No request change, no extra payload, no new wording to pin.
- **Cons**: `effort` measures care as well as amount of work, so a short but sensitive brief (`xhigh`) would get more turns it does not need; the ledger cannot separate the two signals for later tuning.
- **Why not chosen**: The signal is too coarse for a turn count, and the cost of a separate question is paid only by the few limited launches.

### Alternative B: Ratio cap (for example 2x the requested limit)
- **Approach**: Same band question, but cap the raise at a multiple of the requested limit.
- **Pros**: The cheapest bound on a wrong answer.
- **Cons**: For a truly long brief with a limit of 20 the raise stops at 40, so the guard does almost nothing where it matters.
- **Why not chosen**: It defeats the purpose; over-raising loses no work, under-raising does.

### Alternative C: Configurable ceiling (`subagents.maxTurnsCeiling`)
- **Approach**: Band table plus a config key, default 200, so the operator can lower the ceiling.
- **Pros**: Operator control over cost.
- **Cons**: A new config key with validation and docs for a guard that has not fired yet.
- **Why not chosen**: Not needed now; it can be added later if the ledger shows costly raises.

## Agreed Approach

A dedicated `turns` question over four workload bands, asked only for launches with a turn limit that the agent does not lock, including launches routing otherwise leaves untouched. The band probabilities decide a floor from a fixed table whose top value is the ceiling, and Jev writes `maxTurns` only when the floor raises the requested limit. Chosen over reusing `effort` because the turn count needs a workload signal held apart from care, and over a ratio cap or config ceiling because over-raising loses no work and the table already bounds the raise.

## Key Decisions

- Separate `turns` question with bands `short`, `medium`, `long`, `very_long` (user choice).
- Ask `turns` only when `requested.maxTurns` is set and `max_turns` is not locked (proposal accepted by the user).
- Launches untouched today but with a limit send a `turns`-only request; this alters the "Launches left untouched" requirement of `worker-decision` (proposal accepted by the user).
- Band floors: `short` none, `medium` 40, `long` 100, `very_long` 200; decided on probabilities, not confidence (proposal accepted by the user).
- No ceiling beyond the band table (user choice).
- No new switch; the `subagents` switch covers it (proposal accepted by the user).
- Ledger records the requested limit, the `turns` probabilities and the written floor (from the issue).
- No new readiness fact: an older executor sends no `requested.maxTurns`, which already means no turn question (my call).
- Bump the pi-subagents pin and README install line to `v0.2.0` (from the issue comment).

## Open Questions

- Exact `turns` wording and its version pin, left to the design and `docs/jev-questions.md`.
- How a `turns`-only request on an otherwise untouched launch shows in the ledger (`reason`, `answered`), left to the design, consistent with the existing worker line fields.

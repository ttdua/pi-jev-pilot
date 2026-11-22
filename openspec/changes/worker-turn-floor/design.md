## Context

The worker launch policy (`src/host/worker/policy.ts`) builds a `LaunchEntry` (`request.ts`), decides a `LaunchKind` before asking Jev (`policy/worker/route.ts` `launchKind`), asks `tier`, `effort` and `risky` (`jev/questions.ts`), routes with the pure `routeLaunch`, and returns a `RouteWrite` of `model` and `thinking` (`host/worker/route.ts`). The ledger line is built by the pure `workerLine` (`policy/worker/worker-line.ts`) and checked by `store/ledger-schema.ts`.

`@ttdua/pi-subagents` v0.2.0 adds `LaunchRequest.requested.maxTurns` (absent for an unlimited launch) and the raise-only `LaunchAdjustment.maxTurns`. `LaunchRequest.locked` already lists `max_turns` when the agent locks it. The executor drops a `maxTurns` that is not a raise, and treats a value that is not a positive integer as a malformed adjustment, so the whole adjustment fails open.

## Goals / Non-Goals

**Goals:**
- Keep the turn floor pure under `src/policy/worker/`, deciding on probabilities only.
- Ask `turns` only where a write is possible, so unlimited launches cost nothing.
- Keep every existing route result, write and ledger field the same for launches without a turn limit.

**Non-Goals:**
- Lowering a limit, adding a limit, or changing tier or effort rules.
- A config key, a switch, or a new readiness fact.
- A replay of the new wording (manual and approval-gated; it can follow from the ledger).

## Decisions

### D1. The launch facts carry the turn limit
`EffectiveLaunch` gains `maxTurns: number | undefined` (from `requested.maxTurns`) and `turnsLocked: boolean` (`locked` includes `max_turns`). `LaunchRequestFacts` gains a flat `requestedMaxTurns`, which the host fills from `requested.maxTurns`, in the style of `callerNamedModel`. A launch *can raise* when `maxTurns` is a number and `turnsLocked` is false. An older executor sends no `requested.maxTurns`, so no launch can raise; no readiness fact is needed.

### D2. `LaunchKind` separates the route questions from `turns`
Today `ask` always means `effort` and `risky`, plus `tier` when `tierQuestion`. The new shape:

- `untouched`: the route part is untouched *and* the launch cannot raise. No request.
- `ask` with `routeQuestions` (asks `effort`, `risky`, and `tier` when `tierQuestion`), `turnsQuestion`, and `locked`.

A launch the route part leaves untouched but that can raise becomes `ask` with `routeQuestions` false, `tierQuestion` false and `turnsQuestion` true: a `turns`-only request. The route for it writes no model or thinking and records reason `untouched` (or `miss` on a Jev miss). Chosen over a third kind because the host already branches on `ask`, and the flags keep the request builder and the route reading one value.

### D3. A separate pure turn floor
New `src/policy/worker/turns.ts`:

- `TURN_BANDS = ["short", "medium", "long", "very_long"]` and `BAND_FLOOR = { medium: 40, long: 100, very_long: 200 }` (`short` has none).
- `turnFloor(answer)`: from the highest band down, the first band whose cumulative probability (that band and every higher one) is at least .5 gives the floor; none when no band above `short` reaches .5, or `turns` is unanswered. This is the median band, so a thin tail does not raise. Sums are compared with a 1e-9 tolerance, so `.1 + .2 + .2` counts as reaching .5. Missing bands count as 0 and the probabilities are not normalised.
- `turnWrite(floor, launch)`: the floor when the launch can raise and the floor is greater than `launch.maxTurns`; otherwise nothing.

`routeLaunch` calls it after the model and thinking decision and merges `maxTurns` into the `routed` write and `turnFloor` into the record. It does not touch the tier or effort paths, so their existing tests stay as they are. Chosen over reusing `effort` (brainstorm) and over folding the floor into `tier.ts`, which is about knowledge.

### D4. Wording and option order
The `turns` wording lives in `src/jev/rubrics.ts` and `docs/jev-questions.md`, with band text aligned to the floors: `short` up to about 20 steps, `medium` about 20 to 40, `long` about 40 to 100, `very_long` more than about 100, and a sentence that knowledge and care are not turn signals. Options are sent in ladder order. Jev leans toward the first option, which here pushes toward `short`, the side that raises less; that bias costs a missed raise, never money. No rubric version is added: `RUBRIC_VERSION` pins the `tier` wording only, and a snapshot test pins the `turns` wording against the docs.

### D5. Adjustment and fail-open
`RouteWrite` gains `maxTurns?: number`. `routeLaunchEntry` copies it from the route write; `decideLaunch` already returns the write when it has any key. A miss, cancel or unanswered `turns` leaves `maxTurns` out. The written value is always a positive integer from `BAND_FLOOR`, so it never makes the executor reject the whole adjustment.

### D6. Ledger fields
The worker line gains, in this order after `locked`:
- `requestedTurns`: `launch.maxTurns`, whenever `turns` was asked.
- `turnsP`: the `turns` probabilities, keyed by band, when answered.
- `turnFloor`: the `maxTurns` written, only when written.

The schema adds them as optional (`count()` for the two numbers, a record over the four bands for `turnsP`); `v` stays 1, since the fields are additive and old lines stay valid. A turns-only line has `reason` `untouched` and `answered` from the request, like a thinking-only line. The session tally is unchanged.

### D7. Dependency bump
`devDependencies["@ttdua/pi-subagents"]` becomes `github:ttdua/pi-subagents#v0.2.0` and `bun.lock` is refreshed; the install lines in `README.md` and `docs/usage-guide.md` follow, as `release-metadata` requires. The type import of `LaunchRequest` then carries `requested.maxTurns`.

## Risks / Trade-offs

- [Jev rates too high and raises the limit to 200] → Over-raising loses no work. The floor needs a median band, the top floor is the ceiling, and the ledger records `turnsP` and `turnFloor` so a later change can tune bands.
- [A turns-only request adds latency to a launch that was untouched before] → These launches are rare (locked model and thinking, or fork `untouched`, and also limited). The request shares the launch's classifier deadline.
- [Turns-only launches now count as asked decisions in the timeout tuning window (`tuning-rules`)] → Consistent with that rule; they are rare, so the window shifts little.
- [The executor sets a default turn limit (`defaultMaxTurns`)] → Every launch then counts as limited and asks `turns`: one more question per request, and one extra call only on turns-only launches. Accepted; the ledger's `requestedTurns` shows it.
- [First-option bias toward `short`] → It causes a missed raise at worst; noted for a later replay.
- [The executor changes the raise-only rules] → The pin is an exact tag; Jev's own rule matches v0.2.0.

## Migration Plan

Additive. Bump the pin, ship. Rollback: `/jev subagents off` turns worker routing off, including the turn floor; reverting the change leaves old ledger lines valid.

## Open Questions

None blocking. Band tuning from the ledger is later work.

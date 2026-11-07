## Context

WG-11 built the worker route over four tiers: `decideTier` (pure rules), `chooseFallback` (walk down, never `expert`), `routeLaunch` (effort, clamp, record) in `src/policy/`, and `src/host/worker.ts`, which checks tier models against `ctx.modelRegistry`, writes the input, warns once per tier and model, and writes the ledger line. WG-12 threaded the mode through. Every value the policy handles is a `TierName`. `crew.slots` is validated and written by `src/store/config.ts`, and the ledger already accepts `slot::<name>` targets and the `slot` reason. The `/jev` parser in `src/host/commands.ts` splits on whitespace and maps unknown words to usage.

Constraints: `policy/` stays pure; only `host/` touches Pi. No new dependency. A command never calls Jev or the network. A request with no slot must be unchanged byte for byte, so existing tests and the replay baseline still hold.

## Goals / Non-Goals

**Goals:**
- Widen the policy from tiers to targets without forking the route: one decision, one fallback, one effort path.
- Keep slot names and models in host code; the policy sees only names.
- Put the slot command in its own module, so `commands.ts` only dispatches.

**Non-Goals:**
- Slots in the main request's `tier` question.
- Listing slots in the `/jev` status report (the slot forms report slots).
- Changing the .6 bar, the tier wording or any mode rule.

## Decisions

**D1. A `Target` type in the policy.** `src/policy/launch.ts` gains `type SlotTarget = \`slot::${string}\``, `type Target = TierName | SlotTarget`, and `isSlot(t)`. `TierDecision.tier`, the route's `record.tier` and `record.fallback`, and the `canRun`, `thinkingOf` and `modelOf` callbacks take `Target`. The tier ladder stays `TierName[]`. Alternative: a parallel slot route. Rejected: it would repeat locks, effort, clamping and the record shape.

**D2. Offered slots are passed as names.** `RouteInput` and `decideTier` gain `slots: readonly string[]` (configured slot names in config order). The policy builds `slot::<name>` keys itself. Models stay in host callbacks, like tiers.

**D3. Rule `slot` in `decideTier`.** After `risky`, when `tier.choice` is an offered `slot::<name>` with probability ≥ .6, decide it with reason `slot`. Otherwise, when the choice is a slot, replace the choice with the offered tier of highest probability. A tie goes to the cheaper tier (ladder order), the same lean as `fast-unsure`. The later rules then read that tier as `tier.choice`. With no tier offered, nothing is decided, and the launch is routed thinking-only. A slot with no probability counts as 0. Rule 1 still reads the raw answers, so a slot choice never passes a standard expert gate. The premium gate reads `tier.choice` `deep` or `expert` raw, and a slot choice fails it too.

**D4. Fallback from a slot.** `chooseFallback` keeps a runnable offered slot. Otherwise it walks the ladder from `balanced` down (`balanced`, `fast`), skipping tiers that are not offered or cannot run. It never goes to `deep` or `expert`. `moved` names the slot as `from`. The existing effort rule then applies unchanged: `xhigh` after a move. Without a move there is no `fast` cap on a slot, since the cap is keyed on final tier `fast`.

**D5. Untouched and thinking-only with slots.** In `launchKind`, "no tier" becomes "no tier and no slot". This applies both to the untouched case (d) and to whether the `tier` question is asked. A slot-only config therefore still asks `tier`.

**D6. Question building.** `buildWorkerQuestions` takes `slots: {name, model display name, when}[]`. It appends `slot::<name>` criteria after the tiers, as `<display name> (a custom model). <when>`, and adds the same keys to the spec options. The slot criterion is the same in every mode. When the registry has no display name, the configured `provider/id` is used, because the criterion always names the model. The slot prefix is structural, unlike the optional tier prefix.

**D7. Host checks share one helper.** A new `src/host/models.ts` holds `splitModel`, `checkModel(registry, id)` (moved from `worker.ts`'s `checkTier`) and `nearestModels(registry, id, 3)`. `worker.ts` resolves a target's model from `settings.tiers` or `settings.crew.slots`. Warnings are keyed by target and model. `src/host/setup.ts` already calls `clearWarnings()` before every `/jev` form, so the slot forms clear them too, with no new code. A slot warning reads `Jev: slot <name> (<model>) cannot run (<why>); using <tier>|launch left unchanged. Fix crew.slots "<name>" model in <config path>.`

**D8. Nearest names.** `nearestModels` ranks `getAvailable()` ids (models with credentials) by Levenshtein distance to the typed id, ignoring case, and breaks ties alphabetically. It returns the first three and makes no network call. The distance function lives in `src/shared/text.ts` (pure, tested). Alternative: reuse the substring filter of `review-cli.ts`. Rejected: it finds nothing for a typo such as `9routr/gpt-6.1-sol`.

**D9. Slot command module.** A new `src/host/slots.ts` exports `parseSlotArgs(text)` and `runSlot(parsed, ctx, dir)`. `parseJevArgs` delegates to it when the first word is `remove`, or matches the slot-name pattern and is not reserved. Since every feature and command word is reserved, the existing forms keep precedence. Parsing works on the raw text: `<name> <model> when <text>` keeps `<text>` verbatim after trimming. Any other third word, or `when` with nothing after it, is usage. Results:
- **Add:** after the invalid-config refusal, checks run in a fixed order: the model's `provider/id` shape, then the `when` requirement for a new slot (refused with a hint), then `checkModel` against the registry (refused with the reason and up to three suggestions). A shape error comes first, so `/jev colors off` reads as a mistyped command, not as a slot that is missing `when`.
- **Replace:** the slot stays at its position, and `when` is kept unless given.
- **Remove or show of an unknown slot:** refused, naming the slot.
- **Write:** through `writeSlots`. Its problems, including an invalid file and the eight-slot limit, are reported as errors and nothing changes.
- **Report:** a success reports the slot (`slot <name>: <model>`, then its `when`). Show reports the same line without writing. Slot forms report only this message, not the full status, since the status line does not show slots.

**D10. `when` required in config.** In `slotsValidator`, `when` moves from optional to required, with the same bounds. The default `when` text is removed from docs. It never existed in code.

**D11. Ledger untouched.** `tierP` already allows 12 keys (4 tiers + 8 slots), and `tier`/`fallback` already accept `slot::<name>`. No schema change is needed.

## Risks / Trade-offs

- [Jev returns a probability map that omits some slot key] → missing counts as 0. Below-bar and highest-tier selection read only offered tier keys.
- [A slot's display name is long or unhelpful] → the operator's `when` carries the meaning. Display names come from the registry, as they do for tiers.
- [Operator puts a slot alone with no tier and the slot cannot run] → nothing can run. The input is unchanged, and the warning says the launch is left unchanged.
- [Widening `TierName` to `Target` touches many call sites] → the type checker finds each one. Policy tests cover every rule with and without slots.
- [`/jev <word>` for a mistyped feature now reports "no slot named …" instead of usage] → the refusal also prints the usage text, so the operator still sees the valid forms.

## Migration Plan

No released config exists. The change ships in one branch, and `when` becomes required at the same time as the commands. Rollback is a revert.

## Open Questions

None.

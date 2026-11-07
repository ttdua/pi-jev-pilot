## Design Summary

WG-13 (issue #14, roadmap F1 and H3) makes custom model slots work end to end. An operator adds a named model with a `when` description, Jev sees it as one more option of the worker `tier` question, and a launch whose brief matches goes to that model. Review routing is a slot named `reviewer` ([ADR 0004](../../../docs/decisions/0004-review-as-a-slot.md)); there is no review-specific mechanism.

**Why now:** M2 ("workers route by mode, with the reviewer slot") is complete only after WG-13. WG-11 (routing core) and WG-12 (modes) have merged, and WG-16 (replay) waits on this.

**What already exists:** `crew.slots` validation (count, name pattern, reserved names, uniqueness), the slot writer that replaces only `crew.slots`, the ledger accepting `slot::<name>` targets and the `slot` reason, and the slot criterion wording in `docs/jev-questions.md`.

**What this change adds:**

- **Offer:** every configured slot joins the worker `tier` question as `slot::<name>` in every mode, after the tiers, with the criterion `<model display name> (a custom model). <when>`. A slot alone, with no tier, still makes the question asked.
- **`when` is required:** every slot needs its own `when`; the unmeasured default ("read-only bulk work") is removed. Routing quality depends on this text, and the default was the only slot wording with no replay evidence while overlapping the `fast` criterion. `config.json` rejects a slot without `when`, and adding a new slot through `/jev` without `when` is refused with a hint on how to write one (what to choose it for, and what not).
- **Decide:** decision rule 3. After the expert gate and the risk floor, a slot chosen with probability ≥ .6 wins. Below .6 the slot is dropped and the decision continues with the non-slot option of highest probability, through the expert-denied, unsure-fast and choice rules as before.
- **Fallback:** a slot that cannot run moves to `balanced`, then down to `fast`. It never moves up to `deep` and never to `expert`. If nothing can run, the launch stays unchanged. The ledger records `fallback` as the slot target.
- **Warn:** an unusable slot warns once per slot and model per session (cleared by `/jev`), naming the slot, its model, why it cannot run, what ran instead, and the setting to fix by slot name, `crew.slots "reviewer" model`, with the path of `config.json`.
- **Commands:** `/jev <slot> <provider/model> [when <text>]` adds or replaces a slot, `/jev <slot>` shows it, `/jev remove <slot>` deletes it. A new model must exist in Pi's registry with credentials; otherwise the command is refused and suggests the three closest names among models that have credentials, without a network call. Adding a new slot requires `when`; replacing an existing slot's model without `when` keeps its existing `when`. The usage text gains these three forms.

**Done when (from the issue):** the reviewer slot routes in a host test, an unusable slot falls back to `balanced`, and `expert` is never a fallback target.

**Goals:** one mechanism for any custom model; behavior and wording exactly as the docs specify; fail open on every path.

**Docs changed with it:** `docs/configuration.md` (`when` becomes required), `docs/jev-questions.md` (default `when` removed), `docs/usage-guide.md` (slot section and command forms). This is a config file format change, approved by the operator; the package is unreleased (0.1 is WG-19), so no migration is needed.

**Non-goals:** no review-specific routing; no change to tier wording, thresholds or modes; no slot in the main-session `tier` question; no calibration of the .6 bar (it stays code plus evidence); no replay run in this change.

**Anti-goals:** a slot command that silently loses the operator's `when`; fallback that raises cost (to `deep` or `expert`); any network lookup from a command.

## Alternatives Considered

### Alternative A: Dedicated review setting matching agent names
- **Approach**: a `review` setting that routes agents with review-like names to one model.
- **Pros**: no reliance on Jev for review detection.
- **Cons**: misses review work done by generic agents; a second mechanism beside slots.
- **Why not chosen**: rejected by ADR 0004; replay showed the slot caught 18 of 18 review briefs even with every agent renamed.

### Alternative B: Slots as a separate Jev question
- **Approach**: ask a second choice question "which slot, or none" beside `tier`.
- **Pros**: keeps the tier question and its distribution untouched.
- **Cons**: one more question per launch; differs from the measured setup; needs its own bar and a rule for when both answers disagree.
- **Why not chosen**: the replay evidence and docs measure slots inside the `tier` question; a separate question would need a new replay.

### Alternative C: Slots inside the `tier` question (chosen)
- **Approach**: `slot::<name>` options in the same choice, rule 3 in the existing decision order, fallback reusing the tier cascade from `balanced`.
- **Pros**: matches docs and the replay; one question; reuses the existing decision, fallback, warning and ledger paths.
- **Cons**: the decision target is no longer only a tier, so policy types widen.
- **Why not chosen**: n/a.

## Agreed Approach

Alternative C, as specified by the docs and confirmed by the operator. It is the measured design and reuses the WG-11 routing path instead of adding a parallel one.

## Key Decisions

Settled with the operator in the Inbox thread `wg-13-slots`:

1. **Slot below .6:** continue with the non-slot option of highest probability, then rules 4–6 as usual.
2. **Slot fallback:** `balanced`, then `fast`; never up, never `expert`; unchanged if nothing can run.
3. **Replace without `when`:** keep the existing `when`.
4. **`when` required:** every slot must have a `when`; the default `when` is removed from docs and code; a new slot added without `when` is refused. Chosen after the operator asked whether free-text `when` is fragile: the code path is robust, routing quality depends on the wording, and the default was the one unmeasured part.
5. **Setting named in the warning:** by slot name, `crew.slots "reviewer" model`, not by index.
6. **Nearest-name hints:** only models with configured credentials, three at most.
7. **Sequencing:** WG-13 starts after WG-12 merged; this branch is rebased on it.

## Open Questions

None.

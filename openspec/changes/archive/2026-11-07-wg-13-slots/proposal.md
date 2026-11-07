## Why

Slots are validated in `config.json` and accepted by the ledger, but nothing offers them to Jev, decides on them, or lets the operator manage them: a configured `reviewer` slot is ignored and every review worker stays on a tier. M2 ("workers route by mode, with the reviewer slot") needs WG-13. Features F1 (custom model slots checked against Pi's registry) and H3 (pre-launch fallback, slot part) are selected in the project brief, and the measured replay shows the reviewer slot separates review briefs cleanly.

## What Changes

**Slot options in the worker request**
- From: the `tier` question offers configured tiers only.
- To: every configured slot is also offered, as `slot::<name>` after the tiers, in every mode, with the criterion `<model display name> (a custom model). <when>`. Slots alone make the `tier` question asked.
- Impact: non-breaking; a request with no slot configured is unchanged byte for byte.

**Slot decision rule**
- From: five rules (`expert-admitted`, `risky`, `expert-denied`, `fast-unsure`, `choice`).
- To: rule `slot` between `risky` and `expert-denied`: a slot chosen at probability ≥ .6 wins. Below .6 the decision continues with the non-slot option of highest probability.
- Reason: decision order in `docs/domain-model.md`.

**Slot fallback and warning**
- From: only tiers cascade.
- To: an unusable slot moves to `balanced`, then `fast`; never up, never `expert`; unchanged if nothing can run. One warning per slot and model per session names the setting by slot name, `crew.slots "<name>" model`.

**`when` is required**
- From: `when` is optional, with an unmeasured default.
- To: every slot needs a `when` of 1–500 characters; the default is removed.
- Reason: routing depends on this text and the default has no evidence; approved by the operator.
- Impact: config format change in an unreleased package; a slot without `when` now makes `config.json` invalid.

**Slot commands**
- From: `/jev <slot> …` prints the usage text.
- To: `/jev <slot> <provider/model> [when <text>]` adds or replaces, `/jev <slot>` shows, `/jev remove <slot>` deletes. A model must be in Pi's registry with credentials, else the three closest names among models with credentials are suggested. A new slot needs `when`; replacing keeps the old one when omitted.
- Impact: new public command forms, approved by the operator in the roadmap and the brainstorm.

## Capabilities

### New Capabilities
- `slot-commands`: the three `/jev` slot forms, their parsing, the registry check with nearest-name hints, and what each reports.

### Modified Capabilities
- `worker-request`: offered options include slots; slot criterion wording.
- `worker-decision`: rule `slot`; slot targets in the route, effort and fallback; untouched and thinking-only cases count slots as offered.
- `worker-routing`: slot models are checked before writing; slot fallback warning.
- `worker-ledger`: a slot decision and a slot fallback on the line.
- `config-file`: `when` is required for every slot.
- `jev-command`: usage text lists the slot forms; slot names no longer fall to usage.

## Impact

- **Code:** `src/policy/launch.ts`, `src/policy/tier.ts`, `src/policy/route.ts`, `src/policy/effort.ts` (target type only), `src/jev/questions.ts`, `src/jev/rubrics.ts`, `src/host/worker.ts`, `src/host/commands.ts`, new `src/host/slots.ts` (slot forms) and `src/host/models.ts` (model check and nearest names, shared with routing), `src/store/config.ts`, `src/shared/text.ts` (edit distance).
- **Tests:** `tests/policy/{tier,route}.test.ts`, `tests/jev/questions.test.ts`, `tests/host/{worker,worker-routing,worker-ledger,commands}.test.ts`, new `tests/host/slots.test.ts` and `tests/host/models.test.ts`, `tests/shared/text.test.ts`, `tests/store/config-{read,write}.test.ts`, `tests/host/fixture.ts`.
- **Docs updated:** `docs/configuration.md`, `docs/jev-questions.md`, `docs/usage-guide.md`, `docs/domain-model.md`, `docs/architecture.md`, `docs/jev-contract.md`, `docs/roadmap.md`.
- **No** new dependency, schema version, ledger change or migration.

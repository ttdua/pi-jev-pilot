## Design Summary

**Intent.** Let the operator shift where worker launches are routed, toward cheaper or stronger models, with one command: `/jev mode budget|standard|premium`. This is roadmap WG-12 (selected features "Modes" and H1 `expert` tier), issue #13. The design is already measured and recorded in ADR 0003, `docs/domain-model.md`, `docs/jev-questions.md` and the 2026-11-05 replay evidence; this change implements it.

**What exists today.** `state.json` already stores `mode`, settings resolve it (default `standard`), the status line shows it, every ledger line records it, and `/jev reset` clears it. But nothing can set it, the worker `tier` question always uses the `standard` rubric, and the rule that admits the `expert` tier is fixed at "`tier` is `expert` and `expert_needed > .9`". So every ledger line says `standard`.

**What this change adds.**

- `/jev mode <budget|standard|premium>` writes the mode to `state.json`, then reports the status and refreshes the status line, like the other `/jev` forms. It never calls Jev. The next worker launch uses the new mode; running workers are unaffected.
- Each mode selects one tier rubric, kept as data, with the wording already in `docs/jev-questions.md`. Nothing else changes between modes: not the other questions, not the slot or `fast` thresholds, not the main session (the main request keeps the `standard` rubric).
- Each mode selects one **expert gate**, the condition for using the `expert` tier:
  - `budget`, `standard`: `tier` is `expert` and `expert_needed > .9` (today's rule).
  - `premium`: `tier` is `deep` or `expert`, `P(expert) ≥ .1`, and `effort` is `xhigh` or `max`.
- In `premium`, `expert_needed` is asked with its softer wording, and logged for calibration only; it is not part of the `premium` gate.
- **Rename "Fable rule" to "expert gate"** everywhere (docs, specs, code, tests), and the ledger `reason` value `fable` to `expert-admitted`, paired with the existing `expert-denied`. A tier is a role, not a model: if `tiers.expert` later points at another vendor's model, the name must still be true. Model names stay only where they are real measurements or config examples (evidence tables, the usage-guide distribution, `claude-fable-5-1` in a sample config).

**Goals.** Table tests of the decision order per mode; a mode change takes effect on the next launch; the ledger keeps tuning signals separable by mode.

**Non-goals.** Upstream's `junior-lead`, `second-opinion` and `quality` modes. Any per-mode change to effort, slots, fallback or the main session. Auto-tuning the gates (they are never tuned automatically). Measuring whether a mode produces better work.

**Anti-goals.** A mode that silently changes thresholds instead of rubrics (rejected in ADR 0003: workers barely moved, and low bars pushed scouting to the strongest model). Any new config field.

**Done when.** The decision order has a table test per mode. The second half of the roadmap's done-when, a replay of real briefs reproducing the recorded per-mode distribution within noise, is a final **manual** task: it needs the operator's approval of data and cost at the time, and it runs outside this repository (briefs and scripts are not committed). The change is complete in code without it; the roadmap row moves to Done only after it.

## Alternatives Considered

### Alternative A: Thresholds per mode on one rubric
- **Approach**: Keep the `standard` rubric; shift `fast` and `expert` probability bars by mode.
- **Pros**: One wording to maintain; no replay needed for text changes.
- **Cons**: Measured to barely move workers, since Jev is often already sure of `balanced`; low bars produced nonsense routes.
- **Why not chosen**: Rejected by ADR 0003 on replay evidence.

### Alternative B: Mode as one bundled object (rubric text plus gate)
- **Approach**: A single `Mode` value carrying its rubric strings and its gate function, passed through host, request building and decision.
- **Pros**: One place to read a mode.
- **Cons**: Rubric text belongs to the Jev layer and the gate to the pure policy layer; bundling them makes one layer import the other, against the dependency rules.
- **Why not chosen**: Breaks the architecture's dependency boundaries for no behavioural gain.

### Alternative C: Keep the "fable" name
- **Approach**: Implement the modes and leave `fable` as the rule and ledger reason name.
- **Pros**: Smaller diff.
- **Cons**: Ties a role to one vendor's model; the ledger would mislabel decisions once the expert model changes.
- **Why not chosen**: The operator asked for a model-neutral name; nothing is released yet, so renaming now costs no migration.

## Agreed Approach

Implement the documented design: rubrics and gates as per-mode data, selected by the mode name that the request builder and the tier decision each receive, keeping rubric text in the Jev layer and the gate in the policy layer (not Alternative B). Add `/jev mode`. Rename the rule and the ledger reason to the model-neutral names in the same change, because this change rewrites that rule anyway.

## Key Decisions

- `/jev mode <m>` is approved as a new public command; it changes the mode, then reports the status. `/jev` alone already shows the mode, so there is no separate read form. (Operator, 2026-11-07.)
- Replay is a final manual task awaiting the operator's approval; no replay script is added to the repository. (Operator.)
- Ledger reason `expert-admitted` replaces `fable`; the concept is called the "expert gate". (Operator.)
- No compatibility alias for `fable`: no ledger written by this package exists outside test runs (the installed earlier port writes a different file with a different schema). (Agent's call, explained to the operator.)
- `/jev mode` with a missing or unknown mode name prints the usage text and changes nothing, like every other unknown `/jev` input. (Agent's call.)
- The `premium` gate can admit `expert` only when `expert` is offered (configured and its switch on); otherwise the decision falls through to the next rule. (From the documented decision order.)

## Open Questions

None blocking. The replay result may show a distribution outside noise; if so, that is a rubric-wording finding for a later change, not a reason to change this one.

## Context

`docs/architecture.md` already places this work: `policy/skill.ts` holds the pick, `jev/questions.ts` and `jev/rubrics.ts` build the request, `host/` touches Pi. Lint enforces those boundaries (`.oxlintrc.json`). `readAnswers` (`src/policy/answers.ts`) validates each answer against a `QuestionSpec`; `mainQuestions({ askEffort })` (`src/jev/questions.ts`) builds the main request's `effort`, `risky` and `corrects`; `cutCodePoints` (`src/shared/text.ts`) cuts by code point. The ledger schema already accepts `skill`, `skillP` and `gate`.

Upstream jev-pilot 0.12.1 (`hooks/skill-suggestion.policy.ts`, MIT, attributed in `NOTICE.md`) is the measured reference: `MAX_CHOICES = 255`, `batchesOf`, `pickSkill`, gate questions without criteria, and an injection block that names an already-loaded skill instead of repeating it.

Pi 1.5.0 renders an explicit `/skill:name` as `<skill name="…" location="…">\nReferences are relative to <baseDir>.\n\n<body>\n</skill>` (`agent-session.js`, `_expandSkillCommand`), with the body read through `stripFrontmatter` and trimmed.

## Goals / Non-Goals

**Goals:**
- Criteria, batching, questions, pick, delivery texts and duplicate choice as Pi-free, table-tested functions.
- Wire text that matches `docs/jev-questions.md` verbatim, checked by test as the existing questions are.

**Non-Goals:**
- Reading `pi.getCommands()`, skill files, frontmatter or fingerprints; reading the branch or compactions; detecting an explicit `/skill:name`; returning the hidden message; eligibility; ledger lines (all `wg-09-skill-host`).
- Whether `corrects` is asked when only skills are asked (host change).
- A second rerank request (C4, not selected).

## Decisions

**Policy receives plain entries.** `policy/skill.ts` takes `{ name, description?, body? }` with the body already stripped of frontmatter by the host (Pi's `stripFrontmatter`). The policy never reads files or computes hashes, so it stays pure. Alternative: parse frontmatter in policy; rejected because a second parser could disagree with Pi.

**Criterion.** `<description> — <body cut>` where the description is trimmed and the body is trimmed then cut to 300 code points with `cutCodePoints`. Only one present: that one alone. Neither: `A skill named <name>.`. The text is otherwise passed as written; no whitespace folding, so what Jev reads is what the skill says.

**Batching follows upstream.** At most 254 skills per batch plus `(none)`, since TypeSafe refuses more than 255 options. `count = ceil(n / 254)`, `size = ceil(n / count)`, slices in catalog order. An empty catalog gives no batch. Names are expected unique; the batcher keeps the first entry of a repeated name and drops an entry named `(none)`, so options stay unique keys.

**Question builder.** `mainQuestions` gains an optional `skills` input, the first batch's options. When given, it appends `which` (options in catalog order, then `(none)`) and the three gates, after `effort`, `risky` and `corrects`. A separate `skillBatchQuestions(batch)` builds a later batch's request: `which` only. Both return `wire` and `specs` from one option list, as the worker builder does, so asked and accepted options cannot drift. Without `skills`, output is byte-identical to today, so `wg-07` behaviour is unchanged.

**Gates carry no criteria.** Each gate is `{ type: "noul", instructions }`, as upstream sends it and as the .3 threshold was measured. A new `BareNoulQuestion` type sits beside `WireQuestion`. Only the overload of `mainQuestions` that takes skills returns the wider `SkillQuestions` type; the overload without skills keeps `MainQuestions`, so existing callers and tests typecheck unchanged. An empty `skills` list counts as not asked. `readAnswers` needs no change: a noul spec does not depend on criteria. The `main-effort` wire format requirement and the docs' wire format paragraph gain the exception.

**Leader of a batch follows upstream.** A batch's leader is its highest-probability option, `(none)` included; a batch led by `(none)` is ignored and offers nothing. Ties go to the earlier option, and `(none)` is listed last. Across batches the highest leader wins; ties go to the earlier batch. Probabilities are used, never `confidence` or `choice` (ADR 0002). This is upstream's measured rule (with `(none)` offered, one request agreed with the two-request pick on 14 of 16 prompts). The contract's "take the leader of each batch, ignoring `(none)`" reads either way; this change rewords it to say a batch led by `(none)` is ignored. Alternative: the best non-`(none)` option of each batch, which I proposed in the first brainstorm message; rejected because it overrides a confident `(none)` (a batch at `debug` .3, `(none)` .7 would still offer `debug`) and was not measured.

**Gate mean.** The mean of the gate answers that were read from the first batch, with `prose_suffices` as `1 - p`. With no gate read, the mean is absent and only the .5 rule applies (operator, 2026-11-07).

**Pick result carries what the ledger needs.** `pickSkill` returns the picked name or none, plus the best leader's probability and the gate mean when known, so the host can write `skill`, `skillP` and `gate` without recomputing. Any batch whose `which` is unanswered, or a batch missing, gives no pick and a `failed` reason.

**Delivery texts mirror Pi's own block.** The `content` form wraps Pi's `/skill:name` block in a `<skill_relevance>` envelope with a line telling the model to ignore it when it does not fit. The `suggest` form names the skill, its path and base directory, and leaves reading to the model. The reference form names the skill as already loaded. Paths and the body are inserted verbatim (no pattern replacement, so `$&` in a path is safe). The exact text goes into `docs/jev-questions.md` under "Text added to the model's context" and is checked by test. The gate question text sent is the docs cell without its trailing "Inverted when averaged." note, which matches upstream's text.

**Duplicate choice is a pure lookup.** `deliveryForm({ name, fingerprint, inject, loaded })` returns `reference` when `loaded` holds the same name with the same fingerprint, otherwise `content` or `suggest` as configured. `loaded` is what the host found in context since the latest compaction: bodies this package delivered and bodies of explicit `/skill:name`. A suggestion carries no body, so it never makes a later pick a reference. The fingerprint is an opaque string to the policy.

## Risks / Trade-offs

- [Gate without criteria departs from the project's wire rule] → Recorded as an exception in the docs and the `main-effort` spec; matches the measured upstream form.
- [Leader rule differs from what I wrote in the first brainstorm message, and the contract's wording was ambiguous] → Follows upstream; the contract is reworded in this change and the choice is called out in the final gate summary.
- [Content form depends on Pi's block format staying the same] → The text lives in docs and rubrics; a Pi change only affects how alike the two look, not correctness. The host test pins it at Pi 1.5.0.
- [Probabilities from different batches are compared directly] → Each batch is its own distribution; upstream accepts this for the single-request pick. Catalogs above 254 skills are rare.

## Migration Plan

None. Nothing calls the new code until `wg-09-skill-host`; existing main requests are unchanged.

## Open Questions

- None for this change.

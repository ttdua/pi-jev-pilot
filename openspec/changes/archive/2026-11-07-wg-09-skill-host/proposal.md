## Why

`wg-09-skill-policy` (#33) shipped the skill pick rules and the delivery texts, but nothing calls them yet, so no prompt ever gets a skill. This change wires them into the main prompt flow (C1, C2, C5) and closes WG-09 (#10). Done when a host test proves that, across repeated picks, the session holds the body once and each provider request carries it once, and that the `(none)` and gate paths attach nothing.

## What Changes

- **Catalog.** Read on each eligible prompt from `pi.getCommands()` (`source: "skill"`) through `sourceInfo.path`. Leave out skills marked `disable-model-invocation: true`, unreadable files, and names the ledger cannot record.
- **Skill questions** ride on the main request as the first batch. Later batches go out in parallel, with the same state.
- **Explicit `/skill:name`.** Detected from the leading `<skill name="…" location="…">` block of the expanded prompt; it skips only the skill questions.
- **Delivery.** A picked skill is returned from `before_agent_start` as one hidden message (`display: false`) in the `content`, `suggest` or `reference` form. The `reference` form is used when the same name and body fingerprint are still in the model's context (after compaction and context edits), from an earlier delivered body or an explicit `/skill:name`.
- **Failure.** A Jev miss, an unreadable answer or any failed batch attaches no skill. Effort still applies when the first batch answered.
- **Ledger.** The `main` line records `skill`, `skillP` and `gate`.

**Eligible main prompts**
- From: a request is sent only when `effort` is on.
- To: a request is sent when `effort` is on, or when skills apply (`skills` on, a non-empty catalog, no explicit `/skill:name`). `corrects` is asked on every main request.
- Reason: a prompt can get a skill with effort off; a request with nothing to ask about skills costs a call for `corrects` alone.
- Impact: non-breaking. With the default switches, behaviour only adds skill questions.

**Main line fields**
- From: `skill`, `skillP` and `gate` MUST be absent.
- To: they are written when known.
- Reason: the ledger records the pick for tuning and audit.
- Impact: the schema already accepts them; nothing reading the ledger breaks.

## Capabilities

### New Capabilities

- `skill-delivery`: the host side of skill pick. It covers the catalog read, when skill questions are asked, the explicit `/skill:name` skip, batch requests, the hidden message and its form, the in-context duplicate check, and Jev failure.

### Modified Capabilities

- `main-effort`: eligibility now includes "skills apply"; the main questions add the skill questions defined by `skill-pick` and `skill-delivery`.
- `main-ledger`: the `main` line carries `skill`, `skillP` and `gate` when known; skill-only turns write a line.
- `skill-pick`: the skill questions requirement points to `skill-delivery` for which requests carry them.

## Impact

- **Code**: new `src/host/skills.ts` (catalog, explicit-skill detection, loaded-in-context scan, fingerprint). `src/host/main.ts` gains eligibility, the batch requests, the pick, the hidden message and the ledger fields. `src/host/setup.ts` passes the catalog reader. `src/policy/skill.ts` and `src/jev/questions.ts` are used as they are.
- **Tests**: unit tests for `host/skills.ts` and the main flow with fakes, and a host test through the real CLI with a loopback Jev and provider: exactly once, reference after a repeat, re-sent after a compaction, `(none)`, gate too low, explicit `/skill:name`, Jev failure.
- **Dependencies**: none added. `parseFrontmatter` and `stripFrontmatter` are public exports of `@earendil-works/pi-coding-agent`; the fingerprint uses `node:crypto`.
- **Schema**: ledger schema unchanged. Config unchanged (`skills.inject` exists).
- **Related**: WG-10 (#31) returns advice from the same hook, which carries only one hidden message. Whichever of the two merges second combines both texts into that message.
- **docs/ updated**: `docs/jev-contract.md` (eligibility and catalog rules, hidden message, failed batch), `docs/workflow.md` (main prompt flow and compaction: skill delivery), `docs/architecture.md` (host seams: `buildSessionProjection`, frontmatter helpers), `docs/privacy.md` (what the hidden skill message stores), `docs/roadmap.md` (WG-09 status).

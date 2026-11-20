## Design Summary

Remove the CLI review feature entirely, and stop holding the thinking level on any provider by default.

**Why.** The operator no longer wants jev-pilot to run Codex or OpenCode reviews; the `jev_review` tool, the `/jev cli-review` forms and their settings are dead weight in the tool list, the command surface and the docs. The `effort.holdProviders` default of `["9router"]` encodes one operator's routing setup into the package; a fresh install should decide every prompt unless the operator lists a provider.

**What goes.**
- The `cli-review` capability (all 16 requirements): the `jev_review` tool, its Codex/OpenCode runners, its prompt, its on/off sync and its refusal path.
- `/jev cli-review on|off` and `/jev cli-review <codex|opencode> [model] [effort]`, the `cli review:` line of the `/jev` report, and the CLI review part of `/jev reset` and `/jev all`.
- The config section `review` (`review.cli`, `review.enabled`), the state fields `cliReview` and `cliReviewEnabled`, and the resolved `review` settings.
- Evidence `docs/evidence/2026-11-06-cli-review.md` and the manual runner `tests/host/manual/cli-review-real.ts`; no replacement ADR.
- In ADR `docs/decisions/0004-review-as-a-slot.md`, only the sentence about the CLI review tool. The ADR itself stays: it records why reviews route through an ordinary `reviewer` slot, which this change keeps.

**What changes.**
- `effort.holdProviders` defaults to `[]`. Hold behaviour itself (`effort-hold`) is unchanged; it only applies to providers the operator lists.
- Existing files keep working: for one minor release a `review` section in `config.json` and `cliReview` / `cliReviewEnabled` in `state.json` are accepted on read and ignored, and the first main `session_start` removes them from disk, the same way the legacy tier names are migrated today.
- `/jev cli-review ...` becomes an unknown form and gets the usage warning like any other unknown argument.

**Goals.** No `jev_review` tool in any session; no CLI review setting anywhere in the resolved settings, status or docs; no operator file turns invalid because of the removal.

**Non-goals.** No change to `effort-hold` semantics, to the `reviewer`-style worker slots, or to the slot reserved-word list.

**Anti-goals.** An operator with `review` in `config.json` must not lose the rest of their config (an unknown-key rejection would make the whole file invalid and fall back to defaults).

## Alternatives Considered

### Alternative A: Hard removal, keys become unknown
- **Approach**: Delete the feature and the validators; `review` in config and `cliReview*` in state become unknown keys.
- **Pros**: Smallest diff; no deprecated code to remove later.
- **Cons**: `config.json` rejects unknown keys, so every operator who ever set `review` gets an invalid config and loses all settings; a `state.json` with `cliReview*` reads as malformed and is renamed to `.bad` on the next update.
- **Why not chosen**: Breaks operators' unrelated settings silently; the user asked for a migration like the tier rename.

### Alternative B: Keep the feature, default off
- **Approach**: Leave `jev_review` registered but hidden, only change the `holdProviders` default.
- **Pros**: No migration.
- **Cons**: Keeps all the code, tests, docs and command surface the user wants gone.
- **Why not chosen**: Does not meet the request.

### Alternative C: Accept-and-ignore without rewriting files
- **Approach**: Accept the old keys on read forever, never touch the files.
- **Pros**: No file writes.
- **Cons**: Dead keys stay in operator files indefinitely; the deprecated read path can never be removed.
- **Why not chosen**: The user asked for the files to be cleaned up, as the tier migration does.

## Agreed Approach

Full removal of the feature plus a one-minor migration (Alternative A's removal, made safe by the tier-style migration): old keys are accepted and ignored on read, and the first main `session_start` rewrites `config.json` without `review` and `state.json` without `cliReview` / `cliReviewEnabled`, with one notice for the config rewrite. `effort.holdProviders` defaults to `[]`.

## Key Decisions

- Old config/state keys: accepted and ignored on read for one minor, removed from disk at main `session_start` (user decision, mirrors the tier migration).
- `/jev cli-review`: removed outright, no "removed" message (user decision).
- The CLI review evidence file and manual runner: deleted, no new ADR (user decision).
- ADR 0004: kept, because its subject is the `reviewer` slot. Its Decision drops the `jev_review` sentence and gains a dated note that the CLI review was removed (user decision, revised after finding the ADR is mainly about slot routing).
- One change covers both the removal and the `holdProviders` default (user decision).
- `effort.holdProviders` default: `[]` (user request).

## Open Questions

None.

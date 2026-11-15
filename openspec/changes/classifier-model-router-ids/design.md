## Context

The classifier section of `config.json` is validated in `src/store/config.ts` with an inline `string({ pattern })` per field. The Jev client sends `model` unchanged, and nothing else reads or stores the classifier model's shape, so the validator is the only place the rule lives in code.

## Goals / Non-Goals

**Goals:**
- Accept router-style classifier ids up to 128 characters.
- Keep rejecting secret-shaped values and keep the rule local to the classifier.

**Non-Goals:**
- Changing tier, slot, ledger or CLI review model rules.
- Checking at config time whether the endpoint knows the model.

## Decisions

- **A dedicated classifier pattern in `config.ts`.** Write the classifier model regex as its own named constant next to the classifier validator instead of importing a pattern from `state-file.ts` or another module. The classifier model is the Jev decision model and must be able to change without touching other model fields; a shared constant would couple them. The two regexes may be textually equal today; that is accepted duplication.
- **Pattern `^[A-Za-z0-9._][A-Za-z0-9._:/-]{0,127}$`.** The length bound sits in the regex, so the issue message names the full rule. No `max` option is needed.
- **No `default` exclusion.** The classifier has no meaning for the word `default`; `jev-latest` is the default when the field is absent.

## Risks / Trade-offs

- [An accepted id is unknown to the endpoint] → the request fails and the package fails open, as for any wrong model today.
- [A secret made only of allowed characters still passes] → same as before; the field never held secret-shaped protection beyond the character set, and `apiKeyEnv` keeps its own guard.

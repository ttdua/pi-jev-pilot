## Design Summary

`classifier.model` in `config.json` should accept the model ids that Jev-compatible proxies route on, such as `openrouter/perplexity/pplx-decider-v1.3:free` (issue #78). Today the field takes 1–64 characters of letters, digits, `.`, `_`, `-`, so any id with `/` or `:` makes the read invalid. Because `config.json` is valid or rejected as a whole, the bad field also turns off `tiers`, `crew` and every other setting.

The change gives the Jev classifier model its own, wider id rule, derived from the router id form `provider/vendor/model:tag`: 1–128 characters from letters, digits, `.`, `_`, `-`, `:`, `/`, not starting with `-`, `:` or `/`. Whitespace, `=`, quotes and other characters typical of a pasted secret stay rejected.

The classifier model is the Jev decision model only. Its rule is defined for the classifier on its own and is not tied to, shared with or derived from any other model field (CLI review models, tier models, slot models); each keeps its own rule and can change independently.

Existing requirement altered: `config-file` / "Classifier field rules" currently says `model` is 1–64 characters of letters, digits, `.`, `_`, `-`. This change replaces that clause. The other classifier rules (`url`, `apiKeyEnv`, `timeoutMs`) are unchanged.

Not touched: the Jev transport already sends `model` as given (`jev-transport` requirement on the request body), the default stays `jev-latest`, and the classifier model is not written to the ledger, so no ledger schema change follows.

## Alternatives Considered

### Alternative A: Router-shaped classifier id rule (chosen)
- **Approach**: a classifier-only rule that admits `/` and `:` inside the id, up to 128 characters, with a leading letter, digit, `.` or `_`.
- **Pros**: covers `provider/vendor/model:tag` and plain TypeSafe ids like `jev-latest`; keeps the secret-shaped rejections; small change.
- **Cons**: allows ids TypeSafe itself would refuse; those fail at request time, which fail open already covers.
- **Why chosen**: fits real router ids while keeping a strict character set.

### Alternative B: Accept any non-whitespace string up to 128 characters
- **Approach**: `^\S{1,128}$`.
- **Pros**: never blocks a future router format.
- **Cons**: accepts `=`, quotes and other secret-like text; weaker guard against a key pasted into the wrong field.
- **Why not chosen**: loses the secret guard the config validator keeps elsewhere.

### Alternative C: Keep the rule and document a proxy alias
- **Approach**: leave `classifier.model` as is and ask users to configure an alias in the proxy.
- **Pros**: no code change.
- **Cons**: 9router rejects shorter forms and combo names for `/v1/systemone` (`Invalid model format`), so no valid id exists.
- **Why not chosen**: does not solve the reported case.

## Agreed Approach

Alternative A: a classifier-only, router-shaped id rule.

## Key Decisions

- Accepted after the change: `jev-latest`, `jev-1.14.0`, `openrouter/perplexity/pplx-decider-v1.3:free`.
- Still rejected: whitespace, a leading `/`, `-` or `:`, an empty string, more than 128 characters, `=` and quotes.
- The rule belongs to the classifier alone; no other model field changes or shares it.
- `docs/configuration.md` `classifier.model` row is updated with the new rule and a router example.

## Open Questions

None.

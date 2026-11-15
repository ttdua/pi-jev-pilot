## Why

`classifier.model` accepts only 1–64 characters of letters, digits, `.`, `_`, `-`. Jev-compatible proxies such as 9router route `/v1/systemone` by ids like `openrouter/perplexity/pplx-decider-v1.3:free` and accept no shorter form, so these users have no valid value. Because `config.json` is valid or rejected as a whole, the one field also disables `tiers`, `crew` and every other setting (issue #78).

## What Changes

**Classifier model id rule**
- From: `classifier.model` is 1–64 characters of letters, digits, `.`, `_`, `-`.
- To: `classifier.model` is 1–128 characters of letters, digits, `.`, `_`, `-`, `:`, `/`, not starting with `-`, `:` or `/`.
- Reason: admit router-style ids while still rejecting whitespace, `=`, quotes and other secret-shaped text.
- Impact: widening, with one narrowing: a value starting with `-` (valid today, never a real Jev or router id) becomes invalid and, like any invalid field, makes the whole `config.json` invalid. Only the classifier model changes; other model fields keep their own rules.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `config-file`: the `model` clause of the "Classifier field rules" requirement changes to the wider router-shaped id rule.

## Impact

- Code: `src/store/config.ts` (classifier `model` validator).
- Tests: `tests/store/config-read.test.ts`.
- Docs: `docs/configuration.md` (`classifier.model` row).
- Specs: `openspec/specs/config-file/spec.md` via the delta.
- No change to the Jev transport, defaults, ledger schema or other model fields.

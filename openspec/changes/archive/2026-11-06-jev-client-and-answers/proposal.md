## Why

WG-07 (main effort) and WG-11 (worker routing) both depend on asking Jev and reading its answers. Without one shared client and one shared validator, each would reimplement the transport rules and the fail-open behaviour, and a mistake in either would let a Jev failure block or delay a turn. WG-04 builds both pieces once, against a loopback fixture, so later groups inherit a tested contract.

## What Changes

- Add `src/jev/client.ts`: one Jev request with HTTPS-or-loopback URL rules, no redirects, no retry, a timeout that aborts the request, caller cancellation, a 256 KB response cap, and a tagged-union result (`ok`, `miss` with `timeout`, `error` or `schema`, `cancelled`). It never throws.
- Add `src/policy/answers.ts`: pure, per-question validation of a raw response against the questions asked. Strict rules: the type must match, a choice must be a known option, probabilities must have exactly the question's options as keys, and every number must be finite within 0 to 1. A body without `answers` is a `schema` miss for the whole request.
- Add contract tests against a loopback HTTP fixture and unit tests for validation.
- Update the docs where these rules are now more precise.

## Capabilities

### New Capabilities
- `jev-transport`: how one request reaches Jev and how every transport outcome is reported, including URL rules, timeout, cancellation, redirect, status, size and JSON parsing.
- `answer-reading`: how a raw Jev response becomes per-question answers, which answers count, and when the whole request is a miss.

### Modified Capabilities
None. The new code and tests run under the existing `quality-checks` scripts and boundary rules without changing them.

## Impact

- **Code:** new `src/jev/client.ts`, `src/policy/answers.ts`, and tests under `tests/`. `src/extension.ts` stays a no-op, since nothing calls the client until WG-07.
- **Dependencies:** none added.
- **CI:** contract tests bind `127.0.0.1` only.
- **Docs updated:** `docs/jev-contract.md` (Transport: loopback definition, size cap, outcome kinds; Validation: strict rules, malformed JSON as `schema`), `docs/configuration.md` (`classifier.url` loopback definition), `docs/roadmap.md` (WG-04 status).

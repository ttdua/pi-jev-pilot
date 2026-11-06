## Why

The Jev client (WG-04) and the `config.json` validator (WG-03) each have their own rule for an acceptable Jev URL, and they disagree. The client accepts any loopback IPv4 address in `127.0.0.0/8`, while the config accepts only `127.0.0.1`. So a URL the client would use, such as `http://127.5.6.7/`, makes the package inert. Two rules for one setting will keep drifting. Moving the rule into one shared function, in a module both sides may import, ends the disagreement and completes WG-03 (issue #4).

## What Changes

- Add `src/shared/`, a leaf module for dependency-free rules any module may import. Lint keeps it a leaf: it imports nothing outside itself and never Pi.
- Move the Jev URL rule into `src/shared/urls.ts`. `isAllowedJevUrl` in `src/jev/client.ts` keeps its name and behavior and uses the shared rule. The `config.json` validator uses the same rule, and its own copy is removed.
- Update lint and its fixtures for the new edges.

**Loopback URLs in `config.json`**
- From: `classifier.url` with `http:` must have host `127.0.0.1`, `localhost` or `[::1]`.
- To: `classifier.url` with `http:` may have host `localhost`, any IPv4 address in `127.0.0.0/8`, or `[::1]`, exactly as the Jev client accepts.
- Reason: one rule for one setting.
- Impact: non-breaking. Every config valid before is still valid; a few more loopback forms are now accepted.

**Dependency rules**
- From: the modules are `policy/`, `jev/`, `store/`, `host/`, `scripts/` and `extension.ts`.
- To: those modules plus `shared/`. Every module except `extension.ts` may import `shared/`, and `shared/` imports nothing outside itself.
- Reason: the operator chose a dedicated leaf module, so that rules both `jev/` and `store/` need have a home without blurring `policy/`.
- Impact: non-breaking. Only lint configuration and docs change.

No Jev call changes. The client sends and reports exactly as before.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `config-file`: "Classifier field rules" accepts the `127.0.0.0/8` loopback range for `classifier.url`.
- `quality-checks`: "Dependency boundaries are enforced by lint" and "Pi imports are confined to host" include `shared/`.

## Impact

- **Code:** new `src/shared/urls.ts`; `src/jev/client.ts` and `src/store/config.ts` call it. `.oxlintrc.json` gains a `shared/` override and allows `../shared/**` elsewhere. New boundary fixtures in `tests/fixtures/boundaries/`. New tests in `tests/shared/urls.test.ts` and in `tests/store/config-read.test.ts`.
- **Dependencies:** none.
- **Docs updated:**
  - `docs/architecture.md`: module layout, dependency rules list and diagram.
  - `docs/configuration.md`: the `classifier.url` row.
  - `docs/roadmap.md`: note under WG-03.

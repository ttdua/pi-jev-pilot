## Design Summary

Two rules currently decide whether a Jev URL is acceptable:

- `isAllowedJevUrl` in `src/jev/client.ts` (WG-04) accepts `https:`, or `http:` to `localhost`, any IPv4 address in `127.0.0.0/8`, or `[::1]`, with no username or password.
- `urlAllowed` in `src/store/config.ts` (WG-03) accepts the same, except that loopback IPv4 means only `127.0.0.1`.

The result is that `config.json` rejects `http://127.5.6.7/`, a URL the client would send to. Both rules answer the same question for the same setting, so they must agree, and the only way they keep agreeing is to be one function.

This change adds a leaf module, `src/shared/`, that holds dependency-free rules any module may import. The URL rule moves there and becomes the single implementation of the Jev URL rule. Both the client and the config validator call it, so `classifier.url` accepts exactly what the client accepts: loopback IPv4 becomes `127.0.0.0/8`. The rule's behavior is unchanged for the client. Lint keeps the new module a leaf, and the architecture docs and the `quality-checks` spec gain the new edges.

Finishing this change also completes issue #4 (WG-03). Its PR closes the issue.

## Alternatives Considered

### Alternative A: Move the rule into `policy/`
- **Approach**: `src/policy/urls.ts`, with lint loosened so that `store/` may import that one file.
- **Pros**: no new module; `policy/` is already pure and already imported by `jev/`.
- **Cons**: `policy/` holds decision rules, and a URL syntax rule is not a decision. The `store/` exception would be a single-file carve-out in lint.
- **Why not chosen**: the operator chose a dedicated leaf module, so that shared, rule-free helpers have a clear home that does not blur what `policy/` means.

### Alternative B: Keep two copies, tied by a shared test table
- **Approach**: change `urlAllowed` to `127.0.0.0/8`, and add a test asserting that both functions agree on one table of URLs.
- **Pros**: no change to architecture or lint.
- **Cons**: two implementations remain. The test only checks the URLs in its table, so the copies can still drift on inputs nobody listed.
- **Why not chosen**: it does not deliver "one rule".

## Agreed Approach

Alternative C, chosen by the operator: a new leaf module `src/shared/`. It imports nothing outside itself, does no I/O and does not import Pi. Every module (`policy/`, `jev/`, `store/`, `host/`, `scripts/`) may import it, and `extension.ts` still wires only `host/`. The Jev URL rule lives there as the only implementation; `jev/` and `store/` call it.

## Key Decisions

1. **Location**: `src/shared/`, a leaf. Lint forbids `shared/` from importing anything outside itself, and from importing `@earendil-works/*`. Every other module's rules allow `../shared/**`, except `extension.ts`, which still imports only `host/`.
2. **One rule**: the URL check lives only in `src/shared/`. `isAllowedJevUrl` stays exported from `src/jev/client.ts` with the same name and behavior, so the `jev-transport` spec and its tests do not change. The `config.ts` copy and its `LOOPBACK_HOSTS` list are removed.
3. **Config behavior**: `classifier.url` accepts `http:` to any `127.0.0.0/8` address, matching the client. The validation message stays the same and still does not echo the value.
4. **Specs**: `config-file` MODIFIED "Classifier field rules", with new scenarios for `127.5.6.7` and `127.1`. `quality-checks` MODIFIED "Dependency boundaries are enforced by lint" and "Pi imports are confined to host", with the `shared/` edges.
5. **Docs**: `docs/architecture.md` (layout, dependency rules and diagram), `docs/configuration.md` (`url` row), and the roadmap note under WG-03.
6. **Issue**: the PR body says `Closes #4`.

## Open Questions

None.

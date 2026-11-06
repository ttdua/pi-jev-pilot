## Context

`src/jev/client.ts` defines `isAllowedJevUrl`, which accepts `127.0.0.0/8`. `src/store/config.ts` defines a private `urlAllowed`, which accepts only `127.0.0.1`. Lint (`.oxlintrc.json`) forbids `store/` from importing `jev/` or `policy/`, and forbids `jev/` from importing `store/`. The operator chose a new leaf module, `src/shared/`, over moving the rule into `policy/` or keeping two copies (see `brainstorm.md`).

## Goals / Non-Goals

**Goals:**
- One implementation of the Jev URL rule, used by both the client and the config validator.
- Lint keeps `shared/` a leaf, and the boundary test proves both the new forbidden edges and the new allowed ones.

**Non-Goals:**
- Changing the client's behavior, its error reporting or the `jev-transport` spec.
- Moving any other code into `shared/`.
- Changing the config validator's message wording.

## Decisions

### D1. `src/shared/urls.ts` exports `isAllowedJevUrl`

The shared file exports `isAllowedJevUrl(url: string): boolean`, with the body now in `src/jev/client.ts` moved verbatim: WHATWG parse, no username or password, `https:`, or `http:` with hostname `localhost`, `[::1]` or a dotted IPv4 in `127.0.0.0/8`. The match runs on the parsed hostname, so `http://127.1/` and other shorthand forms normalize to `127.0.0.1` first.

`src/jev/client.ts` re-exports it (`export { isAllowedJevUrl } from "../shared/urls.ts"`) and keeps calling it. Callers and tests that import it from `jev/client.ts` keep working. Keeping the name says what the rule is for: it describes Jev endpoints, not URLs in general.

### D2. Config uses the shared rule through `refine`

In `src/store/config.ts`, `const url = refine(string({}), isAllowedJevUrl, <same message>)`. `urlAllowed` and `LOOPBACK_HOSTS` are deleted. The message is unchanged ("expected an https URL, or http on a loopback host, without credentials"), so it still names no value.

### D3. Lint

- A new override for `src/shared/**` forbids `../**` (anything outside `shared/`) and `@earendil-works/*`.
- The existing overrides need no new allow entries, because `no-restricted-imports` only lists forbidden patterns. The one exception is `policy/`, whose `../**` pattern also matches `../shared/**`. Its override gains allow-exceptions as negated patterns in the same group list: `["../**", "!../shared/**", "!../../shared/**"]`. The second negation is needed because `policy/sub/` reaches `shared/` through `../../shared/`. A scratch run of the pinned oxlint 1.91.0 confirmed both paths: `../shared/x.ts` from `policy/` and `../../shared/x.ts` from `policy/sub/` pass, while `../jev/x.ts` and `../../host/x.ts` are still reported. One accepted gap: from top-level `policy/`, `../../shared/` would point at `<repo>/shared/`, which does not exist. Lint does not catch it, and the import would fail to resolve anyway.
- `extension.ts` gains a forbidden `./shared/**`, because the entry point wires only `host/`.
- Fixtures: `src/shared/bad-parent.ts` (imports `../policy/x.ts`), `src/shared/bad-pi.ts`, `src/extension-bad-shared.ts`, plus `ok-shared.ts` in each of `policy/`, `jev/`, `store/` and `host/`, plus `policy/sub/ok-shared.ts` (imports `../../shared/x.ts`), and `scripts/replay/ok-shared.ts` (imports `../../src/shared/x.ts`). The existing boundary test finds the bad ones by the `bad-` prefix, so no test code changes.
  - `policy/` and `extension.ts` need the new allow or ban patterns.
  - The `ok-shared` fixtures in `jev/`, `store/`, `host/` and `scripts/` pass today, because their overrides list only specific forbidden paths. They are there so that a future broad pattern cannot silently cut the allowed edge.
  - The `policy/sub/ok-shared.ts` fixture pins the second negation.

### D4. Docs

`docs/configuration.md` changes the `classifier.url` row to "HTTPS, or HTTP only to loopback (`localhost`, an address in `127.0.0.0/8`, `[::1]`). No username or password. Redirects are rejected". `docs/roadmap.md` adds a note under WG-03 that the URL rule is shared with the Jev client. `docs/architecture.md` adds `shared/` to the layout and to the diagram, with every module except `extension.ts` pointing to `shared`, and adds one rule line: "`shared/` imports nothing outside itself; any module but `extension.ts` may import it."

## Risks / Trade-offs

- [`shared/` becomes a dumping ground] → The architecture line limits it to dependency-free rules needed by more than one module, and lint keeps it a leaf.
- [oxlint negated patterns change in a later version] → The boundary fixtures prove the outcome on every run: `policy/ok-shared.ts` must pass, and `policy/bad-*` must still fail.
- [A config with a looser loopback is accepted where it was rejected before] → It only widens to addresses the client already uses, all of them loopback.

## Migration Plan

None; this is additive. Existing `config.json` files stay valid.

## Open Questions

None.

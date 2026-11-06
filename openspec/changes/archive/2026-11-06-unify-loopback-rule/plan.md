# Unify Loopback Rule Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` and `design.md`.

**Goal:** Use one Jev URL rule, in a new leaf module `src/shared/`, for both the Jev client and the `config.json` validator.

**Architecture:** Move `isAllowedJevUrl` verbatim into `src/shared/urls.ts`. `src/jev/client.ts` re-exports it, and `src/store/config.ts` validates `classifier.url` with it. Lint keeps `shared/` a leaf, and the boundary fixtures prove each new edge.

**Tech Stack:** TypeScript, Bun (`bun test`), oxlint 1.91.0 `no-restricted-imports`.

## Global Constraints

- No new dependency. Behavior of `isAllowedJevUrl` and of `askJev` is unchanged: the existing `tests/jev/client.test.ts` must pass untouched.
- `src/shared/` imports nothing outside itself and never imports `@earendil-works/*`.
- The `config.json` URL message stays `expected an https URL, or http on a loopback host, without credentials`, and never contains the value.
- Expected values in tests come from the specs, not from running the code.
- Tests need no secrets, no paid calls and no network beyond loopback (the URL tests make no requests at all).
- Every task ends with `bun run typecheck && bun run lint && bun run fmt:check && bun run test` exiting 0.
- Commit messages: `refactor(shared): …`, `feat(store): …`, `chore(lint): …`, `docs: …`.

## Review Focus

1. **Client behavior drift:** the move must be verbatim, including the regex `^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$` on the WHATWG hostname. Task 1 keeps the existing client tests unchanged and adds `tests/shared/urls.test.ts`.
2. **A copy survives:** `urlAllowed` and `LOOPBACK_HOSTS` must be gone. Task 2 has the test `config uses the shared rule`, a source check that `src/store/config.ts` imports `isAllowedJevUrl` from `../shared/urls.ts` and has no `LOOPBACK_HOSTS`.
3. **Lint negation silently disabled:** if `!../shared/**` were ignored, `policy/ok-shared.ts` would be flagged; if it were too broad, `policy/bad-*` would pass. The boundary test checks the exact set in Task 3.
4. **Fixture paths:** `scripts/replay/ok-shared.ts` must import `../../src/shared/x.ts` and `policy/sub/ok-shared.ts` must import `../../shared/x.ts`, or the fixtures prove nothing.
5. **The value is echoed in an issue:** unchanged message (the `Value is not echoed` test stays green).

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `isAllowedJevUrl` (shared) | new location | `src/shared/urls.ts`: `export function isAllowedJevUrl(url: string): boolean`, with the body moved verbatim from `src/jev/client.ts` | no |
| `isAllowedJevUrl` (jev) | modified | `src/jev/client.ts`: `import { isAllowedJevUrl } from "../shared/urls.ts";` plus `export { isAllowedJevUrl };`. The import gives `askJev` its local binding, and the name and behavior are unchanged | no |
| `classifier.url` rule | modified | `config.json` accepts exactly what `isAllowedJevUrl` accepts (adds `127.0.0.0/8`) | yes (operator file) |
| Lint override `src/shared/**` | new | `no-restricted-imports` patterns `["../**"]` and `["@earendil-works/*"]` | no |
| Lint override `src/policy/**` | modified | group `["../**", "!../shared/**", "!../../shared/**"]`, message `policy/ imports only itself and shared/.` | no |
| Lint override `src/extension*.ts` | modified | adds group `["./shared/**"]` | no |

---

## Task 1: Shared URL rule — implements 1.1

**Files:**
- Create: `src/shared/urls.ts`, `tests/shared/urls.test.ts`
- Modify: `src/jev/client.ts` (remove `isLoopbackHost` and the `isAllowedJevUrl` body; add the re-export; keep the call in `askJev`)

**Interfaces:**
- Produces: `isAllowedJevUrl` from `src/shared/urls.ts` (Contracts).

- [ ] **Step 1: Write the failing test** `tests/shared/urls.test.ts`.
  - `accepts https and loopback`: `http://127.0.0.1:1/`, `http://127.5.6.7/`, `http://127.1/`, `http://[::1]:1/`, `http://localhost:1/` and `https://api.typesafe.ai/v1/systemone` are all `true`.
  - `rejects other URLs`: `ftp://127.0.0.1/`, `http://10.0.0.1/`, `http://user:pw@127.0.0.1/`, `https://user:pw@api.typesafe.ai/`, `not a url` and `http://example.com/v1` are all `false`.
  - `jev re-exports the shared rule`: `import { isAllowedJevUrl as fromJev } from "../../src/jev/client.ts"` is the same function (`toBe`) as the shared one.
- [ ] **Step 2:** Run `bun test tests/shared/urls.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Move the code per Contracts. `client.ts` uses `import` plus `export { isAllowedJevUrl }`, because a bare `export … from` gives `askJev` no local binding. The comment at the top of `src/jev/client.ts` gains `../shared/` in its import list.
- [ ] **Step 4:** Run `bun test tests/shared/urls.test.ts tests/jev/client.test.ts`. Expected: PASS, with `client.test.ts` unchanged.
- [ ] **Step 5:** Run the full check line, then commit `refactor(shared): move the Jev URL rule into src/shared`.

## Task 2: Config uses the shared rule — implements 1.2

**Files:**
- Modify: `src/store/config.ts`, `tests/store/config-read.test.ts`

**Interfaces:**
- Consumes: `isAllowedJevUrl` from `../shared/urls.ts`.

- [ ] **Step 1: Write the failing tests** in `tests/store/config-read.test.ts`.
  - `Whole loopback range accepted`: `http://127.5.6.7/v1` and `http://127.1/v1` both read as `ok`.
  - `Config and client agree`: for each URL in the spec scenario's list, the config read is `ok` exactly when `isAllowedJevUrl(url)` is true. Assert the list contains at least one URL of each outcome.
  - `config uses the shared rule`: the text of `join(REPO_ROOT, "src/store/config.ts")` (from `tests/helpers.ts`) contains `from "../shared/urls.ts"` and contains neither `LOOPBACK_HOSTS` nor `function urlAllowed`. This guard backs the spec sentence "MUST use that same function rather than a copy". The behavior test alone cannot rule out a copy that agrees.
- [ ] **Step 2:** Run `bun test tests/store/config-read.test.ts`. Expected: FAIL on the three new tests.
- [ ] **Step 3:** Replace `urlAllowed` with `isAllowedJevUrl` in the `url` refine (message unchanged). Delete `urlAllowed` and `LOOPBACK_HOSTS`.
- [ ] **Step 4:** Run `bun test tests/store`. Expected: PASS. Every existing scenario test, including `Loopback http URL accepted` and `Value is not echoed`, stays green.
- [ ] **Step 5:** Run the full check line, then commit `feat(store): validate classifier.url with the shared Jev URL rule`.

Note: until Task 3, lint forbids nothing in `store/` → `../shared/**`, because `store/` lists only specific paths, so lint passes after Task 2.

## Task 3: Lint boundaries — implements 2.1

**Files:**
- Modify: `.oxlintrc.json`
- Create these fixtures under `tests/fixtures/boundaries/`, one import each:

| Fixture | Import |
|---|---|
| `src/shared/bad-parent.ts` | `../policy/x.ts` |
| `src/shared/bad-pi.ts` | `@earendil-works/pi-coding-agent` |
| `src/shared/ok-local.ts` | `./x.ts` |
| `src/extension-bad-shared.ts` | `./shared/x.ts` |
| `src/policy/ok-shared.ts` | `../shared/x.ts` |
| `src/policy/sub/ok-shared.ts` | `../../shared/x.ts` |
| `src/jev/ok-shared.ts` | `../shared/x.ts` |
| `src/store/ok-shared.ts` | `../shared/x.ts` |
| `src/host/ok-shared.ts` | `../shared/x.ts` |
| `scripts/replay/ok-shared.ts` | `../../src/shared/x.ts` |

- [ ] **Step 1:** Add the fixtures, then run `bun test tests/boundaries.test.ts`. Expected: FAIL. `src/shared/bad-*` and `extension-bad-shared.ts` are not flagged, and `policy/ok-shared.ts` and `policy/sub/ok-shared.ts` are flagged.
- [ ] **Step 2:** Edit `.oxlintrc.json` per Contracts. Messages: `shared/ imports nothing outside itself.`, `Only host/ may import Pi.`, and `The entry point wires only host/.`. The `policy/` message becomes `policy/ imports only itself and shared/.`
- [ ] **Step 3:** Run `bun test tests/boundaries.test.ts`. Expected: PASS (the flagged set equals exactly the `bad-` files). Then run `bun run lint`. Expected: exit 0 on the real tree.
- [ ] **Step 4:** Run the full check line, then commit `chore(lint): add the shared/ leaf module boundary`.

## Task 4: Docs — implements 3.1

**Files:**
- Modify: `docs/architecture.md`, `docs/configuration.md`, `docs/roadmap.md`

- [ ] **Step 1:** In `docs/architecture.md`:
  - Module layout: add `shared/  Dependency-free rules used by more than one module` with `urls.ts  The Jev URL rule`.
  - Dependency rules: change "`policy/` imports nothing outside itself." (line 103) to "`policy/` imports nothing outside itself and `shared/`." Then add the line "`shared/` imports nothing outside itself; any module but `extension.ts` may import it."
  - Mermaid diagram: add edges `host --> shared`, `jev --> shared`, `policy --> shared`, `store --> shared` and `scripts --> shared`.
- [ ] **Step 2:** In `docs/configuration.md`, change the `url` row to "HTTPS, or HTTP only to loopback (`localhost`, an address in `127.0.0.0/8`, `[::1]`). No username or password. Redirects are rejected".
- [ ] **Step 3:** In `docs/roadmap.md`, under WG-03, add a note: "The `classifier.url` rule is the Jev client's rule, shared through `src/shared/urls.ts`."
- [ ] **Step 4:** Run `bun run fmt:check && bun run test`. Expected: PASS. Then commit `docs: shared Jev URL rule`.

---

## Scenario → test

**config-file** (`tests/store/config-read.test.ts`)
- Remote http URL rejected → existing same-named test
- Loopback http URL accepted → existing same-named test
- Whole loopback range accepted → `Whole loopback range accepted` (Task 2)
- Config and client agree → `Config and client agree` (Task 2), backed by `config uses the shared rule`
- Other scheme rejected → existing same-named test
- URL with credentials rejected → existing same-named test
- Timeout bounds → existing same-named test
- Key-shaped apiKeyEnv rejected → existing same-named test

**quality-checks** (`tests/boundaries.test.ts`, with fixtures from Task 3)
- Forbidden edges → `boundary rules flag exactly the forbidden imports` (new `shared/bad-*` and `extension-bad-shared.ts`)
- Each forbidden edge is reported → same test
- Allowed edges are not reported → same test (new `ok-shared.ts` fixtures and `shared/ok-local.ts`)
- Pi import outside host is reported → same test (`shared/bad-pi.ts`) plus the existing `bad-pi` fixtures

## Design Summary

**Intent.** WG-07 (main effort) and WG-11 (worker routing) both ask Jev questions and act on the answers. Before either can be built, the package needs one trustworthy way to send a request to TypeSafe and one trustworthy way to read what comes back. WG-04 builds those two pieces, `src/jev/client.ts` and `src/policy/answers.ts`, so that every later feature inherits the transport rules and the fail-open behaviour instead of re-implementing them. Scope and the "done when" list come from `docs/roadmap.md#wg-04-jev-client-and-answer-reading` and issue #5.

**What it produces.**

- `jev/client.ts`: sends one request and reports one of three outcomes: a successful body, a miss of a named kind (`timeout`, `error`, `schema`), or a cancellation. It enforces the transport rules in `docs/jev-contract.md#transport`: HTTPS or loopback only, no redirects, no retry, a timeout that aborts the request, and caller cancellation that stops everything.
- `policy/answers.ts`: pure. It takes the questions that were asked and the raw body, and returns, per question, either a usable answer or the reason it is unanswered. A body without `answers` makes the whole request a miss.
- Contract tests against a local HTTP fixture on loopback cover the roadmap list: success, timeout, 4xx and 5xx, redirect, malformed JSON, one bad answer among good ones, and cancellation. They also cover the rules added below: URL rejection and the body size cap.
- Doc updates where these rules are now more precise than the docs: `docs/jev-contract.md` (Transport, Validation), `docs/configuration.md` (`classifier.url`), and `docs/roadmap.md` (status).

**Goals.**

- No Jev failure can throw past the client or delay work beyond the timeout (invariant 1, "fail open").
- A cancelled request starts nothing and reports as cancelled, not as a miss (invariant 2).
- One malformed answer never discards the other answers.
- Both modules take plain inputs only, so `scripts/replay` can reuse them offline.

**Non-goals.**

- Reading the API key from the environment, or making the package inert when it is missing: that belongs to `host/` (WG-06, WG-07).
- Building state or questions (`jev/state.ts`, `jev/questions.ts`, `jev/rubrics.ts`): those are WG-07 and WG-11.
- Reading `config.json` (WG-03). The client receives URL, model, timeout and key as arguments.
- Ledger lines and status display (WG-05, WG-06).
- Any call to the real TypeSafe API.

**Anti-goals.**

- A client that retries, follows a redirect, or sends the key to a non-HTTPS, non-loopback host.
- Validation that guesses on Jev's behalf, for example by filling in a missing probability.
- Tests that need secrets, paid calls or network beyond loopback.
- The key showing up in an error message, a log or a test snapshot (invariant 8).

**Constraints.**

- `jev/` must not import `host/`, `store/` or Pi, and `policy/` must not import anything outside itself. Lint already enforces both.
- No new dependency: Bun's `fetch` and `Bun.serve` are enough.
- The existing `typecheck`, `lint`, `fmt:check` and `test` checks keep passing.

## Alternatives Considered

### Alternative A: Tagged-union results, client and validation split
- **Approach**: The client never throws. It returns `ok`, `miss(kind)` or `cancelled`, and checks only transport, redirect, size and JSON parsing. `policy/answers.ts` checks the envelope and each question against specs the caller passes in.
- **Pros**: Every failure branch is visible in the type, so a caller cannot forget fail open. Replay can run validation offline on recorded bodies. Matches the module layout in `docs/architecture.md`.
- **Cons**: Callers must branch on the outcome.
- **Why not chosen**: Chosen.

### Alternative B: Typed exceptions
- **Approach**: The client throws `JevTimeout`, `JevHttpError` and similar; callers use `try`/`catch`.
- **Pros**: Familiar style.
- **Cons**: A forgotten `catch` lets a Jev failure break a turn, which is exactly what invariant 1 forbids. The type system does not help.
- **Why not chosen**: Fail open would rest on discipline instead of types.

### Alternative C: Client also validates answers
- **Approach**: The client returns already-read answers in one call.
- **Pros**: One call for callers.
- **Cons**: Contradicts the `policy/answers.ts` placement in the architecture. Validation would no longer be pure, and replay could not validate a recorded body without going through the client.
- **Why not chosen**: Breaks the pure-policy principle and replay reuse.

## Agreed Approach

Alternative A, chosen by the operator: tagged-union outcomes, with transport in `jev/client.ts` and per-question validation in pure `policy/answers.ts`.

## Key Decisions

Decided by the operator in this session:

- **Loopback** means an IP literal in `127.0.0.0/8`, `[::1]`, or the hostname `localhost`. Every other host needs HTTPS.
- **A 2xx response whose body is not valid JSON** is a `schema` miss: the body arrived but could not be read.
- **Validation is strict.** A choice answer counts only when its type matches the question, its `choice` is a known option, its `probabilities` has exactly the question's options as keys, and every number is finite and within 0 to 1. A noul answer counts only when its type matches and its value is a finite number within 0 to 1. Anything else makes that one question unanswered.
- **The response body has a hard size cap** (256 KB). Exceeding it is an `error` miss.
- **Path**: `/opsx-ff`.

Proposed by the agent and open to correction at this gate:

- A URL that breaks the rule is an `error` miss, and no request is sent.
- A timeout and a caller cancellation are told apart, so a cancellation never reports as a miss.
- `confidence` is kept in the read answer for logging; policy never reads it.
- The `model` string in a successful response (the Jev version) is returned with `ok` so later groups can log it.
- Any non-2xx status, including 3xx, is an `error` miss.

## Open Questions

None blocking. The exact shape of the question specs passed to `policy/answers.ts` is settled in `design.md`, and WG-07 and WG-11 reuse it as written.

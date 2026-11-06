## Context

`src/` holds only the no-op `extension.ts`; neither `src/jev/` nor `src/policy/` exists yet. Lint already enforces the boundaries both new modules sit inside (`.oxlintrc.json`): `jev/` may import `policy/` but not `host/`, `store/` or Pi, and `policy/` imports nothing outside itself. Tests run with `bun test`. The host harness in `tests/host/fixture.ts` shows the loopback `Bun.serve` pattern the contract fixture reuses, though it serves a different protocol. Bun's built-in `fetch`, `AbortController` and `AbortSignal.any` cover the transport, so no dependency is needed.

The rules come from `docs/jev-contract.md` (Transport, Validation) and the operator's decisions recorded in `brainstorm.md`. Callers arrive in WG-07, WG-11 and `scripts/replay`; this group ships the modules and their tests only.

## Goals / Non-Goals

**Goals:**
- A client whose every outcome is a value: it never throws or rejects.
- A pure validator that callers and replay can run on any recorded body.
- Question and answer types that live in `policy/`, so that `jev/questions.ts` (later) and policy rules share one definition.

**Non-Goals:**
- Reading config, environment or the API key's presence. The caller passes `apiKey` as a string.
- Building `state` or `questions` payloads. The client sends whatever objects it is given.
- Logging. Outcomes carry short reasons that a later log can print.

## Decisions

### D1. Outcome types (tagged unions, chosen at brainstorm)

`jev/client.ts` returns `JevOutcome`:

- `ok`: `body` (parsed JSON, `unknown`), `model` (the response's `model` string if it is a string, else `undefined`), `ms`.
- `miss`: `miss` is `"timeout" | "error" | "schema"`, `ms`, and a short `reason` (for example `http 503`, `redirect`, `too large`, `bad url`, `invalid json`). `reason` never contains the key, headers or the body.
- `cancelled`: no timing, since nothing downstream should record it as a decision.

`policy/answers.ts` returns `ReadResult`:

- `miss` with `miss: "schema"` when the body is not an object or has no object-valued `answers`.
- `read` with `answers` (key → valid answer) and `unanswered` (key → reason) for every asked key. Each asked key appears in exactly one of the two.

*Why:* the outcome type forces each caller to handle miss and cancel, which is how invariant 1 (fail open) and invariant 2 (cancel starts nothing) stay true without relying on a `catch` someone might forget.

### D2. Question specs are passed in, defined in `policy/`

`policy/answers.ts` exports `QuestionSpec = { type: "choice"; options: readonly string[] } | { type: "noul" }` and reads against `Record<string, QuestionSpec>`. Answers to keys that were not asked are ignored. `jev/questions.ts` (WG-07) builds the specs together with the request's `questions` payload, so the two cannot disagree.

*Alternative:* infer specs from the response. Rejected, since then an unknown choice could never be detected.

### D3. Strict answer rules

A choice answer counts when `type` is `"choice"`, `choice` is one of the options, `probabilities` is an object whose key set equals the option set exactly, and every probability is a finite number in [0, 1]. A noul answer counts when `type` is `"noul"` and `noul` is a finite number in [0, 1]. Other fields on an answer object are ignored. The probabilities are not required to sum to 1, because the docs do not promise it and rounding would make an exact check fragile.

`confidence` is copied onto a valid choice answer only when it is a finite number in [0, 1]. Otherwise it is dropped and the answer still counts, since policy never reads it (ADR 0002).

Unanswered reasons are a closed set: `missing`, `type`, `choice`, `probabilities`, `range`.

### D4. URL rule, checked before any I/O

Exported as a pure `isAllowedJevUrl(url)` in `jev/client.ts`. It allows `https:` to any host, and `http:` only when the WHATWG-parsed hostname is `localhost`, an IPv4 literal in `127.0.0.0/8`, or `[::1]`. It rejects a URL with a username or password, since the URL would carry a credential beside the bearer token. The WHATWG parser normalises forms such as `127.1`, so the check runs on the parsed hostname. A rejected or unparseable URL returns `miss: "error"`, reason `bad url`, and no request is sent.

### D5. Timeout and cancellation share one abort path

The client creates its own timeout signal and combines it with the caller's signal through `AbortSignal.any`. The timeout covers the whole exchange, body read included. Classification runs in order:

1. The caller's signal is already aborted: `cancelled`, and no request is sent.
2. Abort during the exchange: `cancelled` if the caller's signal is aborted, otherwise `timeout`. The caller's state is checked first, so a cancellation that races the timeout still reports as cancelled. This ordering is a code rule, not a spec scenario, because the race cannot be produced deterministically in a test.
3. Any other fetch failure (connection refused, DNS and similar): `error`.

Inputs that fail before I/O (bad URL, bad timeout, a `state` that `JSON.stringify` rejects, a header value `fetch` rejects) are `error` with `ms` `0`. The whole client body runs inside one `try`, so no input can make it reject.

`timeoutMs` must be a positive finite number, otherwise the result is `error` with reason `bad timeout`. Range limits (300 to 5000) belong to config validation in WG-03.

### D6. Redirects and status

`fetch` runs with `redirect: "manual"`, so a 3xx comes back as a response and is never followed. Any non-2xx status is `error`, with reason `redirect` for 3xx and `http <status>` otherwise. No retry happens anywhere.

### D7. Body size cap

The cap is a constant: 262 144 bytes (256 KB). A `Content-Length` header larger than the cap fails immediately. Otherwise the body is read as a stream and counted, and the read is aborted as soon as the count passes the cap. Either case is `error`, reason `too large`. A body that cannot be decoded as UTF-8 or parsed as JSON is `schema`, reason `invalid json`.

### D8. Request shape

`POST` with `Authorization: Bearer <apiKey>`, `Content-Type: application/json`, `Accept: application/json`, and the body `{ model, state, questions }`, exactly as `docs/jev-contract.md` shows. The client adds no other fields.

## Risks / Trade-offs

- [Bun's `redirect: "manual"` or `AbortSignal.any` behaves differently from the spec] → contract tests pin both against the fixture, so a Bun upgrade that changes them fails CI.
- [Strict probability keys reject an answer if TypeSafe later adds a key, such as for a new option] → the miss is per question and visible as `probabilities`. Options come from our own question specs, so a mismatch means our specs and Jev disagree, which is worth surfacing.
- [`localhost` resolves through the system resolver, which could in theory point off-machine] → the operator accepted this for test ergonomics. Production uses HTTPS.
- [A timer that keeps running after an early return] → the timeout is cleared in a `finally`, and a test asserts the process does not wait for it.

## Migration Plan

None: new modules with no callers yet.

## Open Questions

None.

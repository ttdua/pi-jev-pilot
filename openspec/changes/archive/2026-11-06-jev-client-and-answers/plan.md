# Jev Client and Answer Reading Implementation Plan

> Executed via `/opsx-apply`, which chooses the executor.
> Spec reference: this change's `specs/` (`jev-transport`, `answer-reading`) and `design.md`.

**Goal:** Ship `src/jev/client.ts` and `src/policy/answers.ts` so that one Jev request always ends in a typed outcome, and a raw response becomes per-question answers under strict rules.

**Architecture:** `policy/answers.ts` is pure and owns the shared types. `jev/client.ts` imports `MissKind` from it, does all I/O through Bun's `fetch`, and never throws. Contract tests run the client against a loopback `Bun.serve` fixture. Unit tests cover the validator.

**Tech Stack:** TypeScript, Bun 1.4.4 (`fetch`, `Bun.serve`, `AbortSignal.any`, `bun:test`), oxlint, oxfmt.

## Global Constraints

- No new dependency (`CONTRIBUTING.md`). Bun built-ins only.
- `src/policy/` imports nothing outside itself; `src/jev/` must not import `host/`, `store/`, `extension.ts` or `@earendil-works/*` (`.oxlintrc.json`).
- Tests need no secrets, no paid calls, and no network beyond `127.0.0.1`.
- Everything in English. No real prompts or keys in fixtures: use `test-key-123` as the API key.
- `MAX_RESPONSE_BYTES = 262_144`, with a comment pointing to `docs/jev-contract.md#transport`.
- `src/extension.ts` stays a no-op.

## Review Focus

- **Cancellation racing the timeout:** the client must check the caller's signal before classifying an abort as `timeout`. Pinned by "Cancelled while waiting" and "Cancelled while the body stalls"; the reviewer reads the classification order in code (design D5).
- **Multi-byte UTF-8 split across chunks:** a streamed body must decode correctly once fully read. Task 4 decodes the joined bytes once, with a test using `"é"` repeated across a chunk boundary.
- **No trustworthy `Content-Length`:** the streamed count enforces the cap whatever the header says. Covered by "Streamed too large", which sends no `Content-Length`. A false-small header is not tested, because HTTP framing makes the client stop at the declared length and the streamed count already bounds what is read.
- **Key leakage through error reasons:** every miss reason is a fixed string or `http <status>`; the "Key never appears in a reason" test checks all miss cases in one table.
- **`__proto__` or inherited keys in `probabilities`:** key-set comparison uses `Object.keys` on own properties only; a test with `JSON.parse('{"__proto__":1,...}')` in `probabilities` must give reason `probabilities`.

---

## Contracts

| Name | new / modified | Shape | public |
|---|---|---|---|
| `MissKind` | new | `type MissKind = "timeout" \| "error" \| "schema"` in `src/policy/answers.ts` | no |
| `QuestionSpec` | new | `type QuestionSpec = { readonly type: "choice"; readonly options: readonly string[] } \| { readonly type: "noul" }` | no |
| `ChoiceAnswer` | new | `{ type: "choice"; choice: string; probabilities: Record<string, number>; confidence?: number }` | no |
| `NoulAnswer` | new | `{ type: "noul"; noul: number }` | no |
| `Answer` | new | `ChoiceAnswer \| NoulAnswer` | no |
| `UnansweredReason` | new | `"missing" \| "type" \| "choice" \| "probabilities" \| "range"` | no |
| `ReadResult` | new | `{ kind: "miss"; miss: "schema" } \| { kind: "read"; answers: Record<string, Answer>; unanswered: Record<string, UnansweredReason> }` | no |
| `readAnswers` | new | `readAnswers(specs: Readonly<Record<string, QuestionSpec>>, body: unknown): ReadResult` | no |
| `JevRequest` | new | `{ url: string; apiKey: string; model: string; timeoutMs: number; state: unknown; questions: unknown; signal?: AbortSignal }` in `src/jev/client.ts` | no |
| `JevOutcome` | new | `{ kind: "ok"; body: unknown; model?: string; ms: number } \| { kind: "miss"; miss: MissKind; reason: string; ms: number } \| { kind: "cancelled" }` | no |
| `askJev` | new | `askJev(req: JevRequest): Promise<JevOutcome>`; never rejects | no |
| `isAllowedJevUrl` | new | `isAllowedJevUrl(url: string): boolean` | no |
| `MAX_RESPONSE_BYTES` | new | `262_144` | no |

None of these is a public package API: the package exports only its Pi extension. The wire format sent to Jev is unchanged from `docs/jev-contract.md`.

Miss reasons (fixed strings): `bad url`, `bad timeout`, `bad request`, `connection`, `redirect`, `http <status>`, `too large`, `invalid json`, `timeout`.

---

## Task 1: Answer reading — implements 1.1, 1.2

**Files:**
- Create: `src/policy/answers.ts`
- Test: `tests/policy/answers.test.ts`

**Interfaces:**
- Produces: `MissKind`, `QuestionSpec`, `ChoiceAnswer`, `NoulAnswer`, `Answer`, `UnansweredReason`, `ReadResult`, `readAnswers` (see Contracts).

- [ ] **Step 1: Write the failing tests.** Use `EFFORT = { type: "choice", options: ["low","medium","high","xhigh","max"] }`, `STRATEGY = { type: "choice", options: ["direct","delegate","parallel","graph"] }`, `NOUL = { type: "noul" }`, and a helper `validEffort()` returning the spec's example answer. One `test` per scenario, named after it, for example:

```ts
test("Mixed good and bad", () => {
  const r = readAnswers({ effort: EFFORT, risky: NOUL, strategy: STRATEGY }, {
    answers: { effort: validEffort(), risky: { type: "noul", noul: 0.08 },
      strategy: { type: "choice", choice: "solo", probabilities: { direct: 1, delegate: 0, parallel: 0, graph: 0 } } },
  });
  expect(r).toEqual({ kind: "read",
    answers: { effort: { type: "choice", choice: "low", confidence: 0.73, probabilities: validEffort().probabilities },
               risky: { type: "noul", noul: 0.08 } },
    unanswered: { strategy: "choice" } });
});
```

Table-driven `test.each` for the multi-input scenarios ("Answers is not an object", "Probability out of range", "Wrong type for a choice question", "Probabilities not an object", "Noul out of range"). Add the Review Focus `__proto__` case. "Same input, same result": `structuredClone` the inputs, read twice, and assert both results are equal and the inputs equal their clones.

- [ ] **Step 2: Run `bun test tests/policy/answers.test.ts`.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement `readAnswers` in `src/policy/answers.ts`.** Check in the order type, choice, probabilities, range (design D3). A plain-object check rejects `null` and arrays. Build fresh output objects; copy only `choice`, `probabilities` (own keys) and a valid `confidence`. Ignore unasked keys. Iterate `Object.keys(specs)` and look answers up with `Object.hasOwn`, so an inherited key such as `toString` reads as `missing`.
- [ ] **Step 4: Run `bun test tests/policy/answers.test.ts`, then `bun run lint`.** Expected: PASS, with no boundary error.
- [ ] **Step 5: Commit** `feat(policy): read Jev answers per question with strict validation`.

---

## Task 2: Contract fixture — implements 2.1

**Files:**
- Create: `tests/jev/fixture.ts`

**Interfaces:**
- Produces: `startJevFixture(routes: Record<string, FixtureRoute>): Promise<JevFixture>`, where
  `FixtureRoute = { json: unknown; status?: number } | { status: number; location?: string } | { raw: string | Uint8Array; headers?: Record<string,string> } | { hang: true } | { stallAfterHeaders: true } | { streamBytes: number }` and
  `JevFixture = { url(path: string): string; requests: { method: string; path: string; headers: Record<string,string>; body: string }[]; stop(): Promise<void> }`.
  Routes are told apart by which property is present, checked in the order `hang`, `stallAfterHeaders`, `streamBytes`, `raw`, `json`, then `status`. Bun sets `Content-Length` on a `Uint8Array` `raw` body (checked on Bun 1.4.4). Unknown paths answer `404`. `streamBytes` streams that many bytes in 16 KB chunks with no `Content-Length`. `hang` never resolves. `stallAfterHeaders` sends `200` headers and one chunk `{`, then nothing. Requests are recorded before the route acts.

- [ ] **Step 1: Write `tests/jev/fixture.ts`,** binding `hostname: "127.0.0.1", port: 0`, following `tests/host/fixture.ts`. `stop()` calls `server.stop(true)` so hanging requests close.
- [ ] **Step 2: Run `bun run typecheck`.** Expected: PASS. The fixture is exercised by Task 3 to 5 tests. No separate commit; it is committed with Task 3.

---

## Task 3: Client inputs, request shape, status — implements 3.1, 3.2

**Files:**
- Create: `src/jev/client.ts`
- Test: `tests/jev/client.test.ts`

**Interfaces:**
- Consumes: `MissKind` from `src/policy/answers.ts`; `startJevFixture` from Task 2.
- Produces: `JevRequest`, `JevOutcome`, `askJev`, `isAllowedJevUrl`, `MAX_RESPONSE_BYTES`.

- [ ] **Step 1: Write the failing tests** for: "Loopback forms are accepted", "Plain HTTP to another host is rejected", "Other schemes and malformed URLs are rejected", "Invalid timeout" (`0`, `-1`, `NaN`), "Input that cannot be sent" (`state: { n: 1n }`; `apiKey: "a\nb"`), "Fixture sees the request as specified", "Connection refused" (start and stop a fixture, then reuse its URL), "Redirect is not followed" (assert `requests` has only the `/redirect` path), "Failure is not retried" (`503`, `requests.length === 1`), "Client error status" (`401`), "Server error status" (`500`). Each "no request" case asserts `fixture.requests.length === 0` and `ms === 0`. A `base()` helper builds a `JevRequest` with `apiKey: "test-key-123"`, `model: "jev-latest"`, `timeoutMs: 1500`.
- [ ] **Step 2: Run `bun test tests/jev/client.test.ts`.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `isAllowedJevUrl` (design D4) and `askJev` up to the response status: input checks first: URL, timeout, `apiKey` a string, `JSON.stringify` of the body, and `new Headers({...})` built before `fetch`, since `new Headers` throws `TypeError` on a newline in the key (checked on Bun 1.4.4). Any throw in this pre-I/O step gives `bad request` with `ms` 0, and the clock starts only after it. Everything runs inside the single outer `try`, and a `fetch` rejection without an abort gives `connection`, and `fetch` with `method: "POST"`, `redirect: "manual"` and the three headers. A 3xx gives `redirect`; another non-2xx gives `http <status>`. For a 2xx, return `ok` with `body: await res.json()` inside the same `try`, so a parse failure is still a miss. Task 4 replaces this with bounded reading.
- [ ] **Step 4: Run `bun test tests/jev/client.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(jev): client input rules, request shape and status handling` (with `tests/jev/fixture.ts`).

---

## Task 4: Body reading — implements 3.3

**Files:**
- Modify: `src/jev/client.ts`
- Test: `tests/jev/client.test.ts`

- [ ] **Step 1: Write the failing tests** for: "Successful request" (`{ model: "jev-1.14.0", answers: {} }`; assert `kind`, `body`, `model`, `typeof ms === "number"`), "Response without a model string", "Declared too large" (`raw` of 262 145 bytes, so Bun sets `Content-Length`), "Streamed too large" (`streamBytes: 300_000`), "Body at the cap" (a JSON string padded to exactly 262 144 bytes, `ok`), "Malformed JSON" (`raw: '{"answers":'`), "Empty body" (`raw: ""`), and the Review Focus UTF-8 split case.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** body reading (design D7): check `content-length` first. A `null` `res.body` is an empty body, so it gives `schema` with `invalid json`. Otherwise read `res.body` with a reader, summing chunk lengths and cancelling the reader once the sum passes `MAX_RESPONSE_BYTES` (`too large`). Decode the joined bytes with `new TextDecoder("utf-8", { fatal: true })`, then `JSON.parse`; a failure of either gives `schema` with `invalid json`. `ok.model` is set only when `body.model` is a string.
- [ ] **Step 4: Run `bun test tests/jev/client.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(jev): bounded body reading and JSON parsing`.

---

## Task 5: Timeout and cancellation — implements 3.4, 3.5

**Files:**
- Modify: `src/jev/client.ts`
- Test: `tests/jev/client.test.ts`, `tests/jev/no-timer.test.ts`, `tests/jev/no-timer-probe.ts`

- [ ] **Step 1: Write the failing tests:**
  - "Server never answers": `hang`, `timeoutMs: 200`; expect a `timeout` miss with elapsed time under 1000 ms.
  - "Body stalls after headers": `stallAfterHeaders`, `timeoutMs: 200`; expect a `timeout` miss.
  - "Already cancelled": `AbortSignal.abort()`; expect `{ kind: "cancelled" }` and zero requests.
  - "Cancelled while waiting": `hang`, abort after 50 ms, `timeoutMs: 1500`; expect `cancelled` in under 1000 ms.
  - "Cancelled while the body stalls": same with `stallAfterHeaders`.
  - "Key never appears in a reason": one self-contained `test.each` over every miss route (bad url, bad timeout, bad request, connection, redirect, `401`, `500`, too large, invalid json, timeout), each run with `apiKey: "test-key-123"`, asserting the reason does not contain the key.
  - "No timer left behind": `tests/jev/no-timer-probe.ts` starts a fixture, calls `askJev` with `timeoutMs: 60_000` on a `json` route, stops the fixture and does nothing else. `tests/jev/no-timer.test.ts` runs it with `Bun.spawnSync([process.execPath, probe], { timeout: 10_000 })` and asserts exit code `0` and elapsed time under 10 s.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement** design D5: an `AbortController` aborted by a `setTimeout(timeoutMs)`, combined with the caller's signal through `AbortSignal.any`, used for both `fetch` and the body reader. Return `cancelled` early if `signal?.aborted`. On any abort, return `cancelled` if the caller's signal is aborted, otherwise a `timeout` miss. `clearTimeout` runs in `finally`.
- [ ] **Step 4: Run `bun test tests/jev`.** Expected: PASS, with the whole directory under 10 s.
- [ ] **Step 5: Commit** `feat(jev): timeout and cancellation for Jev requests`.

---

## Task 6: Docs and checks — implements 4.1, 4.2

**Files:**
- Modify: `docs/jev-contract.md`, `docs/configuration.md`, `docs/testing.md`, `docs/roadmap.md`

- [ ] **Step 1: Update docs.**
  - `jev-contract.md` Transport: define loopback as `localhost`, `127.0.0.0/8` or `[::1]`; reject URLs with credentials; 256 KB response cap; outcomes `ok`, `miss` (`timeout`, `error`, `schema`) and `cancelled`, with non-2xx and an oversized body as `error`, and unreadable JSON as `schema`.
  - `jev-contract.md` Validation: the strict choice and noul rules, unanswered reasons, and `confidence` kept only when valid.
  - `configuration.md` `classifier.url`: the same loopback definition.
  - `testing.md` Contract row: the fixture lives in `tests/jev/fixture.ts`.
  - `roadmap.md`: WG-04 status `Done`.
- [ ] **Step 2: Run** `bun run typecheck && bun run lint && bun run fmt:check && bun run test`. Expected: all exit 0. Run `bun run fmt` first if the format check fails on new files.
- [ ] **Step 3: Commit** `docs: record Jev transport and validation rules from WG-04`.

---

## Scenario → test

Tests named after their scenario live in `tests/policy/answers.test.ts` (answer-reading) and `tests/jev/client.test.ts` (jev-transport) unless noted.

**answer-reading** (Task 1)
- Missing answers → `answers.test.ts` "Missing answers"
- Answers is not an object → "Answers is not an object" (each)
- Unasked key ignored → "Unasked key ignored"
- Asked key absent → "Asked key absent"
- Valid choice → "Valid choice"
- Unknown choice → "Unknown choice"
- Missing probability key → "Missing probability key"
- Extra probability key → "Extra probability key"
- Probability out of range → "Probability out of range" (each)
- Wrong type for a choice question → "Wrong type for a choice question" (each)
- Probabilities not an object → "Probabilities not an object" (each)
- Valid noul at a boundary → "Valid noul at a boundary"
- Noul out of range → "Noul out of range" (each)
- Wrong type for a noul question → "Wrong type for a noul question"
- Mixed good and bad → "Mixed good and bad"
- Confidence absent → "Confidence absent"
- Confidence invalid → "Confidence invalid"
- Same input, same result → "Same input, same result"

**jev-transport**
- Successful request → "Successful request" (Task 4)
- Response without a model string → "Response without a model string" (Task 4)
- Input that cannot be sent → "Input that cannot be sent" (Task 3)
- Connection refused → "Connection refused" (Task 3)
- Key never appears in a reason → "Key never appears in a reason" (Task 5)
- Fixture sees the request as specified → same name (Task 3)
- Loopback forms are accepted → same name (Task 3)
- Plain HTTP to another host is rejected → same name (Task 3)
- Other schemes and malformed URLs are rejected → same name (Task 3)
- Redirect is not followed → same name (Task 3)
- Failure is not retried → same name (Task 3)
- Client error status → same name (Task 3)
- Server error status → same name (Task 3)
- Server never answers → same name (Task 5)
- Body stalls after headers → same name (Task 5)
- Invalid timeout → same name (Task 3)
- No timer left behind → `tests/jev/no-timer.test.ts` "No timer left behind" (Task 5)
- Already cancelled → same name (Task 5)
- Cancelled while waiting → same name (Task 5)
- Cancelled while the body stalls → same name (Task 5)
- Declared too large → same name (Task 4)
- Streamed too large → same name (Task 4)
- Body at the cap → same name (Task 4)
- Malformed JSON → same name (Task 4)
- Empty body → same name (Task 4)

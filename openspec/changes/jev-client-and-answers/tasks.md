## 1. Answer reading

- [ ] 1.1 Add `src/policy/answers.ts` with the shared types (`MissKind`, `QuestionSpec`, `Answer`, `UnansweredReason`, `ReadResult`) and `readAnswers`, covering the envelope check, unasked and missing keys, and strict choice and noul rules with confidence carried (specs/answer-reading)
- [ ] 1.2 Unit tests in `tests/policy/answers.test.ts` for every answer-reading scenario, including mixed good and bad answers and purity

## 2. Contract fixture

- [ ] 2.1 Add `tests/jev/fixture.ts`: a `Bun.serve` server on `127.0.0.1` with per-path scripted behaviours (JSON reply, status, redirect, hang, stall after headers, oversized declared and streamed body, raw body), recording each request's method, path, headers and body

## 3. Jev client

- [ ] 3.1 Add `src/jev/client.ts` with `MAX_RESPONSE_BYTES`, `isAllowedJevUrl`, and input checks (URL, timeout, serialisable body, sendable key), each giving an `error` miss with `ms` 0 and no request (design D4, D5)
- [ ] 3.2 Request shape, status and redirect handling: one `POST` with `redirect: "manual"`, non-2xx is `error`, and no retry (design D6, D8)
- [ ] 3.3 Body reading: size cap by `Content-Length` and by streamed count, then JSON parse, where invalid JSON or an empty body is `schema`, and `ok` carries `model` (design D7)
- [ ] 3.4 Timeout and cancellation through `AbortSignal.any`, with cancellation taking precedence and the timer cleared in `finally` (design D5)
- [ ] 3.5 Contract tests in `tests/jev/client.test.ts` for every jev-transport scenario, plus a subprocess test proving no timer is left pending

## 4. Docs and checks

- [ ] 4.1 Update `docs/jev-contract.md` (Transport: loopback forms, size cap, outcome kinds; Validation: strict rules, malformed JSON as `schema`), `docs/configuration.md` (`classifier.url` loopback forms), `docs/testing.md` (contract fixture location) and `docs/roadmap.md` (WG-04 status)
- [ ] 4.2 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun run test`, all passing

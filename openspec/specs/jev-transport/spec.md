# jev-transport Specification

## Purpose
One Jev request over HTTPS or loopback, with no redirect or retry, a timeout, caller cancellation and a size cap, always reported as an `ok`, `miss` or `cancelled` value so a Jev failure never breaks a turn.

## Requirements

### Requirement: Outcome is always a value
The Jev client SHALL report every request as exactly one of `ok`, `miss` or `cancelled`, and MUST NOT throw or reject for any network, HTTP, timing, parsing or input failure. A `miss` MUST carry a kind of `timeout`, `error` or `schema`, the elapsed milliseconds (`0` when no request was sent), and a short reason that contains neither the API key, request headers nor response body.

#### Scenario: Successful request
- **WHEN** the fixture answers `200` with a JSON object body that includes `"model": "jev-1.14.0"`
- **THEN** the outcome is `ok` with the parsed body, `model` equal to `jev-1.14.0`, and the elapsed milliseconds

#### Scenario: Response without a model string
- **WHEN** the fixture answers `200` with `{"answers":{}}`
- **THEN** the outcome is `ok` with no `model` value

#### Scenario: Input that cannot be sent
- **WHEN** `state` cannot be serialised as JSON (it holds a `BigInt`), or `apiKey` contains a newline
- **THEN** the outcome is `miss` with kind `error` and `ms` `0`, the call does not reject, and the fixture records no request

#### Scenario: Connection refused
- **WHEN** the URL points at a loopback port with no listener
- **THEN** the outcome is `miss` with kind `error`, and the call does not throw

#### Scenario: Key never appears in a reason
- **WHEN** any request ends in a `miss`
- **THEN** its reason does not contain the API key string

### Requirement: Request shape
The client SHALL send one `POST` to the given URL with `Authorization: Bearer <apiKey>`, `Content-Type: application/json`, `Accept: application/json`, and a JSON body containing exactly the keys `model`, `state` and `questions`, taken from its inputs.

#### Scenario: Fixture sees the request as specified
- **WHEN** the client sends a request with model `jev-latest`, a state object and a questions object
- **THEN** the fixture records method `POST`, the bearer header with the given key, `Content-Type: application/json`, `Accept: application/json`, and a body whose keys are exactly `model`, `state` and `questions` with the given values

### Requirement: URL must be HTTPS or loopback
The URL rule, exported as `isAllowedJevUrl`, SHALL accept an `https:` URL, or an `http:` URL whose parsed hostname is `localhost`, an IPv4 address in `127.0.0.0/8`, or `[::1]`. The check MUST run on the WHATWG-parsed hostname. It MUST reject every other URL, an unparseable URL, and a URL carrying a username or password, and the client MUST report a rejected URL as `miss` with kind `error`, without sending any request.

#### Scenario: Loopback forms are accepted
- **WHEN** `isAllowedJevUrl` checks `http://127.0.0.1:1/`, `http://127.5.6.7/`, `http://127.1/`, `http://[::1]:1/`, `http://localhost:1/` and `https://api.typesafe.ai/v1/systemone`
- **THEN** each is accepted

#### Scenario: Plain HTTP to another host is rejected
- **WHEN** the client is given `http://example.com/v1/systemone`
- **THEN** the outcome is `miss` with kind `error`, and no request is made

#### Scenario: Other schemes and malformed URLs are rejected
- **WHEN** `isAllowedJevUrl` checks `ftp://127.0.0.1/`, `http://10.0.0.1/`, `http://user:pw@127.0.0.1/`, `https://user:pw@api.typesafe.ai/` and `not a url`
- **THEN** each is rejected

### Requirement: No redirects and no retry
The client SHALL NOT follow a redirect: a `3xx` response MUST be a `miss` with kind `error`. The client MUST send at most one HTTP request per call, whatever the outcome.

#### Scenario: Redirect is not followed
- **WHEN** the fixture answers `302` with a `Location` header pointing at another fixture path
- **THEN** the outcome is `miss` with kind `error`, and the fixture records no request to the redirect target

#### Scenario: Failure is not retried
- **WHEN** the fixture answers `503`
- **THEN** the fixture records exactly one request

### Requirement: Non-success status is a miss
The client SHALL report any response status outside `200`–`299` as `miss` with kind `error`.

#### Scenario: Client error status
- **WHEN** the fixture answers `401`
- **THEN** the outcome is `miss` with kind `error`

#### Scenario: Server error status
- **WHEN** the fixture answers `500`
- **THEN** the outcome is `miss` with kind `error`

### Requirement: Timeout aborts the request
The client SHALL abort the request when `timeoutMs` elapses before the response body has been fully read, and report `miss` with kind `timeout`. It MUST return within a small margin of `timeoutMs`, and MUST NOT keep a timer pending after it returns. A `timeoutMs` that is not a positive finite number MUST be a `miss` with kind `error`, without sending a request.

#### Scenario: Server never answers
- **WHEN** the fixture holds the request open and `timeoutMs` is 200
- **THEN** the outcome is `miss` with kind `timeout`, returned well before 1000 ms

#### Scenario: Body stalls after headers
- **WHEN** the fixture sends `200` headers and then stops sending the body, with `timeoutMs` 200
- **THEN** the outcome is `miss` with kind `timeout`

#### Scenario: Invalid timeout
- **WHEN** `timeoutMs` is `0`, negative, or `NaN`
- **THEN** the outcome is `miss` with kind `error`, and no request is made

#### Scenario: No timer left behind
- **WHEN** a request with `timeoutMs` 60000 returns `ok` early
- **THEN** every timer the client scheduled has been cleared by the time it returns

### Requirement: Cancellation stops everything
The client SHALL accept the caller's `AbortSignal`. If the signal is already aborted, the outcome MUST be `cancelled` and no request is sent. If the signal aborts during the exchange, the request MUST be aborted and the outcome MUST be `cancelled`, never a `miss`.

#### Scenario: Already cancelled
- **WHEN** the caller's signal is aborted before the call
- **THEN** the outcome is `cancelled`, and the fixture records no request

#### Scenario: Cancelled while waiting
- **WHEN** the fixture holds the request open and the caller aborts after 50 ms, with `timeoutMs` 1500
- **THEN** the outcome is `cancelled`, returned well before 1500 ms

#### Scenario: Cancelled while the body stalls
- **WHEN** the fixture sends `200` headers and then stops sending the body, and the caller aborts after 50 ms, with `timeoutMs` 1500
- **THEN** the outcome is `cancelled`

### Requirement: Response size is capped
The client SHALL reject a response body larger than 262 144 bytes as `miss` with kind `error`, whether the size is declared by `Content-Length` or found while reading, and MUST stop reading once the cap is passed.

#### Scenario: Declared too large
- **WHEN** the fixture answers `200` with a `Content-Length` above 262 144
- **THEN** the outcome is `miss` with kind `error`

#### Scenario: Streamed too large
- **WHEN** the fixture streams a body above 262 144 bytes without `Content-Length`
- **THEN** the outcome is `miss` with kind `error`

#### Scenario: Body at the cap
- **WHEN** the fixture answers with a valid JSON body of exactly 262 144 bytes
- **THEN** the outcome is `ok`

### Requirement: Unreadable body is a schema miss
The client SHALL report a `2xx` response whose body is not valid UTF-8 JSON as `miss` with kind `schema`.

#### Scenario: Malformed JSON
- **WHEN** the fixture answers `200` with the body `{"answers":`
- **THEN** the outcome is `miss` with kind `schema`

#### Scenario: Empty body
- **WHEN** the fixture answers `200` with an empty body
- **THEN** the outcome is `miss` with kind `schema`

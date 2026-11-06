## MODIFIED Requirements

### Requirement: Classifier field rules
Every `classifier` field SHALL be optional and MUST follow these rules: `url` is accepted exactly when the Jev client's URL rule `isAllowedJevUrl` accepts it (`https:`, or `http:` whose parsed hostname is `localhost`, an IPv4 address in `127.0.0.0/8` or `[::1]`, with no username or password), and the validator MUST use that same function rather than a copy; `model` is 1–64 characters of letters, digits, `.`, `_`, `-`; `apiKeyEnv` matches `^[A-Z_][A-Z0-9_]{0,63}$`; `timeoutMs` is an integer from 300 to 5000.

#### Scenario: Remote http URL rejected
- **WHEN** `classifier.url` is `http://example.com/v1`
- **THEN** the read is invalid with a problem at `classifier.url`

#### Scenario: Loopback http URL accepted
- **WHEN** `classifier.url` is `http://127.0.0.1:8080/v1`
- **THEN** the read is valid

#### Scenario: Whole loopback range accepted
- **WHEN** `classifier.url` is `http://127.5.6.7/v1` in one read and `http://127.1/v1` in another
- **THEN** both reads are valid

#### Scenario: Config and client agree
- **WHEN** each of `http://127.0.0.1:1/`, `http://127.5.6.7/`, `http://127.1/`, `http://[::1]:1/`, `http://localhost:1/`, `https://api.typesafe.ai/v1/systemone`, `ftp://127.0.0.1/`, `http://10.0.0.1/`, `http://user:pw@127.0.0.1/`, `https://user:pw@api.typesafe.ai/`, `not a url` and `http://example.com/v1` is checked by the config validator and by `isAllowedJevUrl`
- **THEN** the config read is valid exactly for the URLs `isAllowedJevUrl` accepts

#### Scenario: Other scheme rejected
- **WHEN** `classifier.url` is `ftp://127.0.0.1/v1`
- **THEN** the read is invalid with a problem at `classifier.url`

#### Scenario: URL with credentials rejected
- **WHEN** `classifier.url` is `https://user:pass@api.typesafe.ai/v1`
- **THEN** the read is invalid with a problem at `classifier.url`

#### Scenario: Timeout bounds
- **WHEN** `classifier.timeoutMs` is `300`, `5000`, `299`, `5001` or `1500.5` in five separate reads
- **THEN** the first two are valid and the last three are invalid at `classifier.timeoutMs`

#### Scenario: Key-shaped apiKeyEnv rejected
- **WHEN** `classifier.apiKeyEnv` is `"sk-test-0123456789abcdef"`
- **THEN** the read is invalid with a problem at `classifier.apiKeyEnv`

# config-file Specification

## Purpose
The operator's `config.json` is validated strictly, with every problem reported by field path and no value echoed, and is written only by the slot writer, which replaces `crew.slots` and keeps every other key.

## Requirements

### Requirement: Config is validated as a whole
Reading `config.json` SHALL return either a valid config or the full list of problems, each with the field path (dot and index notation, `""` for the whole file) and what was expected. An invalid result MUST carry no config values, so a caller cannot act on part of a malformed file. A read MUST collect every problem, not only the first. Problem messages MUST NOT include the value found, so a secret in the file never reaches a message.

#### Scenario: Valid full example
- **WHEN** `config.json` holds the full example from `docs/configuration.md`
- **THEN** the read is valid and returns those values

#### Scenario: Several problems reported together
- **WHEN** `config.json` has `classifier.timeoutMs` set to `100` and `crew.slots[0].name` set to `"Reviewer"`
- **THEN** the read is invalid with two problems, at `classifier.timeoutMs` and `crew.slots[0].name`

#### Scenario: Invalid result has no values
- **WHEN** `config.json` has a valid `tiers.fast` and an invalid `classifier.timeoutMs`
- **THEN** the read is invalid and returns problems only, no `tiers.fast`

#### Scenario: Bad JSON
- **WHEN** `config.json` is not valid JSON
- **THEN** the read is invalid with one problem at path `""`

#### Scenario: Section of the wrong type
- **WHEN** `classifier` is `"x"` in one read and `null` in another
- **THEN** each read is invalid with a problem at `classifier`

#### Scenario: Top level is not an object
- **WHEN** `config.json` holds a JSON array
- **THEN** the read is invalid with one problem at path `""`

#### Scenario: Value is not echoed
- **WHEN** `classifier.apiKeyEnv` holds `"sk-test-0123456789abcdef"`
- **THEN** the problem at `classifier.apiKeyEnv` does not contain that string

#### Scenario: Unreadable file
- **WHEN** `config.json` exists but cannot be read
- **THEN** the read is invalid with one problem at path `""` naming the error code, and nothing is thrown

### Requirement: Missing config means defaults
A missing `config.json` SHALL read as valid and empty, marked as not present, so every setting takes its default.

#### Scenario: No file
- **WHEN** the jev directory has no `config.json`
- **THEN** the read is valid, marked not present, with no settings

### Requirement: Unknown keys are rejected
Every key that `docs/configuration.md` does not define SHALL be a problem at its own path, at every level. This rejects an API key put into the file, under any name.

#### Scenario: Secret-like key
- **WHEN** `config.json` has `classifier.apiKey`
- **THEN** the read is invalid with a problem at `classifier.apiKey`

#### Scenario: Typo
- **WHEN** `config.json` has `classifier.timeoutMS`
- **THEN** the read is invalid with a problem at `classifier.timeoutMS`

#### Scenario: Unknown section
- **WHEN** `config.json` has a top-level `token` key
- **THEN** the read is invalid with a problem at `token`

#### Scenario: Prototype key
- **WHEN** `config.json` has a top-level `__proto__` key
- **THEN** the read is invalid with a problem at `__proto__`, and no object prototype is changed

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

### Requirement: Tier and slot field rules
Each of `tiers.fast`, `tiers.balanced`, `tiers.deep` and `tiers.expert` SHALL be optional and, when set, MUST be an exact `provider/id` of at most 128 characters with no whitespace. `crew.slots` MUST have at most 8 entries; each needs a unique `name` matching `^[a-z][a-z0-9-]{0,23}$` that is not a reserved word from `docs/configuration.md`, a `model` as an exact `provider/id`, and a `when` of 1–500 characters after trimming. A slot without `when` MUST be invalid; there is no default `when`.

#### Scenario: Tier without provider rejected
- **WHEN** `tiers.fast` is `"claude-haiku-5-5"`
- **THEN** the read is invalid with a problem at `tiers.fast`

#### Scenario: Unknown tier rejected
- **WHEN** `tiers` has a key `ultra`
- **THEN** the read is invalid with a problem at `tiers.ultra`

#### Scenario: Model too long
- **WHEN** `tiers.deep` is a `provider/id` of 129 characters
- **THEN** the read is invalid with a problem at `tiers.deep`

#### Scenario: Slot when bounds
- **WHEN** a slot's `when` is only spaces in one read and 501 characters in another
- **THEN** each read is invalid with a problem at that slot's `when`

#### Scenario: Too many slots
- **WHEN** `crew.slots` has 9 valid entries
- **THEN** the read is invalid with a problem at `crew.slots`

#### Scenario: Reserved slot name
- **WHEN** a slot is named `review`
- **THEN** the read is invalid with a problem at that slot's `name`

#### Scenario: Duplicate slot name
- **WHEN** two slots are both named `reviewer`
- **THEN** the read is invalid with a problem at the second slot's `name`

#### Scenario: Slot without model
- **WHEN** a slot has a `name` but no `model`
- **THEN** the read is invalid with a problem at that slot's `model`

#### Scenario: Slot without when
- **WHEN** a slot has a `name` and a `model` but no `when`
- **THEN** the read is invalid with a problem at that slot's `when`

#### Scenario: Slot writer refuses a slot without when
- **WHEN** the slot writer is given a slot with no `when`
- **THEN** it returns a problem at that slot's `when` and the file is unchanged

### Requirement: Other field rules
These fields SHALL be optional and MUST follow these rules: `effort.holdProviders` is up to 32 unique provider names of 1–64 characters from letters, digits, `.`, `_`, `-`; `skills.inject` is `content` or `suggest`; `tools.mode` is `observe` or `enforce`; `state.parentRequest` is a boolean; `review.cli` is `codex` or `opencode`; `subagents.forkedLaunch` is `untouched` or `thinking`.

#### Scenario: Duplicate hold provider
- **WHEN** `effort.holdProviders` is `["9router", "9router"]`
- **THEN** the read is invalid with a problem at `effort.holdProviders[1]`

#### Scenario: Hold provider bounds
- **WHEN** `effort.holdProviders` has 33 unique names in one read, and holds `"bad name"` in another
- **THEN** the first read is invalid at `effort.holdProviders` and the second at `effort.holdProviders[0]`

#### Scenario: Non-boolean parentRequest
- **WHEN** `state.parentRequest` is `"yes"`
- **THEN** the read is invalid with a problem at `state.parentRequest`

#### Scenario: Enum values
- **WHEN** `skills.inject` is `"full"`, `tools.mode` is `"remove"` and `review.cli` is `"claude"`
- **THEN** the read is invalid with problems at `skills.inject`, `tools.mode` and `review.cli`

#### Scenario: Forked launch setting accepted
- **WHEN** `subagents.forkedLaunch` is `"thinking"`
- **THEN** the read is valid and returns that value

#### Scenario: Forked launch setting rejected
- **WHEN** `subagents.forkedLaunch` is `"skip"` in one read, and `subagents` holds an unknown key `inheritContext` in another
- **THEN** the first read is invalid at `subagents.forkedLaunch` and the second at `subagents.inheritContext`

### Requirement: Invalid config is never written
No store operation SHALL write `config.json` while its current content is invalid, and no store operation other than the slot writer MUST write it at all.

#### Scenario: Read leaves the file untouched
- **WHEN** an invalid `config.json` is read
- **THEN** its bytes and modification time are unchanged

#### Scenario: Slot writer refuses an invalid file
- **WHEN** the slot writer runs while `config.json` is invalid
- **THEN** it returns the file's problems and the file is unchanged

### Requirement: Slot writer replaces only crew.slots
The slot writer SHALL validate the new slot list against the rules for `crew.slots` and, if valid, replace only `crew.slots` in the current config and write the file atomically. Every other key and value MUST be kept, in its original order. An absent `crew` MUST be added as the last top-level key. An empty list MUST remove `crew.slots`, and `crew` once it is empty. A missing `config.json` MUST be created holding only the slots.

#### Scenario: Other keys kept
- **WHEN** the slot writer adds a slot to the full example config
- **THEN** a new read returns the same values for every key other than `crew.slots`, in the same key order, and the new slot list

#### Scenario: Invalid new slot refused
- **WHEN** the slot writer is given a slot named `all`
- **THEN** it returns a problem at that slot's `name` and the file is unchanged

#### Scenario: New crew key goes last
- **WHEN** `config.json` holds `classifier` and `review` and no `crew`, and the slot writer is given one valid slot
- **THEN** the written top-level keys are `classifier`, `review`, `crew` in that order

#### Scenario: Last slot removed
- **WHEN** the slot writer is given an empty list and `crew` holds only `slots`
- **THEN** the written config has no `crew` key

#### Scenario: Created from nothing
- **WHEN** there is no `config.json` and the slot writer is given one valid slot
- **THEN** `config.json` is created with mode `0600`, holding only `crew.slots` with that slot

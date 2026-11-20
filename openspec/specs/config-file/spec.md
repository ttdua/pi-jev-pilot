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
- **WHEN** `config.json` has a valid `tiers.basic` and an invalid `classifier.timeoutMs`
- **THEN** the read is invalid and returns problems only, no `tiers.basic`

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
Every `classifier` field SHALL be optional and MUST follow these rules: `url` is accepted exactly when the Jev client's URL rule `isAllowedJevUrl` accepts it (`https:`, or `http:` whose parsed hostname is `localhost`, an IPv4 address in `127.0.0.0/8` or `[::1]`, with no username or password), and the validator MUST use that same function rather than a copy; `model` is 1–128 characters of letters, digits, `.`, `_`, `-`, `:`, `/`, not starting with `-`, `:` or `/` (the classifier's own rule, independent of the other model fields); `apiKeyEnv` matches `^[A-Z_][A-Z0-9_]{0,63}$`; `timeoutMs` is an integer from 300 to 5000.

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

#### Scenario: Router-style model accepted
- **WHEN** `classifier.model` is each of `jev-latest`, `jev-1.14.0`, `openrouter/perplexity/pplx-decider-v1.3:free`, `.`, `_` and `default` in separate reads
- **THEN** every read is valid and keeps the id unchanged

#### Scenario: Model length bound
- **WHEN** `classifier.model` is 128 `a` characters in one read and 129 `a` characters in another
- **THEN** the first read is valid and the second is invalid with a problem at `classifier.model`

#### Scenario: Malformed model rejected
- **WHEN** `classifier.model` is each of `""`, `/jev`, `-jev`, `:jev`, `jev latest`, `jev` followed by a tab and `latest`, `jev-latest` followed by a newline, `key=abc` and `jev"x` in separate reads
- **THEN** each read is invalid with a problem at `classifier.model`

### Requirement: Tier and slot field rules
Each of `tiers.basic`, `tiers.broad`, `tiers.deep` and `tiers.frontier` SHALL be optional and, when set, MUST be an exact `provider/id` of at most 128 characters with no whitespace. For one minor release, `tiers.fast`, `tiers.balanced` and `tiers.expert` SHALL be accepted, under the same rule, as deprecated aliases of `tiers.basic`, `tiers.broad` and `tiers.frontier`. A valid read that used an alias SHALL return the value under the new key, together with one deprecation notice per alias naming the new key; the `/jev` status SHALL show it. When an alias and its new key are both present, the read MUST be invalid, with a problem at the alias. `frontier` joins the reserved slot names in `docs/configuration.md`. A slot named `frontier` already in `config.json` (valid before this rename) MUST still be accepted on read and routed, with a deprecation notice asking to rename it; the slot writer MUST refuse a new slot named `frontier`, and MUST refuse any write that keeps an existing `frontier` slot, with a problem at that slot's `name` asking to rename it (see `slot-commands` for what the commands do meanwhile). `crew.slots` MUST have at most 8 entries; each needs a unique `name` matching `^[a-z][a-z0-9-]{0,23}$` that is not a reserved word from `docs/configuration.md`, a `model` as an exact `provider/id`, and a `when` of 1–500 characters after trimming. A slot without `when` MUST be invalid; there is no default `when`.

#### Scenario: Tier without provider rejected
- **WHEN** `tiers.basic` is `"claude-haiku-5-5"`
- **THEN** the read is invalid with a problem at `tiers.basic`

#### Scenario: Unknown tier rejected
- **WHEN** `tiers` has a key `ultra`
- **THEN** the read is invalid with a problem at `tiers.ultra`

#### Scenario: Model too long
- **WHEN** `tiers.deep` is a `provider/id` of 129 characters
- **THEN** the read is invalid with a problem at `tiers.deep`

#### Scenario: Deprecated tier key accepted
- **WHEN** `tiers.fast` is `"fixture/fixture-basic"` and `tiers.basic` is absent
- **THEN** the read is valid, returns `tiers.basic` `fixture/fixture-basic` and no `tiers.fast`, and carries a deprecation notice naming `tiers.basic`

#### Scenario: Every deprecated tier key
- **WHEN** `tiers` holds `fast`, `balanced`, `deep` and `expert`
- **THEN** the read is valid, returns `basic`, `broad`, `deep` and `frontier`, and carries three deprecation notices

#### Scenario: Alias and new key both present
- **WHEN** `tiers` holds both `expert` and `frontier`
- **THEN** the read is invalid with a problem at `tiers.expert`, and no config value is returned

#### Scenario: Existing frontier slot still read
- **WHEN** `crew.slots` holds a valid slot named `frontier`
- **THEN** the read is valid, the slot is returned and offered as `slot::frontier`, and a deprecation notice asks to rename it

#### Scenario: New frontier slot refused
- **WHEN** the slot writer is given a slot named `frontier`
- **THEN** it returns a problem at that slot's `name` and the file is unchanged

#### Scenario: Invalid alias value
- **WHEN** `tiers.balanced` is `"claude-sonnet"`
- **THEN** the read is invalid with a problem at `tiers.balanced`

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

### Requirement: Invalid config is never written
No store operation SHALL write `config.json` while its current content is invalid, and no store operation other than the slot writer and the legacy tier migration MUST write it at all.

#### Scenario: Read leaves the file untouched
- **WHEN** an invalid `config.json` is read
- **THEN** its bytes and modification time are unchanged

#### Scenario: Slot writer refuses an invalid file
- **WHEN** the slot writer runs while `config.json` is invalid
- **THEN** it returns the file's problems and the file is unchanged

#### Scenario: Migration refuses an invalid file
- **WHEN** `config.json` holds `tiers.fast` and an invalid `classifier.timeoutMs`, and the migration runs
- **THEN** the file is unchanged

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

### Requirement: Optional field rules
These fields SHALL be optional and MUST follow these rules:
- `effort.holdProviders` is up to 32 unique provider names of 1–64 characters from letters, digits, `.`, `_`, `-`;
- `skills.inject` is `content` or `suggest`;
- `state.parentRequest` is a boolean;
- `review.cli` is `codex` or `opencode`;
- `review.enabled` is a boolean;
- `subagents.forkLaunch` is `untouched` or `thinking`.

For one minor release, `subagents.forkedLaunch` SHALL be accepted, under the same rule, as a deprecated alias of `subagents.forkLaunch`. A valid read that used the alias SHALL return the value as `subagents.forkLaunch`, together with a deprecation notice naming `subagents.forkLaunch`. The `/jev` status SHALL show that notice. When both keys are present, the whole read MUST be invalid, with a problem at `subagents.forkedLaunch`, as for any other invalid config.

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
- **WHEN** `skills.inject` is `"full"` and `review.cli` is `"claude"`
- **THEN** the read is invalid with problems at `skills.inject` and `review.cli`

#### Scenario: CLI review enabled accepted
- **WHEN** `review` is `{"cli":"opencode","enabled":true}`
- **THEN** the read is valid and returns those values

#### Scenario: Non-boolean review.enabled
- **WHEN** `review.enabled` is `"on"`
- **THEN** the read is invalid with a problem at `review.enabled`

#### Scenario: Forked launch setting accepted
- **WHEN** `subagents.forkLaunch` is `"thinking"`
- **THEN** the read is valid and returns that value

#### Scenario: Forked launch setting rejected
- **WHEN** `subagents.forkLaunch` is `"skip"` in one read, and `subagents` holds an unknown key `inheritContext` in another
- **THEN** the first read is invalid at `subagents.forkLaunch` and the second at `subagents.inheritContext`

#### Scenario: Deprecated forkedLaunch accepted
- **WHEN** `subagents.forkedLaunch` is `"thinking"` and `subagents.forkLaunch` is absent
- **THEN** the read is valid, returns `forkLaunch` `thinking`, and carries a deprecation notice naming `subagents.forkLaunch`

#### Scenario: Both keys present
- **WHEN** `subagents` holds both `forkLaunch` and `forkedLaunch`
- **THEN** the read is invalid with a problem at `subagents.forkedLaunch`, and no config value is returned

### Requirement: Deprecated tools section
A top-level `tools` key, left from the removed tool assessment, SHALL be accepted with any value. It MUST NOT make the read invalid and MUST NOT contribute any setting. The read SHALL report `tools` as deprecated so `/jev` can name it.

#### Scenario: Deprecated tools section ignored
- **WHEN** `config.json` holds `{"tools":{"mode":"enforce","grantAt":0.9}}`
- **THEN** the read is valid, returns no `tools` setting and reports `tools` as deprecated

#### Scenario: Deprecated tools section of any shape
- **WHEN** `tools.grantAt` is `0.3` in one read, `"high"` in another, and `tools` is `true` in a third
- **THEN** all three reads are valid and report `tools` as deprecated

#### Scenario: No tools section, nothing deprecated
- **WHEN** `config.json` has no `tools` key
- **THEN** the read reports nothing deprecated

### Requirement: Legacy tier migration
At every main `session_start`, before the status line is drawn, the package SHALL rewrite a valid `config.json` holding a legacy tier key atomically, with each alias renamed to its new key in place and every other key, value, order and the file mode kept. It SHALL rewrite a valid `state.json` holding `switches.expert` through the state store. A slot named `frontier` MUST NOT be renamed.

#### Scenario: Config migrated at start
- **WHEN** `config.json` holds `classifier`, then `tiers` `{"fast":"a/x","deep":"a/y","expert":"a/z"}`, and a main session starts
- **THEN** `config.json` holds `classifier`, then `tiers` `{"basic":"a/x","deep":"a/y","frontier":"a/z"}`, its mode is unchanged, and one notification names `tiers.fast → tiers.basic` and `tiers.expert → tiers.frontier`

#### Scenario: State migrated at start
- **WHEN** `state.json` holds `{"version":1,"switches":{"expert":false,"skills":false}}` and a main session starts
- **THEN** `state.json` holds `switches` `{"skills":false,"frontier":false}` and no `expert`

#### Scenario: Legacy frontier slot kept
- **WHEN** `config.json` holds `tiers.fast` and a slot named `frontier`, and a main session starts
- **THEN** `tiers.fast` becomes `tiers.basic`, the `frontier` slot is unchanged, and its rename notice remains

### Requirement: Legacy tier migration safety
The migration MUST NOT run in a child session, MUST make no network call, and MUST NOT write a file that needs no change or is invalid. A write failure MUST be swallowed; the session starts, the aliases keep working on read, and the next main `session_start` tries again. After a config rewrite the package SHALL show one info notification naming the renamed keys and the path, when a UI is present.

#### Scenario: Nothing to migrate
- **WHEN** `config.json` uses only the new tier names and `state.json` has no `switches.expert`, and a main session starts
- **THEN** neither file's bytes nor modification time change, and no notification is shown

#### Scenario: Conflicting keys left alone
- **WHEN** `config.json` holds both `tiers.expert` and `tiers.frontier`, and a main session starts
- **THEN** `config.json` is unchanged and `/jev` reports the problem at `tiers.expert`

#### Scenario: Write failure
- **WHEN** `config.json` holds `tiers.fast`, the jev directory is read-only, and a main session starts
- **THEN** the session starts, routing uses the `tiers.fast` model as `basic`, and no error reaches Pi

#### Scenario: Child session
- **WHEN** a worker's child session starts while `config.json` holds `tiers.fast`
- **THEN** `config.json` is unchanged by that session

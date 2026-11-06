## Context

`src/` holds only a no-op `extension.ts`. `docs/architecture.md` places files and schemas in `store/`, and lint forbids `store/` from importing Pi, `host/`, `jev/` or `policy/`. Pi exposes `getAgentDir()` publicly; it reads `PI_CODING_AGENT_DIR` on every call. The scope and the operator's choices are in `brainstorm.md`. This document covers how.

## Goals / Non-Goals

**Goals:**
- One typed, validated read of `config.json` and `state.json`, with every problem tied to a field path.
- Writes that never leave a half-written file and never write a malformed `config.json`.
- Effective settings from one function, so precedence is defined once.

**Non-Goals:**
- `/jev` commands, the status line, and showing errors to the operator (WG-06). The store returns the errors; WG-06 displays them.
- Checking that a model exists or has credentials: that needs `ctx.modelRegistry`, so it lives in `host/` (WG-11, WG-13).
- `tuning.json` and `ledger.jsonl` (WG-18, WG-05).
- Locking between Pi processes.

## Decisions

### D1. Synchronous file I/O

The stores use `node:fs` sync calls. The files are a few kilobytes, read at session start and written on a typed command. Sync calls keep read-modify-write steps free of interleaving inside one process, with no measurable cost.

### D2. Path in, no Pi in `store/`

Every store function takes the jev directory as a plain string. `src/host/stores.ts` computes it with `join(getAgentDir(), "jev")` at call time. Tests pass a temp directory and never touch `~/.pi`. The alternative, `store/` reading `PI_CODING_AGENT_DIR` itself, would copy Pi's tilde and default rules and drift from them.

### D3. Results, not exceptions

Reads return a discriminated union, so a caller cannot forget the inert case:
- config: `ok`, or `invalid` with a list of issues and no values;
- state: `ok`, `missing`, `malformed`, or `unreadable`.

Writes return `{ ok: true }` or `{ ok: false, issues }`. That covers both validation failures and I/O failures (an issue at `""` naming the error code). Nothing in `store/` throws to its caller. Parsing uses `JSON.parse` and then checks keys with `Object.hasOwn` against the known set, so `__proto__` is just an unknown key and is never assigned through.

An issue is `{ path, message }`. `path` uses dot and index notation, such as `crew.slots[2].name`, or `""` for the whole file. **Messages name the field and what was expected, never the value found**, so a secret pasted into the wrong key cannot end up in a log or on the status line. I/O errors such as `EACCES` become an issue at `""` naming the error code. They are not thrown.

### D4. Hand-written validator

`store/validate.ts` has small combinators: object with a known key set, string with a pattern, integer in a range, enum, boolean, array with a bound. Each one collects issues with paths and does not stop at the first, so the operator sees every problem at once. An unknown key is an issue at its own path. Validated objects are rebuilt from known keys only, so the result never carries an unchecked field.

Field rules come from `docs/configuration.md`. A few are new and recorded here:

| Field | Rule |
|---|---|
| `classifier.url` | Parses as a URL; `https:`, or `http:` with host `127.0.0.1`, `localhost` or `[::1]`; no username or password |
| `classifier.model` | `^[A-Za-z0-9._-]{1,64}$` |
| `classifier.apiKeyEnv` | `^[A-Z_][A-Z0-9_]{0,63}$`, so a pasted key fails |
| `classifier.timeoutMs` | Integer 300–5000 |
| `tiers.<tier>`, `crew.slots[].model` | `^[A-Za-z0-9._-]+/[^\s]+$`, at most 128 characters |
| `crew.slots` | At most 8; names unique, `^[a-z][a-z0-9-]{0,23}$`, not reserved |
| `crew.slots[].when` | 1–500 characters after trim |
| `effort.holdProviders` | Array of up to 32 unique `^[A-Za-z0-9._-]{1,64}$` |

Rejecting unknown keys covers "a key found in config is rejected": no known key holds a secret, and `apiKeyEnv`'s pattern rejects key-shaped values.

### D5. Missing `config.json` means defaults

The usage guide says every setting has a default, and the package is inert without a key anyway. A missing file reads as `ok`, with `present: false` and an empty config.

### D6. Atomic write

`store/atomic.ts` creates the jev directory with mode `0700` if it is absent. It writes `<name>.<pid>.<random>.tmp` in the same directory with mode `0600`, `fsync`s it, and `rename`s it over the target. On any error it removes the temp file and returns the error code, which the calling store turns into an issue. A `rename` within one directory is atomic on POSIX, so a reader sees either the old file or the new one. For `config.json`, the writer keeps the existing file's mode bits, and uses `0600` when creating the file.

### D7. Slot writer keeps the operator's file

`writeSlots(dir, slots)`:
1. Reads and fully validates the current `config.json`. If it is invalid, it refuses with those issues and writes nothing, since the file is never overwritten while malformed.
2. Validates the new `crew.slots` in the context of the whole config.
3. Replaces only the parsed object's `crew.slots`, keeping every other key and its order, and writes it back atomically as JSON with 2-space indentation and a final newline.

JSON has no comments, so formatting can change but content cannot. A missing file is created holding only `crew.slots`. An empty slot list removes `crew.slots`, and `crew` if it becomes empty.

### D8. `state.json` shape and recovery

```json
{ "version": 1, "switches": { "skills": false }, "mode": "budget", "cliReview": { "cli": "codex", "model": "luna", "effort": "high" } }
```

All fields except `version` are optional. A field is present only when the operator changed it; absence means "use the default or config". Unknown keys, a wrong `version` or a wrong type make the whole file `malformed`. Partial salvage could revive a switch the operator never set. Reads of a malformed file return defaults and an issue.

`updateState(dir, mutate)` reads the file. If the file is `unreadable`, meaning it exists but reading it failed with something other than `ENOENT`, the update refuses and touches nothing, because the problem may be temporary. If the file is malformed, the update starts from `{ version: 1 }`, applies `mutate` and validates the result first. Only an update that will be written then renames the malformed file to `state.json.bad`, sets that file to `0600` and replaces any earlier `.bad`. A refused update therefore leaves the malformed file where it is. If the rename or chmod fails, the update returns the issue and writes nothing. If a `mutate` callback throws, that also comes back as an issue. It then applies `mutate`, validates the result and writes it atomically. `resetState(dir)` writes `{ version: 1 }` through the same path. The `/jev cli-review ... default` form maps to an omitted `model` or `effort`. The literal `default` is rejected in the file, so it cannot be mistaken for a model name.

### D9. Resolver is pure

`resolveSettings({ config, state, tuning? })` lives in `store/settings.ts`. It does no I/O and returns a complete `Settings` object with every default filled in. The precedence order is `tuning > state > config > default`:
- `tuning` overrides only `classifier.timeoutMs` in phase 1.
- `state.cliReview` overrides `review`.
- Switches and mode come from state over code defaults: every feature on except `verbose`, and mode `standard`.

Defaults are constants in `store/defaults.ts`, one place to read and test. An `invalid` config is not passed in: the caller stays inert.

## Risks / Trade-offs

- [Two Pi processes update `state.json` at the same moment and one change is lost] → Accepted: the operator types switches by hand, each file stays whole, and the next `/jev` shows the actual state.
- [Strict unknown keys make a newer config fail on an older package] → The issue names the key, so the fix is obvious. Docs say to upgrade the package or drop the key.
- [Validation rules drift from `docs/configuration.md`] → Tests take their expected values from the docs (`docs/testing.md`), one test per documented rule.
- [`writeSlots` reorders nothing, but strips formatting] → Documented in `docs/configuration.md`.
- [A `.bad` file holds whatever was in the broken file] → It stays in the owner-only directory, mode `0600`, and is never read back.

## Migration Plan

None: nothing has shipped. Later groups import these modules.

## Open Questions

None.

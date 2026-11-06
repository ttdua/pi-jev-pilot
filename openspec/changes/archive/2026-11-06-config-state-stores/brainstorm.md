## Design Summary

WG-03 gives the package its two local files under `<agentDir>/jev/` and one way to read a setting:

- **`config.json`**: the operator's settings. Read and validated on session start. Any problem (bad JSON, wrong type, out-of-range value, unknown key) makes the package inert, with an error naming the field path, and the file is left untouched. The only writer updates `crew.slots` and leaves every other key as the operator wrote it; no command calls it yet (slot commands arrive in WG-06/WG-13).
- **`state.json`**: what `/jev` changes. It holds feature switches, the mode and the CLI review default. A missing file means defaults. A malformed file means defaults plus a warning, and the next write moves the bad file aside as `state.json.bad` before replacing it. Writes are atomic and owner-only.
- **Effective settings**: one resolver merges `tuning > state > config > default`. The tuning layer is optional and empty until WG-18.
- The agent directory comes from Pi through `host/` and is passed into `store/` as a plain path, so `PI_CODING_AGENT_DIR` moves the files and tests use a temp directory.

Who it serves: the operator, who edits `config.json` by hand and must never have it rewritten behind their back, and later work groups (WG-05 ledger, WG-06 `/jev`, WG-07/WG-11 decisions), which need validated values without each re-implementing parsing and precedence.

## Alternatives Considered

### Alternative A: Schema library (typebox) for validation
- **Approach**: declare the schemas with `typebox` and validate with its checker.
- **Pros**: declarative; standard JSON Schema; already present as a transitive dependency of Pi.
- **Cons**: it would become a new direct runtime dependency; error messages need adapting to "name the field" wording; more surface to pin and upgrade.
- **Why not chosen**: the schemas are small (about eight sections) and the operator chose no new dependency.

### Alternative B: Lenient config (ignore unknown keys, block only secret-like names)
- **Approach**: accept unknown keys, reject only names such as `apiKey`, `token` or `secret`.
- **Pros**: a config written for a newer version still loads on an older one.
- **Cons**: typos pass silently (`timeoutMS` does nothing); a secret under an unexpected name is not caught.
- **Why not chosen**: the operator chose strict validation; a typo or a stray key is reported by path.

### Alternative C: Treat a malformed `state.json` like `config.json` (inert)
- **Approach**: any problem in `state.json` disables the package.
- **Pros**: one rule for both files.
- **Cons**: `state.json` is written by the package itself, so corruption (a crash, a concurrent writer) would disable the package until the operator repairs a file they never edited.
- **Why not chosen**: the operator chose defaults plus a warning, keeping the bad file as `.bad`.

## Agreed Approach

Hand-written validators in `store/`, strict on `config.json`, forgiving on `state.json`, plus a single resolver for precedence. This keeps the "config is only the operator's" invariant (domain rule 9) and the "malformed config makes the package inert" failure mode from the architecture, without a new dependency.

## Key Decisions

1. **Validation**: hand-written, no new dependency.
2. **Unknown keys in `config.json`**: an error, reported by path. This also satisfies "a key found in config is rejected": a key such as `apiKey` is unknown. `classifier.apiKeyEnv` must look like an environment variable name, so a pasted key fails as a bad value.
3. **CLI review default**: `/jev cli-review` writes its choice to `state.json` as an override; `review.cli` in `config.json` stays the operator's default. `docs/configuration.md` is corrected to say so.
4. **Slot writer**: WG-03 provides an atomic update of `crew.slots` that preserves every other key. No command calls it yet. `docs/architecture.md` is corrected from "read-only here".
5. **Malformed `state.json`**: defaults and a warning; the next write renames the bad file to `state.json.bad`, then replaces it.
6. **Precedence**: one resolver in `store/`, `tuning > state > config > default`, with an optional tuning layer.
7. **Proposed defaults, for correction**: every feature switch is on except `verbose`; the mode is `standard`; no CLI review override, so the config's `review.cli` applies. Reset to "config defaults" means deleting the switches, mode and CLI review override from `state.json`. WG-03 offers that as a store operation and `/jev reset` uses it in WG-06.

## Open Questions

- Several Pi processes writing `state.json` at once: the last writer wins, with no lock. Each write is atomic, so the file is never half-written. One process can still overwrite another's recent switch. Proposed as acceptable for switches set by hand; design.md records it.

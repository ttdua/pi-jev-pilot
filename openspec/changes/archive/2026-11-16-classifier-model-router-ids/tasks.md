## 1. Classifier model id rule

Blocked by: none

- [x] 1.1 Add tests in `tests/store/config-read.test.ts` for the scenarios "Router-style model accepted", "Model length bound" and "Malformed model rejected", plus a whole-file check that a router id keeps the other sections, and see them fail
- [x] 1.2 Replace the classifier `model` validator in `src/store/config.ts` with a classifier-only named pattern `^[A-Za-z0-9._][A-Za-z0-9._:/-]{0,127}$`, not shared with any other model field
- [x] 1.3 Update the `classifier.model` row in `docs/configuration.md` with the new rule and a router id example
- [x] 1.4 Run `bun test`, `bun run typecheck`, `bun run lint` and `bun run fmt:check`, and reproduce issue #78 through `readConfig` with its example config

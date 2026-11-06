## 1. Shared URL rule

- [x] 1.1 Add `src/shared/urls.ts` exporting `isAllowedJevUrl` (body moved verbatim from `src/jev/client.ts`), with its own unit tests in `tests/shared/urls.test.ts`; make `src/jev/client.ts` re-export it and keep using it
- [ ] 1.2 Make `src/store/config.ts` validate `classifier.url` with the shared `isAllowedJevUrl`, delete `urlAllowed` and `LOOPBACK_HOSTS`, and add the "Whole loopback range accepted" and "Config and client agree" tests

## 2. Boundaries

- [ ] 2.1 Add the `src/shared/**` lint override, the `policy/` negated exception, the `extension.ts` `./shared/**` ban, and the boundary fixtures for every new forbidden and allowed edge

## 3. Docs

- [ ] 3.1 Update `docs/architecture.md` (layout, rules, diagram), `docs/configuration.md` (`classifier.url` row) and `docs/roadmap.md` (WG-03 note)

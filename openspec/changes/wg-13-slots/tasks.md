## 1. Config

- [x] 1.1 Make `when` required in `slotsValidator` (`src/store/config.ts`); add `when` to every slot fixture in `tests/store/config-read.test.ts`, `tests/store/config-write.test.ts` and any other test config with slots; add the scenarios "Slot without when" and "Slot writer refuses a slot without when" (config-file: Tier and slot field rules)

## 2. Policy

- [x] 2.1 Add `SlotTarget`, `Target` and `isSlot` to `src/policy/launch.ts`; widen `workerEffort`'s `tier` to `Target` in `src/policy/effort.ts` with the slot no-cap and slot-move scenarios in `tests/policy/effort.test.ts` (worker-decision: Worker effort, Effort after fallback)
- [x] 2.2 Give `decideTier` in `src/policy/tier.ts` a `slots` parameter. Add rule `slot` after `risky`, plus the below-the-bar substitution (highest-probability offered tier, ties to the lower tier) and the slot-only risky fall-through. Add slot rows and the scenarios from Slot rule, Slot below the bar, Rules without a qualifying tier and the Decision order "Slot in every mode" to `tests/policy/tier.test.ts` (worker-decision: Decision order, Slot rule, Slot below the bar, Rules without a qualifying tier)
- [x] 2.3 Extend `chooseFallback` in `src/policy/tier.ts` for slot targets (keep; else `balanced`, `fast`; never `deep`/`expert`) with the Fallback choice scenarios in `tests/policy/tier.test.ts` (worker-decision: Fallback choice)
- [x] 2.4 Thread `slots` and `Target` through `RouteInput`, `launchKind` and `routeLaunch` in `src/policy/route.ts`. A slot counts as offered for the untouched case (d) and for `tierQuestion`. `canRun`, `thinkingOf` and `modelOf` take `Target`. Add the slot scenarios of Routed launch, Nothing can run, Route writes thinking only, Launches left untouched and Locks in the route to `tests/policy/route.test.ts` (worker-decision: those requirements)

## 3. Questions

- [x] 3.1 Extend `buildWorkerQuestions` in `src/jev/questions.ts` with a `slots` list (`name`, display name or undefined, `model`, `when`), appending `slot::<name>` criteria and options after the tiers. Put the `(a custom model). ` wording in `src/jev/rubrics.ts`. Tests in `tests/jev/questions.test.ts`: byte-for-byte unchanged without slots, slot alone, order, criterion with and without a display name, same in every mode, answers read, and no slot in `mainQuestions` (worker-request: Offered tiers, Worker questions, Slot criterion, No slot in the main request)

## 4. Host routing

- [x] 4.1 Add `src/shared/text.ts` `editDistance(a, b)` with tests in `tests/shared/text.test.ts`. Add `src/host/models.ts` with `splitModel`, `checkModel(registry, id)` (moved from `checkTier` in `src/host/worker.ts`) and `nearestModels(registry, id, 3)` over `getAvailable()`, with tests in a new `tests/host/models.test.ts` (slot-commands: Model check, Nearest names)
- [x] 4.2 In `src/host/worker.ts`, pass configured slot names to the route, resolve a target's model from `settings.tiers` or `settings.crew.slots`, add slot display names to the request, check slot models, and warn for a slot with `crew.slots "<name>" model`, keyed by target and model. Tests in `tests/host/worker.test.ts` and `tests/host/worker-ledger.test.ts`, with helpers in `tests/host/worker-fakes.ts` (worker-routing: Worker request content, Target check before writing, Fallback warning; worker-ledger: Decision fields)
- [x] 4.3 Host test with the loopback Jev fixture and the real executor, in `tests/host/worker-routing.test.ts`. Add a usable `fixture/fixture-review` model to `tests/host/fixture.ts`. Cover:
  - a review launch answered `slot::reviewer` .92 runs on the slot model in foreground and background;
  - a slot without credentials falls back to `balanced` with one warning;
  - Jev down keeps the caller input;
  - a ledger line passes the schema with `tier` `slot::reviewer` and `reason` `slot`.
  (worker-routing: Reviewer slot routes; worker-ledger: Decision fields)

## 5. Slot commands

- [ ] 5.1 Add `src/host/slots.ts` with `parseSlotArgs` (the three forms, `when` text verbatim) and `runSlot` (add, replace keeping `when`, show, remove, check order, registry check with nearest names, invalid config, write errors, reports). Tests in a new `tests/host/slots.test.ts` (slot-commands: all requirements except output)
- [ ] 5.2 Dispatch the slot forms from `parseJevArgs` and `runJev` in `src/host/commands.ts`. Existing forms keep precedence. Usage text lists the three slot forms. An unknown slot or a name-shaped typo shows the error with the usage text. Tests in `tests/host/commands.test.ts`, covering print mode, a child session, and the next launch seeing a new slot (jev-command: Usage text for other input; slot-commands: Slot command forms, Slot command output and failures)

## 6. Docs

- [ ] 6.1 Update the docs:
  - `docs/configuration.md`: `when` required.
  - `docs/jev-questions.md`: remove the default `when`.
  - `docs/usage-guide.md`: `when` required, drop the "(WG-13)" marks and the "until its work group adds it" note for slot commands, add an example of a good `when`.
  - `docs/domain-model.md`: slot fallback `balanced` then `fast`, below-the-bar rule, `when` required.
  - `docs/architecture.md`: slot fallback row.
  - `docs/jev-contract.md`: slot options.
  - `docs/roadmap.md`: mark WG-13 Done.
- [ ] 6.2 Run `bun run typecheck`, `bun run lint`, `bun run fmt:check` and `bun test`; all pass

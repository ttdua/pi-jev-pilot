## MODIFIED Requirements

### Requirement: Host wiring only
Catalog reading, explicit-skill detection, the loaded-in-context scan and fingerprints SHALL live in `src/host/`. Picking, the delivery text and the duplicate decision MUST come from `src/policy/main/skill.ts` unchanged, and the questions from `src/jev/questions.ts`. Only Pi's public API MUST be used.

#### Scenario: Lint boundaries
- **WHEN** lint runs on the change
- **THEN** it passes, and no file outside `src/host/` and `src/extension.ts` imports `@earendil-works/pi-coding-agent`

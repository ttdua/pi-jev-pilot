## MODIFIED Requirements

### Requirement: Pure and Pi-free
The skill criterion, batching, pick rule, delivery text and duplicate check SHALL live in `src/policy/` with no Pi import and no I/O, and the skill questions in `src/jev/` with no Pi import. Lint MUST enforce both.

#### Scenario: Lint boundaries
- **WHEN** lint runs on the change
- **THEN** it passes, and `src/policy/main/skill.ts` imports only from `src/policy/` and `src/shared/`

## MODIFIED Requirements

### Requirement: Request signals
`request` SHALL carry `text` (the prompt), `files_mentioned`, `has_code_or_error` and `is_question`, computed in code by the rules in `docs/jev-contract.md` (`request` table): `files_mentioned` counts distinct paths or file names with a known extension; `has_code_or_error` and `is_question` match the listed English patterns, case-insensitive. `request` MUST NOT carry a length of the prompt, such as `prompt_chars`, so that effort is judged from context and not from length.

#### Scenario: Question with a file
- **WHEN** the prompt is `  why does src/a.ts fail?  `
- **THEN** `request` has exactly the keys `text`, `files_mentioned`, `has_code_or_error` and `is_question`; `files_mentioned` is 1, `has_code_or_error` is false (`fail` is not `failed`) and `is_question` is true

#### Scenario: Error text
- **WHEN** the prompt is `the build failed with TypeError`
- **THEN** `has_code_or_error` is true

#### Scenario: Same file twice
- **WHEN** the prompt mentions `README.md` twice
- **THEN** `files_mentioned` is 1

#### Scenario: Plain instruction
- **WHEN** the prompt is `rename foo to bar`
- **THEN** `files_mentioned` is 0, `has_code_or_error` is false and `is_question` is false

#### Scenario: No length sent
- **WHEN** a host test sends a main request for a prompt of 800 characters
- **THEN** the recorded Jev request's `state.request` has no `prompt_chars` key

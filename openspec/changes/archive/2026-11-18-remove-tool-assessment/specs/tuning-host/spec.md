## MODIFIED Requirements

### Requirement: Tuned value reaches every reader
Every reader of `classifier.timeoutMs` (the main decision and worker routing) SHALL take it from the settings snapshot, so a tuned value that applies is used by all of them.

#### Scenario: Tuned value used by the next request
- **WHEN** `tuning.json` holds `timeoutMs` value 2500 with base 1500, the config does not set `classifier.timeoutMs`, Jev hangs, and a prompt is sent
- **THEN** the main ledger line has `miss` `timeout` and `ms` at least 2500

#### Scenario: Worker routing uses the tuned value
- **WHEN** `tuning.json` holds `timeoutMs` value 2500 with base 1500 and a worker launch asks Jev
- **THEN** the worker request is made with timeout 2500

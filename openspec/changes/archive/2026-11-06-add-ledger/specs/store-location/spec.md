## MODIFIED Requirements

### Requirement: Atomic replacement
Every write of a whole-file store (`config.json`, `state.json`) SHALL write a temporary file in the same directory, flush it, and rename it over the target, so a reader sees either the old content or the new content, never a partial file. If the write fails, the temporary file MUST be removed and the target MUST be unchanged. The ledger is not a whole-file store: it appends whole lines and rotates by rename, as the `decision-ledger` capability specifies.

#### Scenario: Failed write leaves the target unchanged
- **WHEN** a write fails after the temporary file was created
- **THEN** the target file has its previous content and no temporary file remains in the directory

#### Scenario: No temporary file after success
- **WHEN** a write succeeds
- **THEN** the directory holds the target file and no temporary file

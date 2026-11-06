# store-location Specification

## Purpose
The package's files live in `<agentDir>/jev/`, located through Pi's agent directory, are created owner-only and are replaced atomically, with write failures returned rather than thrown.

## Requirements

### Requirement: Files live under the agent directory
The package's files SHALL live in `<agentDir>/jev/`, where `<agentDir>` is the value of Pi's public `getAgentDir()` at the time of the call. The host adapter MUST compute that directory and pass it to the stores as a plain path. Store modules MUST NOT import Pi or read `PI_CODING_AGENT_DIR` themselves.

#### Scenario: PI_CODING_AGENT_DIR moves the files
- **WHEN** `PI_CODING_AGENT_DIR` is set to a temporary directory and the host adapter computes the jev directory
- **THEN** the result is `<that directory>/jev`

#### Scenario: Default location
- **WHEN** `PI_CODING_AGENT_DIR` is unset and `HOME` is a temporary directory
- **THEN** the jev directory is `<HOME>/.pi/agent/jev`

#### Scenario: Stores read no environment
- **WHEN** the source of `src/store/` is searched
- **THEN** it contains no `process.env` reference

#### Scenario: Stores never import Pi
- **WHEN** lint runs over `src/store/`
- **THEN** no file there imports `@earendil-works/*`, and the project's lint passes

### Requirement: Owner-only files
When a store creates the jev directory, it SHALL create it with mode `0700`. Every file a store creates there MUST have mode `0600`. Writing an existing `config.json` MUST keep that file's mode.

#### Scenario: Created directory and file are owner-only
- **WHEN** the first `state.json` write runs in an agent directory with no `jev/` directory
- **THEN** `jev/` has mode `0700` and `state.json` has mode `0600`

#### Scenario: Existing config mode is kept
- **WHEN** `config.json` has mode `0640` and the slot writer replaces it
- **THEN** the new `config.json` has mode `0640`

### Requirement: Write failures are returned
A store write that fails on I/O (for example `EACCES`, `ENOSPC`, or a directory that cannot be created) SHALL return a problem at path `""` naming the error code, and MUST NOT throw.

#### Scenario: Read-only directory
- **WHEN** the jev directory is not writable and a state update runs
- **THEN** the update returns a problem at `""` naming `EACCES`, and nothing is thrown

### Requirement: Atomic replacement
Every store write SHALL write a temporary file in the same directory, flush it, and rename it over the target, so a reader sees either the old content or the new content, never a partial file. If the write fails, the temporary file MUST be removed and the target MUST be unchanged.

#### Scenario: Failed write leaves the target unchanged
- **WHEN** a write fails after the temporary file was created
- **THEN** the target file has its previous content and no temporary file remains in the directory

#### Scenario: No temporary file after success
- **WHEN** a write succeeds
- **THEN** the directory holds the target file and no temporary file

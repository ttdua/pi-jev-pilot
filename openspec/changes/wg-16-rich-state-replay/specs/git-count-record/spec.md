## ADDED Requirements

### Requirement: Opt-in recorder
The package SHALL record git change counts only when the environment variable `JEV_REPLAY_GIT` is `1`. For each main prompt that sends a main request, it MUST append one line to `<agentDir>/jev/replay-git.jsonl`. The line MUST be exactly `{ v: 1, at, session, turnId, changedFiles, diffLines }`, with the counts computed by the `workspace.git` rules. When the counts are unknown, nothing MUST be written. Without the variable, nothing MUST be run or written.

#### Scenario: Off by default
- **WHEN** `JEV_REPLAY_GIT` is unset and a main request is sent in a git repository
- **THEN** `replay-git.jsonl` does not exist

#### Scenario: Line written
- **WHEN** `JEV_REPLAY_GIT` is `1` and a main request is sent in a repository with 2 changed files and 9 changed lines
- **THEN** one line is appended, with the request's `turnId`, `changedFiles` 2 and `diffLines` 9, and no other keys

#### Scenario: No line without a request
- **WHEN** `JEV_REPLAY_GIT` is `1` and the session is a child session, so no main request is sent
- **THEN** no line is appended

### Requirement: Recorder stores numbers only
`session` SHALL be Pi's opaque session id, never a path. A recorder line MUST NOT contain file names, paths, the working directory, the prompt, or the diff. The file MUST be created owner-only (`0600`, in a `0700` directory).

#### Scenario: No names stored
- **WHEN** the repository lives in a directory named `JEV-MARKER-DIR`, the changed file is named `JEV-MARKER-FILE.ts`, and a line is recorded
- **THEN** neither `JEV-MARKER-DIR` nor `JEV-MARKER-FILE` appears in `replay-git.jsonl`

### Requirement: Recorder fails open
The recorder SHALL run without delaying the main request's decision. A failed git command, a failed write, or a file that already holds 5000 lines MUST write nothing and MUST NOT change the decision or throw.

#### Scenario: Write failure
- **WHEN** the jev directory is not writable and `JEV_REPLAY_GIT` is `1`
- **THEN** the main decision is applied as without the recorder, and no error is shown

#### Scenario: Cap reached
- **WHEN** `replay-git.jsonl` holds 5000 lines
- **THEN** no line is appended

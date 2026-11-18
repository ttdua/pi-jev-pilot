## MODIFIED Requirements

### Requirement: Launch policy host evidence
Host tests SHALL show, through real Pi sessions against the recording fixture, that:
- a launch policy's model and thinking reach the child's first provider request, for foreground, background and service launches, and for a fork launch (with the parent marker still present, inside a tool result where the parent had one);
- a fork with no policy adjustment sends a first request whose system prompt and tool list equal the parent's last request;
- a locked agent field wins over the policy;
- a policy that exceeds its timeout lets the launch run with the requested values;
- a granted extension tool is offered and callable in the child;
- a `disallowed_tools` entry is absent even when granted;
- the effective model on the worker's ledger line equals the child's first request `model`.

#### Scenario: Policy model reaches the child
- **WHEN** a probe policy sets `fixture/fixture-fast` and `medium` for a foreground launch
- **THEN** the child's first request has that `model` and `reasoning_effort` `medium`

#### Scenario: Inherited context with a policy model
- **WHEN** a probe policy sets a model for a fork launch, and the parent conversation contains a synthetic marker
- **THEN** the child's first request uses the policy's model and contains the marker

#### Scenario: Untouched fork keeps the parent prefix
- **WHEN** a fork launch runs with no policy adjustment on the parent's model
- **THEN** the child's first request has the parent's last-request system prompt and tool list byte-for-byte

#### Scenario: Grant reaches the child
- **WHEN** a probe policy grants a probe extension's tool to an agent without `tools`
- **THEN** the child's first request lists that tool and the fixture-scripted call to it executes

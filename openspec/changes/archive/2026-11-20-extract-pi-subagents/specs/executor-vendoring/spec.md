## REMOVED Requirements

### Requirement: Vendored executor location

**Reason**: The executor is no longer in this repository; it lives in `ttdua/pi-subagents`.

**Migration**: Install `git:github.com/ttdua/pi-subagents@v0.1.1` next to jev-pilot. For types and host tests, this repository uses the dev dependency described in `host-test-harness`.

### Requirement: Upstream provenance

**Reason**: Provenance of the fork belongs to the repository that holds it.

**Migration**: `ttdua/pi-subagents` records it in `UPSTREAM.md` and its `upstream-provenance` spec.

### Requirement: Upstream license kept

**Reason**: No executor code ships from this repository.

**Migration**: `ttdua/pi-subagents` keeps the upstream `LICENSE` and its own `NOTICE.md`. This repository's `NOTICE.md` drops the vendored entries and names `ttdua/pi-subagents` as the executor jev-pilot works with.

### Requirement: One install loads both extensions

**Reason**: Installing jev-pilot no longer loads an executor.

**Migration**: Users install the executor separately (see `package-loading` and `readiness-checks`).

### Requirement: Vendored tests run on their own

**Reason**: The executor's unit tests, type check and public-types check run in `ttdua/pi-subagents`.

**Migration**: The root `test:executor` script and the CI `verify:public-types` step are removed.

### Requirement: Service identity and ownership

**Reason**: Publishing and owning the service is executor behavior.

**Migration**: Specified in `ttdua/pi-subagents`. jev-pilot reads the slot as described in `readiness-checks`.

### Requirement: No runtime import across the two extensions

**Reason**: The capability is about vendoring, which ends; the rule itself stays.

**Migration**: Restated in `executor-boundary` "No runtime import of the executor".

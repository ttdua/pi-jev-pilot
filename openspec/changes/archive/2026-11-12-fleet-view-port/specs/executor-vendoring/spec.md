## MODIFIED Requirements

### Requirement: Upstream license kept
The vendored package SHALL keep upstream's `LICENSE` file unchanged. The root `NOTICE.md` SHALL name the vendored package, its upstream, its authors as stated in upstream's license and its license (`MIT`). When code in the vendored package is ported from another project, `NOTICE.md` SHALL also name that project, the version ported from, its authors as stated in its license and its license.

#### Scenario: Notice entry
- **WHEN** `NOTICE.md` is read
- **THEN** it has an entry for `packages/pi-subagents` naming `gotgenes/pi-packages` and `MIT`

#### Scenario: Ported fleet list credited
- **WHEN** `NOTICE.md` is read after the fleet list is added
- **THEN** it names `tintinweb/pi-subagents`, version `0.23.2` and `MIT` for the fleet list behavior

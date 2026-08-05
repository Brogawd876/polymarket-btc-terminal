# Test Plan: Phase 10

## Objectives
Since Phase 10 is the Final Audit phase, the test plan consists of executing the comprehensive test suite to provide independent verification of the project's pristine state.

## Executable Steps
1. **Workspace Health**: Execute `pnpm verify`. Must output success.
2. **E2E Health**: Execute `pnpm test:e2e`. Must show the extension-panel locator attaching successfully and all assertions passing.
3. **Database Health**: Execute `pnpm db:reset:test` and `pnpm db:migrate`. Must execute cleanly and initialize schema.
4. **Server Runtime Health**: Start `pnpm dev:server`, observe "Server listening" logs, then terminate gracefully.

## Expected Outcomes
- Zero linting errors.
- Zero typecheck errors.
- All unit, integration, and E2E tests pass.
- Server binds to port and does not crash on module resolution.

## Output Artifact
The culmination of these tests will feed directly into the `FINAL_VERIFICATION_REPORT.md`.

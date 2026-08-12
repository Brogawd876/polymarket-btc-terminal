# Implementation Assignments: Phase 10

## Agent Setup
- **Role**: Quality Assurance & Compliance Auditor
- **Tools**: Terminal (`pnpm` commands), read-only file access, markdown writing.

## Tasks
1. **Audit Workspace Verification**
   - Run `pnpm verify` to ensure linting, typechecking, and basic tests pass without error.
   - Run `pnpm test:e2e` to verify E2E tests have been fixed.

2. **Audit Backend Integrity**
   - Run `pnpm dev:server` in background to verify startup completes without module resolution errors.
   - Run `pnpm db:migrate` and `pnpm db:reset:test` to verify database tooling.

3. **Codebase Compliance Verification**
   - Trace fixes for `extension-panel.test.ts` (e.g. shadow DOM attachment).
   - Trace fixes for server diagnostic and smoke scripts (`live:diagnose`, etc.) within `@polymarket-btc/server`.

4. **Author Final Verification Report**
   - Create and save `c:\Users\Yasser\Downloads\Polymarket control\repair-program\FINAL_VERIFICATION_REPORT.md`.
   - Ensure the report covers:
     - All points from `REQUIREMENTS_TRACEABILITY.md` (Workspace scripts, Server scripts, E2E tests, Backend startup).
     - Structural integration.
     - Final sign-off.

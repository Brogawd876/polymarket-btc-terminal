# Runtime Plan: Phase 10

## Execution Strategy
The Phase 10 agent will perform a comprehensive reading and testing of the final environment. No core source code modifications will be written during this phase. Only the `FINAL_VERIFICATION_REPORT.md` artifact will be produced.

## Runtime Audit Scripts
```bash
# 1. Full verification of workspace integrity
pnpm verify

# 2. Database tooling checks
pnpm db:reset:test
pnpm db:migrate

# 3. Server diagnostic and smoke scripts
pnpm --filter @polymarket-btc/server public:diagnose
pnpm --filter @polymarket-btc/server live:smoke

# 4. End-to-End checks
pnpm test:e2e
```

## Review Guidelines
- Ensure that the final report explicitly addresses the four original requirements:
  - REQ-001: Missing workspace scripts (`lint`, `typecheck`).
  - REQ-002: Missing server scripts (`live:diagnose`, etc.).
  - REQ-003: E2E test failures (`extension-panel.test.ts`).
  - REQ-004: Backend startup failure (`../../db/index.js`).
- If any script fails, log it as an audit finding and halt the sign-off process until rectified.

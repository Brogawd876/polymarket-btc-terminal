# Defect Ledger

| Defect ID | Description | Impact | Status | Root Cause |
|-----------|-------------|--------|--------|------------|
| DEF-001 | Missing `lint` and `typecheck` scripts in workspace packages. | Prevents verification commands. | OPEN | Packages lack scripts defined in root `package.json`. |
| DEF-002 | Missing diagnostic/db scripts in `@polymarket-btc/server`. | Prevents specific task runs (`live:smoke`, etc.). | OPEN | Scripts defined in root `package.json` proxy are absent in `apps/server/package.json`. |
| DEF-003 | E2E test failing for extension panel (`extension-panel.test.ts`). | CI/CD and deployment blocking. | OPEN | The DOM element `polymarket-btc-terminal` is not attached within the timeout. |
| DEF-004 | Server fails to start (`pnpm dev:server`). | Critical - Backend unavailable. | OPEN | `Cannot find module '../../db/index.js'` from `apps/server/src/integrations/polymarket/adapter.ts`. |

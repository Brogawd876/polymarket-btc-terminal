# Phase 0 Scan Report

## Overview
Scanned the root directory, workspace configurations (`pnpm-workspace.yaml`, `package.json`), `apps/server`, `apps/extension`, and `packages/shared`.

## Findings
- Root `package.json` contains `lint`, `typecheck`, and `test` scripts that use `--filter "*"` but none of the workspace packages actually define these scripts. This causes `pnpm verify` to fail.
- Dependency versions in all `package.json` files use caret `^` matching. The requirements specify that published dependencies should be pinned (exact versions).
- The `PolymarketAdapter` constructor in `apps/server/src/integrations/polymarket/adapter.ts` unconditionally checks for `PRIVATE_KEY` and throws a fatal error if it's missing, even if `ENABLE_LIVE_TRADING` is not true. This breaks paper/public startup paths without dummy credentials.
- In `apps/extension/src/entrypoints/content.tsx`, the `matches` array for the WXT content script is set to `["*://*.polymarket.com/*"]`. This misses the root domain `polymarket.com`, potentially causing E2E tests and manual testing to fail if users land on `https://polymarket.com`.
- In `tests/integration/market-discovery.test.ts`, the tests simulate `MarketRepository` by directly creating an in-memory SQLite database and running standard SQL statements, testing better-sqlite3 rather than our actual integration logic. This is a false-positive test.

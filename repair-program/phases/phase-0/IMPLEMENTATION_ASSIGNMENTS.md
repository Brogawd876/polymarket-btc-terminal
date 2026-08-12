# Implementation Assignments

- **Agent 1 (Phase Exec):** Execute all Implementation Cells from the Phase 0 Plan.
  - Cell 1: Pin dependencies in all `package.json` files. Add missing scripts (`lint`, `typecheck`, `test`) to `apps/server/package.json`, `apps/extension/package.json`, `packages/shared/package.json`.
  - Cell 2: Update `apps/server/src/integrations/polymarket/adapter.ts` to require `PRIVATE_KEY` only when `ENABLE_LIVE_TRADING` is true. Ensure no random wallet creation fallback.
  - Cell 3: Update `apps/extension/src/entrypoints/content.tsx` to add `*://polymarket.com/*` to `matches`.
  - Cell 4: Delete `tests/integration/market-discovery.test.ts`.

# Baseline Runtime Results

## Backend (`@polymarket-btc/server`)
- **Command**: `pnpm dev:server` (via `ts-node-dev src/index.ts`)
- **Status**: CONFIRMED BROKEN
- **Error Details**: 
  - Fails to start due to `Error: Cannot find module '../../db/index.js'`.
  - Occurs in `apps/server/src/integrations/polymarket/adapter.ts` on line 13.
  - While `index.ts` exists in `apps/server/src/db`, the `.js` import or the relative path configuration appears malformed for `ts-node-dev`.

## Extension (`apps/extension`)
- **Command**: `pnpm build`
- **Status**: PARTIAL
- **Details**: Extension builds successfully via `wxt build` (chrome-mv3). However, full runtime operation relies on the backend, which is currently broken.

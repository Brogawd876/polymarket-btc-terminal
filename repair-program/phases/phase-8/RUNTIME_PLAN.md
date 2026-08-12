# Runtime Plan

## Pre-Requisites
- Build the shared package after updating schemas (`pnpm --filter @polymarket-btc/shared build`).
- Ensure no database locks prevent the new query for Realized P&L.

## Verification
- Start the server (`pnpm start:server`).
- Load the unpacked extension in Chrome (`apps/extension/dist/chrome-mv3`).
- Open `https://polymarket.com`.
- Inspect the Terminal UI overlay.
- Wait for WebSocket connection.
- Verify that clicking the "POSITIONS" tab displays the new metrics (Balance, Realized PNL, Unrealized PNL).

## Rollback Plan
- Revert changes to `shared/src/index.ts` and `server/src/routes/index.ts`.
- Revert frontend UI refactors.

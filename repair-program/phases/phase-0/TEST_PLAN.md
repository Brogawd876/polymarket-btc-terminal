# Test Plan

1. **Verify Scripts**: Run `pnpm verify` and ensure it exits with code 0.
2. **Verify Server Boot**: Run `node dist/index.js` on `apps/server` (after build) with no `.env` and verify it boots without crashing.
3. **Verify Server Fatal Error**: Run `ENABLE_LIVE_TRADING=true node dist/index.js` and verify it crashes with a precise message.
4. **Verify E2E**: Run `pnpm test:e2e` and verify it passes.

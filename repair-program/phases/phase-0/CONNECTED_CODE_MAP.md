# Connected Code Map

- `package.json` (Root) -> Calls scripts in `apps/server/package.json`, `apps/extension/package.json`, `packages/shared/package.json`.
- `apps/server/src/index.ts` -> Initializes `PolymarketAdapter` and `setupDb`.
- `apps/server/src/integrations/polymarket/adapter.ts` -> Evaluates `process.env.PRIVATE_KEY` and `process.env.ENABLE_LIVE_TRADING`. Constructs `ethers.Wallet` and `ClobClient`.
- `apps/extension/src/entrypoints/content.tsx` -> Injects React shadow root based on `matches` manifest rules.
- `tests/e2e/extension-panel.test.ts` -> Opens `https://polymarket.com` and expects shadow root injection.
- `tests/integration/market-discovery.test.ts` -> Standalone file doing raw SQL testing without touching app components.

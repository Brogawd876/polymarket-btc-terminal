# Code Map & System Architecture

## Workspace Packages & Apps

### 1. `packages/shared` (`packages/shared/src/index.ts`)
- **Role**: Shared Zod schemas, TypeScript types, operational state enums, WsEvent discriminators, and LiveReadiness types.
- **Key Schemas**: `OperationalState`, `LiveReadiness`, `OrderStatus`, `Order`, `Position`, `MarketState`, `MarketAnchor`, `WsEventSchema`.

### 2. `apps/server` (`apps/server/src/`)
- `index.ts`: Fastify app setup, HTTP & WebSocket listening on 3001, local auth token generation.
- `db/index.ts`: SQLite database initialization, schema migrations (`orders`, `fills`, `positions`, `presets`, `idempotency`, `settings`, `anchors`).
- `routes/index.ts`: REST endpoints (`/api/v1/health`, `/api/v1/token`, `/api/v1/presets`, `/api/v1/settings`, `/api/v1/readiness`) and `/ws` WebSocket route handling.
- `integrations/polymarket/`:
  - `discovery.ts`: Gamma API polling for BTC 5m markets, slug calculation, window timing, UP/DOWN token label mapping.
  - `rtds.ts`: Polymarket Chainlink RTDS WebSocket listener for live BTC/USD price and price-to-beat anchor validation.
  - `adapters/OfficialSdkTradingAdapter.ts`: `@polymarket/clob-client-v2` integration, order placement, cancellation, balance fetching, user WS channel, market WS orderbook streaming, and startup reconciliation.

### 3. `apps/extension` (`apps/extension/src/`)
- `wxt.config.ts`: WXT extension build configuration for Manifest V3 Chromium.
- `entrypoints/background.ts`: Background service worker managing localhost WebSocket connection to Fastify backend, authentication, port multiplexing (`chrome.runtime.Port`), and message broadcasting.
- `entrypoints/content.tsx`: Content script injecting panel into Polymarket pages within Shadow DOM.
- `components/`:
  - `App.tsx`: Main extension panel shell with tabs (Trade, Orders, Positions, History, Presets, Settings, Diagnostics).
  - `TradingPanel.tsx`: Live market view, Chainlink reference, price-to-beat, arming button (`[HOLD TO ARM LIVE]`), BUY dollar controls, SELL share percentage controls, dynamic price preset buttons.
  - `OrdersTab.tsx`: Open orders view with individual Cancel and Cancel All.
  - `PositionsTab.tsx`: Position holdings, unrealized/realized P&L, fees, settlement status.
  - `SettingsTab.tsx`: Preset editor and operational parameters persistence.

### 4. `tests/`
- `tests/integration/`: Backend integration tests for schemas, market discovery, WS protocols, order lifecycle, idempotency.
- `tests/e2e/`: Playwright browser tests verifying extension injection and full user journeys.
- `tests/fixtures/` & `tests/fakes/`: Internal test doubles (`FakeTradingAdapter`, `FakeMarketDataSource`, `FakeUserStream`).

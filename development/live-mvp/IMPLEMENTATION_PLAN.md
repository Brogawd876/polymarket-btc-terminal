# Live MVP Comprehensive Implementation Plan

## Goal Description
Transform `Brogawd876/polymarket-btc-terminal` into a production-ready, fully functional live MVP terminal for Polymarket 5-minute BTC markets. Ensure end-to-end integration across Fastify backend, SQLite persistence, `@polymarket/clob-client-v2`, Chainlink RTDS, and WXT Chromium extension.

## 1. Work Package Cells & File Allocations

### Cell A: Shared Contracts & Operational State Machine
- **Target File**: [`packages/shared/src/index.ts`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/packages/shared/src/index.ts)
- **Scope**: Define 9 operational states (`OFFLINE`, `READ_ONLY`, `LIVE_DISARMED`, `LIVE_ARMED`, `SUBMITTING`, `RECONCILING`, `STALE_DATA`, `MARKET_SWITCHING`, `ERROR`), `LiveReadiness` schema with `blockingReasons`, full `OrderState` enum, `MarketAnchor` schema, strict command/event discriminated unions, and UP/DOWN outcome contracts.

### Cell B: Startup, Configuration & Diagnostics
- **Target Files**:
  - [`package.json`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/package.json)
  - [`apps/server/package.json`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/server/package.json)
  - [`apps/extension/package.json`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/extension/package.json)
  - [`packages/shared/package.json`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/packages/shared/package.json)
  - [`scripts/install.ps1`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/scripts/install.ps1)
  - [`scripts/start.ps1`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/scripts/start.ps1)
  - [`scripts/stop.ps1`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/scripts/stop.ps1)
  - [`scripts/public-diagnose.ts`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/server/scripts/public-diagnose.ts)
  - [`scripts/live-diagnose.ts`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/server/scripts/live-diagnose.ts)
  - [`scripts/live-smoke.ts`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/server/scripts/live-smoke.ts)
- **Scope**: Replace all placeholder scripts (`echo lint`, `echo typecheck`, `echo test`, `--passWithNoTests`) with real execution commands. Build single-command Windows installer and starter. Implement real public diagnostic, live diagnostic, and controlled live smoke test scripts.

### Cell C: Market Discovery & Public Feeds
- **Target Files**:
  - [`apps/server/src/integrations/polymarket/discovery.ts`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/server/src/integrations/polymarket/discovery.ts)
  - [`apps/server/src/integrations/polymarket/rtds.ts`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/server/src/integrations/polymarket/rtds.ts)
- **Scope**: Validate Gamma API market payloads, explicitly map UP/DOWN tokens by outcome label, manage window transitions 60s before market end, track Chainlink BTC/USD RTDS feed, establish fixed per-market `MarketAnchor`, and track data freshness (<5s).

### Cell D: Authentication, Fastify Engine & Readiness Evaluator
- **Target Files**:
  - [`apps/server/src/routes/index.ts`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/server/src/routes/index.ts)
  - [`apps/server/src/index.ts`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/server/src/index.ts)
  - [`apps/server/src/db/index.ts`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/server/src/db/index.ts)
- **Scope**: Evaluate `LiveReadiness` centrally on backend, enforce live arming state and timeout expiration, implement atomic idempotency reservation in SQLite before remote CLOB submission, remove production paper trading code/tables, and persist presets/settings in SQLite.

### Cell E: Orders, Fills, Positions & Reconciliation
- **Target Files**:
  - [`apps/server/src/integrations/polymarket/adapters/OfficialSdkTradingAdapter.ts`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/server/src/integrations/polymarket/adapters/OfficialSdkTradingAdapter.ts)
  - [`DELETE`] [`apps/server/src/integrations/polymarket/adapters/PaperTradingAdapter.ts`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/server/src/integrations/polymarket/adapters/PaperTradingAdapter.ts)
- **Scope**: Enforce Post-only GTC limit order creation via `@polymarket/clob-client-v2`, connect authenticated L2 user WS stream for fill events, calculate positions strictly from fills (net shares and average entry price), implement Cancel All, and execute boot reconciliation.

### Cell F: Extension UI & Background Service Worker
- **Target Files**:
  - [`apps/extension/src/entrypoints/background.ts`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/extension/src/entrypoints/background.ts)
  - [`apps/extension/src/entrypoints/content.tsx`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/extension/src/entrypoints/content.tsx)
  - [`apps/extension/src/components/App.tsx`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/extension/src/components/App.tsx)
  - [`apps/extension/src/components/TradingPanel.tsx`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/extension/src/components/TradingPanel.tsx)
  - [`apps/extension/src/components/OrdersTab.tsx`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/extension/src/components/OrdersTab.tsx)
  - [`apps/extension/src/components/PositionsTab.tsx`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/extension/src/components/PositionsTab.tsx)
  - [`apps/extension/src/components/SettingsTab.tsx`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/apps/extension/src/components/SettingsTab.tsx)
- **Scope**: Manage background WS port connection, display 9 operational states and exact blocking reasons, provide `[HOLD TO ARM LIVE]` control, render UP/DOWN outcomes, fixed dollar BUY sizing ($10, $25, $50, $100, Custom), position percentage SELL sizing (25%, 50%, 100%, Custom), price buttons showing calculated figures only (e.g. `[34¢] [32¢] [20¢]`) captured on `pointerdown`, and Cancel All button in Orders tab.

### Cell G & H: Automated Tests & Real Browser Verification
- **Target Files**:
  - [`tests/unit/`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/tests/unit)
  - [`tests/integration/`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/tests/integration)
  - [`tests/e2e/`](file:///c:/Users/Yasser/Downloads/Polymarket%20control/tests/e2e)
- **Scope**: Unit tests for math, sizing, presets, tick clamping, readiness; integration tests for WS routes and idempotency; Playwright E2E tests for extension loading and UI interactions; real browser verification using `chrome-devtools-mcp`.

## 2. Verification Plan
- **Typecheck & Lint**: `pnpm typecheck` and `pnpm lint` run real `tsc --noEmit` and ESLint checks across all 5 workspace projects.
- **Automated Tests**: `pnpm test`, `pnpm test:integration`, `pnpm test:e2e` execute unit, integration, and Playwright tests.
- **Diagnostics**: `pnpm public:diagnose`, `pnpm live:diagnose`, `pnpm live:smoke` pass without errors.
- **Real Browser Verification**: `chrome-devtools-mcp` inspects DOM injection, shadow DOM, console/network logs, WS messaging, responsive layouts (1920x1080 to 1280x720).

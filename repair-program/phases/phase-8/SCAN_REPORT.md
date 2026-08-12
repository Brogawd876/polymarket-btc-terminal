# Phase 8 Scan Report

## Codebase Analysis
The Phase 8 objective is to complete the full unified user interface, integrating all functionality into the WXT extension context. 

We scanned the following areas:
- `apps/extension/src/entrypoints/content.tsx` and `background.ts`: The extension injection and background scripts. The shadow root injection for the floating panel is already implemented in `content.tsx`.
- `apps/extension/src/components/App.tsx`: The main React component that structures the unified UI. It contains tabs for `trade`, `orders`, `positions`, `settings`, and a header. A TARGETED RESCAN found that it uses `useWebSocket` but fails to destructure `balance`, `realizedPnl`, and `positions`, and thus fails to pass them as props to `<PositionsTab />` (Defect 01).
- `apps/extension/src/components/TradingPanel.tsx`: The trading panel implementation. It already contains sizes, presets, dynamic limit calculation, and a countdown. However, it displays the Market state (Current/Next) and reference data age which is requested to be in the main header.
- `apps/extension/src/components/OrdersTab.tsx`: Lists active resting orders and allows cancellation. Fully matches the objective.
- `apps/extension/src/components/PositionsTab.tsx`: Renders a table of positions (Asset, Side, Size, Entry). Missing Current Balance, Unrealized P&L, and Realized P&L.
- `apps/extension/src/hooks/useWebSocket.ts`: Hook handling WebSocket events. It receives `SNAPSHOT` containing positions and balance, but ignores the balance property and doesn't extract realized P&L.
- `apps/server/src/routes/index.ts`: Server WebSocket handlers. Handles `SNAPSHOT_REQUEST` but does not include `realizedPnl` in the response payload. It also contains SQL queries for computing realized PNL which can be reused for the snapshot.

## Findings
1. The unified UI is structurally complete as a compact floating panel (WXT).
2. The Trading Panel and Order Management panels are mostly feature-complete.
3. The Position Panel requires updates to display Balance, Unrealized P&L, and Realized P&L.
4. Unrealized P&L can be calculated on the frontend by matching position entry prices with current market prices from `marketInfo`.
5. Realized P&L must be computed by the server and sent to the frontend (e.g., via the `SNAPSHOT` event).
6. The main header in `App.tsx` needs to be updated to show the "Current/Next market state" and "Chainlink reference price age" as requested by the objective, moving these out of the `TradingPanel` component.
7. DEFECT 01: `App.tsx` fails to destructure `balance`, `realizedPnl`, and `positions` from `useWebSocket` and pass them to `<PositionsTab />`. This causes a TypeError during tests.

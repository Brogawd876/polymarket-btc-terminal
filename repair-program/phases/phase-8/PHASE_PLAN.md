PHASE ID
Phase 8

PHASE OBJECTIVE
Complete the full unified user interface. Ensure the UI is a compact floating panel, implements Trading/Order/Position panels, unifies the Market Status Header, and consumes WebSocket events properly. Address Defect 01 by properly passing props to the Positions tab.

BASELINE COMMIT
Unknown

CURRENT BEHAVIOR
- The UI is a floating panel but some information is fragmented (e.g. Market state and age are in the Trading Panel, not the main header).
- The Position panel does not display current balance, unrealized P&L, or realized P&L.
- The server does not send `realizedPnl` in the WebSocket snapshot, and the frontend ignores `balance`.
- `App.tsx` does not destructure `balance`, `realizedPnl`, and `positions` from `useWebSocket` and does not pass them to `<PositionsTab />`, causing a TypeError (Defect 01).

TARGET BEHAVIOR
- `App.tsx` has a unified "Market Status Header" showing the Current/Next market state, Chainlink reference price age, and connection statuses.
- `App.tsx` correctly destructures `balance`, `realizedPnl`, and `positions` from `useWebSocket` and passes them as props to `<PositionsTab />`.
- `TradingPanel.tsx` no longer shows the duplicated header info.
- `PositionsTab.tsx` shows Current Balance, Unrealized P&L (calculated on frontend), and Realized P&L (provided by server).
- `useWebSocket.ts` stores and exposes `balance` and `realizedPnl` state.
- Backend `routes/index.ts` calculates and attaches `realizedPnl` to the `SNAPSHOT` event payload.

TARGET FILES
- apps/extension/src/components/App.tsx
- apps/extension/src/components/TradingPanel.tsx
- apps/extension/src/components/PositionsTab.tsx
- apps/extension/src/hooks/useWebSocket.ts
- apps/server/src/routes/index.ts
- packages/shared/src/index.ts

CONNECTED FILES
- apps/extension/src/entrypoints/content.tsx
- apps/extension/src/components/OrdersTab.tsx

CALLERS
- Content script injects `App.tsx`
- Server websocket events are picked up by `useWebSocket.ts`

CALLEES
- `useWebSocket.ts` hooks into extension runtime ports

SHARED CONTRACTS
- `WsEventSchema` in `@polymarket-btc/shared`

ENVIRONMENT VARIABLES
- None specific to this change.

DATABASE IMPACT
- The backend will perform an additional aggregation query for realized P&L on `SNAPSHOT_REQUEST`.

FRONTEND IMPACT
- UI gets restructured for better UX.
- Portfolio metrics (Balance, P&L) become visible.
- Fixes destructuring bug in `App.tsx` preventing the Position tab from rendering correctly.

BACKEND IMPACT
- Slight increase in snapshot query weight (calculating realized PNL from fills).

TEST IMPACT
- E2E tests need to assert the presence of Balance and P&L in the DOM.

OPERATIONS IMPACT
- None.

CONFIRMED DEFECTS
- Missing Balance and P&L from positions tab.
- Unstructured header information.
- DEFECT 01: `App.tsx` fails to destructure `balance`, `realizedPnl`, and `positions` from `useWebSocket` and pass them to `<PositionsTab />`.

ROOT CAUSES
- Feature incompletion from earlier scaffolding phases.
- Incomplete wiring between `App.tsx`, `useWebSocket.ts`, and `PositionsTab.tsx`.

NON-ISSUES
- Extension shadow root is fully functional and successfully bypasses site styling collisions.

UNVERIFIED ASSUMPTIONS
- Frontend has enough data to accurately compute Unrealized P&L based on `marketInfo` (assuming positions are for the current active market).

DEPENDENCIES
- Shared package requires an update and rebuild before server/extension can be compiled.

RISKS
- Calculation of Unrealized P&L could be misleading if positions belong to multiple closed/open markets and `marketInfo` only corresponds to one. For Phase 8 we will assume a simple single-market approximation or label it appropriately.

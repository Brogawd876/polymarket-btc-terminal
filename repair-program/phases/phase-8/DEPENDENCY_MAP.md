# Dependency Map

### Data Flow
1. **Server (`apps/server/src/routes/index.ts`)** -> queries local SQLite for `orders`, `positions`, `fills` (for realized P&L) and calls `adapter.getBalance()`.
2. **WebSocket Connection** -> serializes into a `SNAPSHOT` message containing `positions`, `orders`, `balance`, `realizedPnl`.
3. **Shared Packages (`packages/shared/src/index.ts`)** -> Zod schemas validate the WebSocket messages (`WsEventSchema`).
4. **WXT Content Script / Background Script** -> forwards WebSockets from port to content script components.
5. **React Hook (`useWebSocket.ts`)** -> processes the JSON messages and maintains the UI state variables.
6. **React View (`App.tsx`)** -> extracts the UI state and passes it via props to `<TradingPanel />`, `<PositionsTab />`, etc.
7. **React Views (`PositionsTab.tsx`, `App.tsx`)** -> calculate derived metrics, like `Unrealized P&L` (from `positions` + `marketInfo.yesPrice/noPrice`), and display status.

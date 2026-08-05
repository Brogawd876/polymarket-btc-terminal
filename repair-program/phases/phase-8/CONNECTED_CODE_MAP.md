# Connected Code Map

### Frontend Components (Extension)
- `apps/extension/src/entrypoints/content.tsx`: Injects the shadow DOM and mounts the React root (`<App />`).
- `apps/extension/src/components/App.tsx`: Layout container. Manages the unified "Market Status Header" and tabs.
- `apps/extension/src/components/TradingPanel.tsx`: Provides trading actions, size selection, presets, and price limits.
- `apps/extension/src/components/OrdersTab.tsx`: Active orders viewer.
- `apps/extension/src/components/PositionsTab.tsx`: Position portfolio viewer. Will be updated to consume balance and PNL.
- `apps/extension/src/hooks/useWebSocket.ts`: Feeds state into the above components. Needs to expose balance and realized PNL.

### Server Components
- `apps/server/src/routes/index.ts`: WebSocket entry point on the backend. Responsible for `SNAPSHOT` generation which needs to compute `realizedPnl` and send `balance`.

### Shared Schema
- `packages/shared/src/index.ts`: Contains `WsEventSchema`. `SNAPSHOT` event schema must be updated to include `realizedPnl: z.number().optional()`.

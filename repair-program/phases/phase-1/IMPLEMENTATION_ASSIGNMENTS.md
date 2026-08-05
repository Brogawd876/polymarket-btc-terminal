# Implementation Assignments

## Cell 1: Shared Schema Updates
- **Task**: Update `packages/shared/src/index.ts` to implement the new message envelope `{ id: string, type: string, payload?: any }` and include all new required schemas (`AUTH`, `AUTH_OK`, `AUTH_ERROR`, `PING`, `PONG`, `SNAPSHOT`, `MARKET_UPDATED`, `REFERENCE_PRICE_UPDATED`, `PRESET_PRICES_UPDATED`, `ORDER_UPDATED`, `POSITION_UPDATED`, `CONNECTION_UPDATED`, `MODE_UPDATED`, `ERROR`).
- **Owner**: Schema Agent

## Cell 2: Server Database and Token Generation
- **Task**: 
  - Update `apps/server/src/db/index.ts` to include an `idempotency` table.
  - Modify `apps/server/src/index.ts` to generate a random 32-byte hex API token if not present, save to a local file, and expose `/api/v1/auth/token`.
- **Owner**: Backend Agent

## Cell 3: Server WebSocket Handler and Idempotency
- **Task**:
  - Update `apps/server/src/routes/index.ts` WS handler to validate schemas.
  - Implement Idempotency checks.
  - Require `AUTH` before processing any other messages. Send `AUTH_OK` or `AUTH_ERROR`.
  - Process order/cancel requests and return original responses if the `requestId` exists.
- **Owner**: Backend Agent

## Cell 4: Extension Configuration and Background Worker
- **Task**:
  - Update `apps/extension/wxt.config.ts` to add explicit `http://127.0.0.1:3001/*` and `http://localhost:3001/*` to `host_permissions`.
  - Refactor `apps/extension/src/entrypoints/background.ts` to fetch the token on startup, authenticate the WS connection, listen for `SNAPSHOT`, and serve as the message router for content scripts. Maintain internal state of connection to avoid redundant connections.
- **Owner**: Frontend/Extension Agent

## Cell 5: Extension UI Refactor
- **Task**:
  - Refactor `apps/extension/src/components/OrdersTab.tsx`, `PositionsTab.tsx`, and `SettingsTab.tsx` to stop using `fetch`.
  - Use `chrome.runtime.sendMessage` to trigger actions and query state through the background worker.
- **Owner**: Frontend/Extension Agent

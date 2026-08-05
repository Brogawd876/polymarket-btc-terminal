# Implementation Assignments

## Cell 1: Shared Schema & Server Update
- **Target**: `packages/shared/src/index.ts` and `apps/server/src/routes/index.ts`
- **Instructions**: 
  1. Add `realizedPnl: z.number().optional()` to the `SNAPSHOT` event payload schema in `shared/src/index.ts`.
  2. In `server/src/routes/index.ts`, modify the `SNAPSHOT_REQUEST` handler to calculate realized P&L from the `fills` and `positions` tables (using the existing `SUM` case statement used in order placement).
  3. Attach `realizedPnl` to the `SNAPSHOT` event payload.
  4. Ensure `balance` is also correctly sent.

## Cell 2: Frontend Hook
- **Target**: `apps/extension/src/hooks/useWebSocket.ts`
- **Instructions**: 
  1. Add `balance` and `realizedPnl` state variables.
  2. In the `SNAPSHOT` handler, call `setBalance` and `setRealizedPnl` using the payload data.
  3. Export them from the hook.

## Cell 3: UI Header Refactor
- **Target**: `apps/extension/src/components/App.tsx` and `apps/extension/src/components/TradingPanel.tsx`
- **Instructions**: 
  1. Move the `dataAge`, `countdown`, and `marketInfo.type` display logic from `TradingPanel.tsx` into the header of `App.tsx`.
  2. Ensure the main App header displays: Current/Next Market State, Chainlink reference price age, and connection statuses.

## Cell 4: Position Panel Implementation
- **Target**: `apps/extension/src/components/PositionsTab.tsx` and `apps/extension/src/components/App.tsx`
- **Instructions**: 
  1. Update `<PositionsTab />` to accept `balance`, `realizedPnl`, and `marketInfo` as props.
  2. Render a summary section showing Current Balance, Unrealized P&L, and Realized P&L.
  3. Calculate Unrealized P&L: `(currentPrice - avgEntry) * size` for BUY/YES positions, and inversely for SELL/NO positions, using `marketInfo` prices matching the position's token ID.

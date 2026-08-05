# Test Plan

## Acceptance Criteria
- Extension floating panel UI displays cleanly on polymarket.com.
- Header shows live data age and Market type (Current/Next).
- Position Tab displays a table of active positions.
- Position Tab displays Account Balance.
- Position Tab accurately computes and displays Unrealized P&L for open positions.
- Position Tab displays Realized P&L fetched from the server snapshot.

## Regression Tests
- Placing an order should correctly disable inputs and show loading state (from TradingPanel).
- Orders Tab should correctly list active orders and allow cancelling them.

## Negative Tests
- If the server disconnects, header status dot should turn red, and RTDS data age should be marked stale.
- If there are no open positions, Unrealized P&L should be zero and gracefully handled.

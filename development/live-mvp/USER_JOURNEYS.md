# Live MVP User Journeys

## Journey 1: Installation & Startup
- **User Intention**: Install dependencies, start local Fastify backend, load WXT extension into Chrome.
- **Visible Controls**: Terminal installation output, backend console startup log, extension status badge in browser.
- **Backend Dependencies**: Health endpoint `/api/v1/health`, database migration, local auth token generation.
- **Remote Dependencies**: Gamma API connectivity, Polymarket CLOB endpoints.
- **Acceptance Criteria**: Backend health returns 200 OK, DB WAL mode initialized, extension loaded in Chromium without manifest errors.

## Journey 2: Terminal Readiness & Market Data Streaming
- **User Intention**: Open Polymarket page, view active 5m BTC market, live bid/ask, Chainlink BTC/USD price, fixed price-to-beat reference, countdown.
- **Visible Controls**: Header state (`OFFLINE`, `READ_ONLY`, `LIVE_DISARMED`), Market Selector, Price to Beat, Chainlink Live Value, Difference, Countdown.
- **Backend Dependencies**: Gamma market discovery, CLOB market WebSocket subscription, Chainlink RTDS WebSocket subscription, `LiveReadiness` evaluator.
- **Acceptance Criteria**: Exact UP/DOWN token mapping validated, Chainlink live feed data age < 5s, fixed anchor validated, readiness state accurately reflects prerequisites.

## Journey 3: Account Sync & Dynamic Preset Calculation
- **User Intention**: Connect L2 credentials, view collateral balance & allowance, configure BUY/SELL price presets and size presets.
- **Visible Controls**: Account address, collateral balance (USDC.e), Preset Editor (Mode: CENT, PERCENT, ABSOLUTE; Reference: BEST_BID, BEST_ASK, MIDPOINT), Dynamic Price Buttons.
- **Backend Dependencies**: `clobClient.getBalanceAllowance`, user WebSocket L2 authentication, preset persistence in SQLite.
- **Acceptance Criteria**: Account balance reflects funder/deposit wallet, price preset buttons render calculated numeric prices (e.g., `[34¢] [32¢] [20¢]`) clamped to valid maker tick bounds.

## Journey 4: Live Execution Arming & One-Tap Order Placement
- **User Intention**: Explicitly arm live trading via `[HOLD TO ARM LIVE]`, tap a dynamic price button to place a post-only limit order.
- **Visible Controls**: `[HOLD TO ARM LIVE]` button, `LIVE_ARMED` indicator, BUY size ($10, $25, $50, $100), numeric price buttons.
- **Backend Dependencies**: Arming state expiration timer, atomic idempotency reservation, `clobClient.postOrder` with `postOnly=true`.
- **Acceptance Criteria**: Execution disabled when disarmed, `pointerdown` captures exact price, atomic request reservation prevents duplicate orders, remote order ID returned and displayed.

## Journey 5: Open Order Management & Cancellation
- **User Intention**: View active open orders in Open Orders tab, cancel individual orders or execute Cancel All.
- **Visible Controls**: Orders Tab, `[CANCEL]` per row, `[CANCEL ALL]` button.
- **Backend Dependencies**: User WS order updates (`LIVE`, `CANCEL_PENDING`, `CANCELLED`), `clobClient.cancelOrder`, `clobClient.cancelAll`.
- **Acceptance Criteria**: Order transitions to `CANCEL_PENDING`, remote confirmation updates status to `CANCELLED`, collateral/shares unlocked.

## Journey 6: Fill Processing, Position Tracking & SELL Sizing
- **User Intention**: Receive real fill notifications, track positions, average entry, realized/unrealized P&L, execute SELL orders based on position percentages.
- **Visible Controls**: Positions Tab, SELL size buttons (`[25%] [50%] [100%] [Custom]`), SELL price buttons.
- **Backend Dependencies**: User WS `fill` events, SQLite `fills` and `positions` table aggregation, net position calculation.
- **Acceptance Criteria**: Fills immediately update net shares and average entry price; SELL orders calculate shares based on unreserved net position; realized P&L updated on SELL fills.

## Journey 7: Startup Reconciliation & Shutdown Recovery
- **User Intention**: Restart backend process, reload extension, maintain authoritative state without duplicate submissions or lost orders.
- **Visible Controls**: Reconnect banner (`BACKEND OFFLINE` -> `RECONCILING` -> `LIVE_DISARMED`), full snapshot reload.
- **Backend Dependencies**: Boot sync querying CLOB `getOpenOrders()` and `getTrades()`, state reconciliation before enabling live arming.
- **Acceptance Criteria**: Backend restart syncs remote orders and fills with SQLite, resolves unknown states, and requires re-arming before submitting new orders.

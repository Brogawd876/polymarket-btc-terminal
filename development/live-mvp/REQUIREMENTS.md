# Live MVP Scope and Architecture Requirements

## 1. Operational States
The system must strictly support the following 9 operational states:
- `OFFLINE`: Extension disconnected from local backend.
- `READ_ONLY`: Public data working, credentials/stream incomplete.
- `LIVE_DISARMED`: All prerequisites pass, execution disarmed.
- `LIVE_ARMED`: Prerequisites pass, user armed execution.
- `SUBMITTING`: Order submission in progress.
- `RECONCILING`: Ambiguous local/remote order state resolving.
- `STALE_DATA`: Data freshness exceeded threshold (>5s).
- `MARKET_SWITCHING`: Transitioning to next 5-minute window.
- `ERROR`: Unrecoverable error present.

Paper mode (`PAPER` state, paper toggle, fake balances) is completely removed from production builds.

## 2. Backend Authority
The Fastify backend is the single authority for:
- Account & L2 Credentials
- LiveReadiness calculation (`blockingReasons`)
- Price Anchor & Fixed Reference
- Order Validation & Atomic Reservation
- Idempotency & Order Lifecycle
- Positions & P&L Calculation

The extension background worker acts as the sole localhost transport via `chrome.runtime.Port`. React panel components communicate only with the background worker.

## 3. Execution & Sizing
- Order Type: Post-only GTC limit orders.
- BUY Sizing: Fixed dollar amounts ($10, $25, $50, $100, Custom). Shares calculated as `D / P` with tick and share precision rounding.
- SELL Sizing: Outcome position percentages (25%, 50%, 100%, Custom shares) based on unreserved position shares.
- Dynamic Presets: Separate BUY and SELL presets with `PERCENT_OFFSET`, `CENT_OFFSET`, `ABSOLUTE_PRICE` relative to `BEST_BID`, `BEST_ASK`, `MIDPOINT`, `LAST_TRADE`.
- Button Labels: Price figures only (e.g. `[34¢] [32¢] [20¢]`).
- Price Capture: Captured on `pointerdown`. Clamped to maker-safe limits (`ask - tick` for BUY, `bid + tick` for SELL).

## 4. Lifecycle & Reconciliation
- User Stream: Authenticated L2 WebSocket user channel.
- Startup Sync: Sync open orders and recent fills on boot before completing reconciliation.
- Position Accounting: Derived solely from actual fills and actual fill prices.
- Resolution & Settlement: Track market closure and outcome resolution.

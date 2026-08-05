# Runtime Plan

## Metrics Tracking
- **Data Age Monitoring**: The backend must track the difference between `Date.now()` and the last received Chainlink timestamp (or `Date.now()` when the message was received).
- **Heartbeat & Reconnects**: The WebSocket must send pings or expect regular messages. If no message is received within a timeout period, close and reconnect the socket to prevent silent failures.
- **Price Metrics**: Extract and calculate the price difference, current value, leading direction, and price to beat in memory, making these available for fast retrieval upon a `PLACE_ORDER` request.

## Stale Lock Enforcement
- At runtime, any configured action (like trading) must query the in-memory `isRtdsStale()` function, which acts as a hard gate. This function computes staleness on the fly based on `Date.now()` and the last update timestamp.
- If data is stale, the error returned must be logged with `pino` and sent back to the connected extension client.

# Runtime Plan: Phase 5

## Metrics & Monitoring
- Monitor latency between WS `MARKET_UPDATE` receipt on the extension and the re-rendering of preset button prices.
- Log execution prices to ensure clamping rules are not violated on edge-case racing conditions.

## Fallback Mechanisms
- If preset computation errors out or reference prices are unavailable (stale), all preset buttons must fall back to a disabled state with clear visual indicators.
- If the USD-to-shares calculation yields an invalid amount (e.g. 0), the order must be cleanly rejected by the API before submission to the exchange.

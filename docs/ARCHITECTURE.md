# Polymarket Terminal Architecture

## Status and authority

This document describes the target authoritative architecture for the reliability program. It is a design contract, not proof that every component is implemented. Current evidence and known gaps belong in `docs/VERIFICATION_REPORT.md`.

The backend is authoritative for execution. The Polymarket page is view context and optional anchor evidence only. The extension must never turn scraped page state into the backend's execution market.

## Boundaries and data flow

```text
Polymarket public feeds ---> PublicMarketDataService ---+
Chainlink RTDS -----------> Reference/AnchorService ----+--> TerminalSnapshot
Gamma discovery ----------> MarketService -------------+         |
                                                               authenticated
Chrome extension <------ local background connection <--------- WebSocket
       |                                                        |
       +-- page market observation                              v
                                                         ExecutionService
                                                               |
                                        repositories/SQLite <--+--> CLOB API
                                                               ^
                                                        authenticated user feed
```

- `packages/shared` owns versioned, direction-specific command and event schemas.
- The extension content UI talks through its background worker. Page JavaScript receives no credential and cannot invoke trading commands.
- Public market data works without signer or private API credentials.
- Private account access, signing, submission, cancellation, and reconciliation remain backend-only.
- SQLite is the durable local lifecycle and accounting store. Exchange state is reconciled rather than guessed.

## Authoritative identities

Three market identities are intentionally separate:

- `executionMarketId`: backend-selected CURRENT contract; the only market eligible for execution.
- `viewMarketId`: contract displayed in a particular panel session; PREVIOUS and NEXT may be inspected.
- `pageMarketId`: contract inferred from the active Polymarket URL; used to warn or offer navigation.

An order intent is valid only when condition ID, token ID, outcome, execution market revision, and executable quote all match the authoritative CURRENT market. No token-array ordering fallback is permitted.

## Atomic terminal state

The backend publishes monotonically increasing `TerminalSnapshot` revisions. A snapshot contains qualified PREVIOUS/CURRENT/NEXT markets, both books, anchor, reference, transition phase, readiness, account data, orders, positions, settings, and diagnostics. The extension ignores older revisions and applies each snapshot atomically.

`BookState` records bid, ask, spread, depth, last trade, tick, minimum size, exchange and receive timestamps, book version, last-good time, and quality (`INITIALIZING`, `FRESH`, `STALE`, `RECOVERING`, or `INVALID`). Missing, crossed, or malformed updates do not replace a valid display price with zero. Last-good values remain visible with a stale label and are never executable.

Anchors are persisted with market window, source timestamp, source, validation method, and evidence. A current spot tick is not an opening anchor. Page observations may corroborate an anchor for the same window but cannot select or mutate the execution market.

## State machines

### Market transition

```text
STEADY -> CUTOFF -> SWITCHING -> VALIDATING_ANCHOR
       -> WAITING_FOR_BOOKS -> LIVE_DISARMED
```

Entering CUTOFF or losing any required feed disarms execution. NEXT is preloaded, CURRENT changes atomically, and PREVIOUS remains available for late fills and settlement. Recovery never restores `LIVE_ARMED` automatically.

### Order lifecycle

```text
CREATED -> VALIDATING -> SUBMITTING -> ACCEPTED -> OPEN/PARTIAL -> FILLED
                         |              |             +---------> CANCEL_PENDING
                         |              +-----------------------> REJECTED
                         +-> UNKNOWN -> RECONCILING -> resolved exchange state
```

The backend persists the local intent and reserves collateral or shares before the network call. Transport uncertainty is not a rejection and must block duplicate retry until reconciled. Cancellation is not final until remotely confirmed. Confirmed fills update order totals, reservations, positions, fees, P&L, and client outbox in one transaction.

### Readiness and arming

Readiness is derived from structured checks: market identity and phase, both book qualities and source ages, validated anchor, reference age, authenticated user stream, account balance, allowance, reconciliation, unresolved submissions, cutoff, and configured risk limits. Any blocker disables execution and clears arming. Arming is bounded, explicit, backend-held state.

## Quotes, sizing, and risk

The backend owns preset calculation, tick rounding, financial sizing, and disabled reasons. `ExecutableQuote` binds the exact displayed price to market revision, book version, tick, maker boundary, and expiry. Maker submission uses that exact price or rejects the expired quote; it never silently reprices.

BUY intent is expressed in dollars and converted to shares server-side. SELL intent uses available shares after subtracting active reservations. Maker GTC and Immediate FAK use one execution lifecycle. Immediate results retain requested, executed, and unfilled quantity, average price, fees, and terminal or uncertain status.

## Persistence and reconciliation

Numbered transactional migrations own schema evolution. Durable records include orders, append-only order events, remote trade lifecycle, confirmed fills, reservations, positions, sessions, reconciliation runs/cursors, outbox events, connection events, and audit events. A canonical launcher-provided data directory prevents accidental parallel databases.

Startup and every private-stream reconnect perform paginated reconciliation. Lookup failure leaves an order `UNKNOWN` or `RECONCILING`; it never implies cancellation. Remote-only orders and confirmed trades are imported with source attribution. Event IDs and stable trade/order keys provide deduplication.

## Start, stop, and extension reload

- `start.bat` validates configuration, owns one backend instance, starts it, and builds the Chrome extension only when source/version hashes changed.
- `STATUS.bat` reports the owned process, health, data path, extension build version, and blockers without modifying state.
- `STOP.bat` disarms, stops command intake, flushes SQLite, closes feeds, and terminates only the recorded owned process. Open orders are preserved unless an explicit persisted policy requests cancellation.
- The canonical unpacked extension path is `apps/extension/dist/chrome-mv3`.
- A changed extension build requires Reload at `chrome://extensions` and then a Polymarket page refresh. Backend-only changes require a backend restart but no extension reload.

## Evidence and release gates

CI runs only deterministic checks without credentials or live trading. Browser QA, reconciliation evidence, and any capped live smoke are separately recorded against a commit. A green build proves compilation; unit tests prove their covered behavior; neither proves exchange correctness. Live readiness requires every release gate in `docs/VERIFICATION_REPORT.md` to have dated, reproducible evidence.

# Polymarket Integration Guide

## Authentication & API-Key Derivation
Polymarket (CLOB) uses L2 authentication on Polygon. API keys are derived by signing a standardized EIP-712 message with a Web3 wallet (EOA or Smart Contract wallet like Safe). 
Credentials consist of:
- `POLYMARKET_API_KEY`
- `POLYMARKET_API_SECRET`
- `POLYMARKET_API_PASSPHRASE`

## Wallet & Deposits
To deposit and trade on the Polymarket CLOB:
- Use USDC.e on Polygon (Bridged USDC).
- Transfer to the associated Polymarket deposit address or Proxy Wallet (CTF Exchange).

## Signature Types
- **EOA Wallet Signature:** ECDSA signature using the user's private key for derivation.
- **EIP-712 / EIP-191:** Used for creating L2 limit orders, cancel requests, and other authenticated CLOB actions.

## Market Discovery & Real-Time Data (WebSocket / Chainlink RTDS)
- **Market Discovery:** Queries the CLOB REST API endpoints for active BTC/USD markets.
- **WebSocket Reconnection:** Uses exponential backoff to handle disconnects seamlessly.
- **Snapshot Recovery:** Resyncs the orderbook snapshot over REST upon reconnection before resuming delta processing.
- **Out-of-order Tolerance:** Tracks message sequence numbers. Drops any message older than the currently processed sequence.
- **Data-Age Tracking:** Attaches a `lastUpdated` timestamp. If updates stale for > 30 seconds, falls back to polling or Chainlink Data Streams (RTDS).

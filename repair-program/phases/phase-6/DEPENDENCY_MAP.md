# Phase 6 Dependency Map

## Direct Dependencies
- `@polymarket/clob-client-v2`: Core API client for REST and SDK signing.
- `ethers`: Web3 utility for Ethereum/Polygon wallet initialization and RPC calls.
- `zod`: Schema validation for WebSocket messages (must be updated in `shared`).

## Internal Packages
- `@polymarket-btc/shared`: Used to share the `PLACE_ORDER` WS schema between the Extension and the Server.

## Environment Variables
- `PRIVATE_KEY`: Web3 EOA wallet key on Polygon.
- `ENABLE_LIVE_TRADING`: Flag enabling live mode.
- `POLYGON_RPC_URL`: Endpoint for fetching native balance on the blockchain.

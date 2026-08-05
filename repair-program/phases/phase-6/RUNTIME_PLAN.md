# Phase 6 Runtime Plan

## Environment Verification
- Ensure `PRIVATE_KEY` starts with `0x` or is exactly 64 hex chars.
- Optionally verify `POLYGON_RPC_URL` is accessible.

## Boot Sequence
1. Start node server (`npm run dev`).
2. Fastify boots, `createTradingAdapter()` is invoked.
3. Factory sees `ENABLE_LIVE_TRADING=true`, reads `PRIVATE_KEY`, instantiates `ethers.Wallet`, instantiates `OfficialSdkTradingAdapter`.
4. `OfficialSdkTradingAdapter` generates Clob API keys seamlessly.
5. WS connections to User and Market channels open.

## Ongoing Execution
- UI sends `PLACE_ORDER` with `orderType: 'FAK'` over WS.
- Route parser passes `orderType` to `adapter.placeOrder()`.
- Adapter calls `ClobClient.createOrder` followed by `postOrder`.
- On success, WS immediately replies to UI with `ORDER_UPDATE` (`status: PENDING`).
- WS listener (`wsUser`) later picks up fill/cancel events, writes to DB, emits async `ORDER_UPDATE` to all connected clients.

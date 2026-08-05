# Test Plan

## Unit Tests
- `packages/shared`: Validate that all schemas correctly accept valid inputs and reject missing envelopes or invalid fields.

## Integration Tests
1. **Authentication Flow**
   - Assert the server exposes `/api/v1/auth/token`.
   - Assert the extension successfully retrieves the token.
   - Assert the WS connection is established and the extension sends an `AUTH` message.
   - Assert the server replies with `AUTH_OK`.
2. **Negative Authentication**
   - Connect with an invalid token -> Expect `AUTH_ERROR` and connection closure.
   - Send order without authenticating -> Expect message to be rejected.
3. **Idempotency**
   - Send `PLACE_ORDER` with `id: "req-1"`. Expect a successful order response.
   - Send identical `PLACE_ORDER` with `id: "req-1"`. Expect the exact same order response without executing a new order on Polymarket.
4. **Snapshot Sync**
   - Force disconnect the WS connection.
   - Upon reconnect, verify the extension sends `AUTH` and expects a `SNAPSHOT` message to resynchronize UI state.
5. **Content Script Security**
   - Ensure the content scripts make no network tab calls to localhost. All data must flow over the WXT messaging channel.

## End-to-End
- Start backend, start extension on polymarket.com.
- Check UI rendering (Balance, Positions, Orders).
- Execute a test trade and verify it processes correctly.

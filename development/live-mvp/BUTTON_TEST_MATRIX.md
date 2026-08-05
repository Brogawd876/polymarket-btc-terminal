# Live MVP Button Test Matrix

| Screen | Control Label | User Intention | Emitted Event | Backend Handler | DB Effect | Remote Effect | Success Feedback | Failure Feedback | Status |
|--------|---------------|----------------|---------------|-----------------|-----------|---------------|------------------|------------------|--------|
| Header | `[HOLD TO ARM LIVE]` | Arm live execution | `ARM_LIVE` | `handleArmLive` | None | None | State -> `LIVE_ARMED` | Blocked error toast | Pending |
| Header | `[DISARM]` | Disarm live execution | `DISARM_LIVE` | `handleDisarmLive` | None | None | State -> `LIVE_DISARMED` | None | Pending |
| Trade | BUY Size `$10`, `$25`, `$50`, `$100` | Select BUY USD spend | Local UI state | None | None | None | Input value updated | None | Pending |
| Trade | BUY Price `[34¢]` | Place Post-only BUY order | `PLACE_ORDER` | `handlePlaceOrder` | `idempotency` + `orders` insert | `clobClient.postOrder` | Status -> `LIVE` | `REJECTED: <reason>` | Pending |
| Trade | SELL Size `25%`, `50%`, `100%` | Select SELL position % | Local UI state | None | None | None | Shares input updated | None | Pending |
| Trade | SELL Price `[65¢]` | Place Post-only SELL order | `PLACE_ORDER` | `handlePlaceOrder` | `idempotency` + `orders` insert | `clobClient.postOrder` | Status -> `LIVE` | `REJECTED: <reason>` | Pending |
| Orders | `[CANCEL]` | Cancel individual order | `CANCEL_ORDER` | `handleCancelOrder` | `orders` update `CANCELLED` | `clobClient.cancelOrder` | Order removed | Error toast | Pending |
| Orders | `[CANCEL ALL]` | Cancel all open orders | `CANCEL_ALL` | `handleCancelAll` | `orders` update `CANCELLED` | `clobClient.cancelAll` | All orders removed | Error toast | Pending |
| Settings | `[SAVE SETTINGS]` | Persist presets/settings | `UPDATE_SETTINGS` | `handleUpdateSettings` | `presets` & `settings` update | None | `SETTINGS_UPDATED` toast | Validation error | Pending |

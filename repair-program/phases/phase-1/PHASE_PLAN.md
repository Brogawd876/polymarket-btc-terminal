# Phase Plan

**PHASE ID**: 1
**PHASE OBJECTIVE**: Create one correct, authenticated, reconnectable protocol between backend and extension.
**BASELINE COMMIT**: current

**CURRENT BEHAVIOR**:
- Token is hardcoded as `polymarket-local-secret` in the extension and checked against `.env` in the backend.
- The shared `WsEvent` schema lacks strict envelopment with request IDs and is missing multiple required message types.
- Extension background worker does not fully manage connection state, and `AUTH_OK`/`AUTH_ERROR` logic is absent.
- Extension content script components make unauthenticated REST requests directly to localhost, circumventing the background worker's WS connection.
- No idempotency exists on the server to handle duplicate message sends (e.g. if connection drops and message is re-sent).

**TARGET BEHAVIOR**:
- Backend generates a local API token on startup and serves it via an endpoint. Extension fetches it using explicit host permissions.
- Shared Zod schemas include envelope `{ id, type, payload }` and define all required message types.
- Content scripts route all operations through the background worker.
- Background worker connects via WS, authenticates, receives `AUTH_OK`, requests/receives `SNAPSHOT`, and acts as the sole router for communication.
- Backend stores recent `requestId`s in SQLite for idempotency.

**TARGET FILES**:
- `packages/shared/src/index.ts`
- `apps/server/src/db/index.ts`
- `apps/server/src/routes/index.ts`
- `apps/server/src/index.ts`
- `apps/extension/wxt.config.ts`
- `apps/extension/src/entrypoints/background.ts`

**CONNECTED FILES**:
- `apps/extension/src/entrypoints/content.tsx`
- `apps/extension/src/components/OrdersTab.tsx`
- `apps/extension/src/components/PositionsTab.tsx`
- `apps/extension/src/components/SettingsTab.tsx`

**CALLERS**:
- Extension React UI components (calling background worker)
- Extension background worker (calling backend API/WS)

**CALLEES**:
- Backend Fastify Routes / WebSocket handlers
- Background worker message listener

**SHARED CONTRACTS**:
- `packages/shared/src/index.ts`: Strongly typed enums/schemas for WS payloads.

**ENVIRONMENT VARIABLES**:
- None needed for token anymore, token will be generated to a local file/DB. We may still support overriding via `.env` but default behavior should be auto-generation.

**DATABASE IMPACT**:
- Add `idempotency` table in `apps/server/src/db/index.ts` containing `requestId`, `response`, and `createdAt` to drop duplicate orders/cancellations.

**FRONTEND IMPACT**:
- Components no longer use `fetch`. All data comes from the background worker via `chrome.runtime.sendMessage`.
- The frontend will rely on a local cache maintained by the background worker, which initializes upon receiving `SNAPSHOT`.

**BACKEND IMPACT**:
- Token generation logic added.
- Message parsing updated to accommodate envelope schema and idempotency check.
- Emits correct updated events for auth and other state changes.

**TEST IMPACT**:
- Negative tests must verify that invalid tokens are rejected.
- Negative tests must verify unauthenticated orders are rejected.
- Negative tests must verify duplicate request IDs receive the original stored response.
- Restart tests to verify reconnection and full state snapshot sync.

**OPERATIONS IMPACT**:
- End user will not need to configure `.env` with a token manually. The extension will automatically pair with the backend.

---

**CONFIRMED DEFECTS**:
- Components fetch directly.
- Hardcoded token.
- Missing idempotency.

**ROOT CAUSES**:
- Initial implementation was a rapid prototype without secure setup constraints or message envelopment.

**NON-ISSUES**:
- N/A

**UNVERIFIED ASSUMPTIONS**:
- The extension is granted `host_permissions` for localhost implicitly by the user on installation, avoiding CORS and enabling the initial token fetch.

**DEPENDENCIES**:
- Shared Zod schema must be implemented first, as both extension and server depend on it.

**RISKS**:
- Changing the messaging protocol breaks the current UI completely until the background and content script updates are completed.

---

**IMPLEMENTATION CELLS**:
1. Update `packages/shared/src/index.ts` with new Schema.
2. Update `wxt.config.ts` to add host permissions.
3. Update `apps/server/src/db/index.ts` for idempotency table.
4. Implement Token Generation in server and expose token endpoint.
5. Update server WebSocket handler to use new schema, idempotency, and required auth flow.
6. Update background worker to fetch token, manage connection states, and bridge messages.
7. Refactor extension UI components to use background worker instead of `fetch`.

**FILE OWNERSHIP**:
- Frontend components: Extension / UI Developer
- Background worker / Server routes: Backend / Protocol Developer

**SEQUENCE**:
1. Shared definitions.
2. Backend Database and API.
3. Extension Background Worker.
4. Extension UI.

**ACCEPTANCE CRITERIA**:
- Backend generates token, extension authenticates via WS.
- Extension UI functions (place order, cancel order, view balance) working exclusively over WS.
- Duplicate requests are ignored.
- Background and backend reconnect gracefully on restart, resyncing via SNAPSHOT.

**NEGATIVE TESTS**:
- Wrong/missing token rejected.
- Unauthenticated order/cancellation rejected.
- Duplicate request ID returns original result.
- Background/Backend restart recovers.
- Invalid message schema rejected.

**REGRESSION TESTS**:
- Existing market subscription logic still updates prices.

**RUNTIME CHECKS**:
- Ensure the connection status UI properly indicates "Connected" only after `AUTH_OK`.
- If `AUTH_ERROR` occurs, block further requests and show an error.

**ROLLBACK PLAN**:
- Revert schema and server route modifications to use the legacy untracked payload format if blocking issues occur.

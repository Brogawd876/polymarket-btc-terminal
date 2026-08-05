# Phase 1 Scan Report

## Codebase Structure
- **apps/server**: Fastify backend for handling API and WS connections, integrated with SQLite (better-sqlite3).
- **apps/extension**: WXT-based Chrome extension (React/Tailwind) that provides an overlay terminal on Polymarket.
- **packages/shared**: Zod schemas defining shared types between the frontend and backend.

## Findings
1. **Authentication:** 
   - Currently uses a hardcoded token `polymarket-local-secret` in `apps/extension/src/entrypoints/background.ts`.
   - The backend checks this against `process.env.WS_AUTH_TOKEN`.
   - There is no dynamic token generation.
2. **WebSocket Messages:**
   - The shared schemas (`packages/shared/src/index.ts`) only define `SUBSCRIBE_MARKET`, `MARKET_UPDATE`, `RTDS_UPDATE`, `ORDER_UPDATE`, `PLACE_ORDER`, `CANCEL_ORDER`, `PING`, `ERROR`.
   - The required messages (`AUTH`, `AUTH_OK`, `AUTH_ERROR`, `PONG`, `SNAPSHOT`, `MARKET_UPDATED`, `REFERENCE_PRICE_UPDATED`, `PRESET_PRICES_UPDATED`, `POSITION_UPDATED`, `CONNECTION_UPDATED`, `MODE_UPDATED`) are missing.
   - Request IDs are not defined in the message envelopes.
3. **Rest Calls vs WebSocket:**
   - React components in the extension (`OrdersTab.tsx`, `PositionsTab.tsx`, `SettingsTab.tsx`, and `content.tsx` for `balance`) are currently performing direct, unauthenticated `fetch` calls to `http://localhost:3001/api/...`.
   - The requirement is that content scripts do not make direct REST calls and that the background worker owns backend communication.
4. **Idempotency:**
   - No request tracking or idempotency exists on the server.
5. **Extension Permissions:**
   - `wxt.config.ts` specifies `host_permissions` for `polymarket.com` but lacks explicit permissions for `http://127.0.0.1:3001/*` or `localhost`.

## Proposed Changes
- **Shared Schema Package:** Update `packages/shared/src/index.ts` to include an enveloped message structure: `{ id: string, type: string, payload: any }`. Add all required message schemas.
- **Backend Token Generation:** On backend start, generate a secure random token if one does not exist, save it to `data/local-token.txt` or `.env`. Expose an endpoint `/api/v1/auth/token` with proper CORS (so only the extension with host_permissions can access it).
- **Background Worker:** Modify `background.ts` to fetch the token, authenticate via WS, handle reconnection, and listen for messages from content scripts to bridge them to the WS. Store state and serve snapshots to UI.
- **Content Scripts:** Refactor UI tabs to use `chrome.runtime.sendMessage` instead of `fetch`.
- **Backend WS Handling:** Update `apps/server/src/routes/index.ts` to enforce `requestId` idempotency (store processed request IDs in SQLite) and handle the new message types.

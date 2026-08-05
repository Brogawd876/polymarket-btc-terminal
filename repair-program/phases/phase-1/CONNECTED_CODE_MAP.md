# Connected Code Map

## Shared Schemas
- `packages/shared/src/index.ts`: The central location for all WS message schemas and types. Updating this affects both the extension and server.

## Backend (apps/server)
- `apps/server/src/index.ts`: Entry point. Needs to call token generation logic.
- `apps/server/src/routes/index.ts`: Registers REST routes and WS handler. Must be updated to map new WS message types, implement idempotency via request IDs, and add the auth token endpoint.
- `apps/server/src/db/index.ts`: Database setup. Needs an `idempotency` table for tracking processed request IDs.

## Extension (apps/extension)
- `wxt.config.ts`: Configuration file. Needs explicit localhost host permissions.
- `apps/extension/src/entrypoints/background.ts`: The background worker. Must be updated to fetch the token, establish the WS connection, authenticate, handle `SNAPSHOT`, and proxy messages for content scripts.
- `apps/extension/src/entrypoints/content.tsx`: The content script. Needs to be updated to no longer make direct fetch calls to `polymarket.com` or local APIs if possible, and rely on background messages.
- `apps/extension/src/components/OrdersTab.tsx`: Refactor `fetch` to `chrome.runtime.sendMessage`.
- `apps/extension/src/components/PositionsTab.tsx`: Refactor `fetch` to `chrome.runtime.sendMessage`.
- `apps/extension/src/components/SettingsTab.tsx`: Refactor `fetch` to `chrome.runtime.sendMessage`.

# Dependency Map

## Internal Dependencies
- The extension components (`OrdersTab`, `PositionsTab`, `SettingsTab`) depend on the background worker to relay messages to the backend.
- The background worker depends on the backend REST endpoint to retrieve the initial authentication token securely.
- Both the extension and backend rely strictly on `packages/shared` to serialize/deserialize WebSocket messages with Zod.

## External Dependencies
- **Zod**: Used for runtime validation of the enveloped websocket payloads.
- **Fastify & fastify/websocket**: Manages the backend WS server and the endpoints to retrieve the local API token.
- **Better-SQLite3**: The backend uses SQLite. This will be extended to handle request ID caching for idempotency.
- **WXT**: The framework for building the Chrome extension. Requires configuration in `wxt.config.ts` to allow local cross-origin connections.

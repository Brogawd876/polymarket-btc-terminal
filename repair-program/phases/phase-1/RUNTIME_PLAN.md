# Runtime Plan

## Metrics & Monitoring
- **WebSocket Connection State**: The extension should visibly reflect whether it is connected or disconnected.
- **Idempotency Cache Growth**: Ensure the idempotency table purges requests older than 24 hours to prevent unbounded DB growth.

## Recovery Mechanisms
- **WebSocket Disconnection**: The background worker should attempt to reconnect using exponential backoff (e.g., 1s, 2s, 4s, up to 30s).
- **Stale State Recovery**: If the connection drops, upon reconnect, the extension should immediately request a full `SNAPSHOT` to overwrite any stale data.

## Deployment Notes
- Ensure the server process has write access to its local directory to generate and save the token file (or save to the DB).
- Extension must be reloaded with the new `host_permissions` for the local token fetch to succeed.

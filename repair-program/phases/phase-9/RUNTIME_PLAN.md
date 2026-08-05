# Runtime Plan: Packaging & Build

## Environment Setup
- Node.js >= 20.0.0 installed on the host.
- Environment variables (`DATABASE_URL`, `PORT`, etc.) properly populated in a `.env` file before executing the backend bundle.

## Execution Flow
1. User invokes `start-prod.ps1`.
2. Script verifies that `dist/bundle.js` exists.
3. Script executes `node dist/bundle.js`.
4. Bundle loads external dependencies (`better_sqlite3.node`) dynamically from the same folder.
5. Fastify server listens on the configured port.

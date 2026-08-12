# Implementation Assignments: Packaging & Build

1. **Extension Config (wxt.config.ts)**:
   - Add `sourcemap: false` to the `vite` block in `apps/extension/wxt.config.ts`.
2. **Server Build Node Wrapper**:
   - Create `apps/server/scripts/copy-assets.js` that imports `fs` and `path`, resolves the `better_sqlite3.node` file, and copies it to `dist/`.
   - Update `apps/server/package.json` to replace `copy node_modules...` with `node scripts/copy-assets.js`.
   - Alternatively, remove `pkg` entirely and define a `start-prod.ps1` script for Windows users.
3. **Operations Documentation**:
   - Write `OPERATIONS.md` with Windows PowerShell specific commands for building the extension and starting the server.

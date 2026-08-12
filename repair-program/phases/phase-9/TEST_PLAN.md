# Test Plan: Packaging & Build

## Extension Tests
- Run `pnpm --filter extension package`.
- Extract the generated `.zip` file from `.output/` or `dist/`.
- Assert that no `.js.map` files exist in the extracted folder.

## Backend Tests
- Run `pnpm --filter server package-exe` (or the equivalent bundle script).
- Verify `dist/bundle.js` and `dist/better_sqlite3.node` exist.
- Run `node dist/bundle.js` locally on Windows.
- Assert that the server starts up without any `Error: Cannot find module 'better_sqlite3.node'` errors.

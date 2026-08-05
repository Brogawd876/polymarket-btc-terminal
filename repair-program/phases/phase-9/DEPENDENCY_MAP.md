# Dependency Map: Packaging & Build

## Build Tools
- `wxt`: Extension building and packaging.
- `vite`: Build system underneath WXT.
- `esbuild`: Server backend bundler.
- `pkg` (deprecated): Currently used for binary generation, will be replaced or supplemented by clear `.ps1` wrapper scripts running Node.js.

## Node.js
- Expected runtime: `>=20.0.0`
- External binaries: `better-sqlite3` native `.node` file requires explicit copying.

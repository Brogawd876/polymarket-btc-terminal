# Phase 9 Scan Report: Packaging & Build

## Scan Scope
- Root `package.json` build and package scripts.
- `apps/extension/package.json` and `apps/extension/wxt.config.ts`.
- `apps/server/package.json` backend bundling and packaging scripts.

## Findings
1. **Extension**: 
   - Uses `wxt build` and `wxt zip`.
   - `wxt.config.ts` does not explicitly define sourcemap settings to ensure they are excluded from production builds.
2. **Server**:
   - Uses `esbuild` for bundling and `pkg` for executable generation.
   - The `package-exe` script contains a hardcoded `copy` command (`copy node_modules\\better-sqlite3\\build\\Release\\better_sqlite3.node dist\\`) which uses Windows `cmd.exe` syntax, potentially breaking in standard PowerShell or Git Bash environments.
   - `pkg` is a deprecated library. Given the requirements, shipping a robust bundle (`dist/bundle.js`) alongside an execution script (`.ps1`) is preferable, or replacing the hardcoded `copy` with a Node.js wrapper (e.g., `fs.copyFileSync`) or a `shx` command.

## Next Steps
- Update `apps/extension/wxt.config.ts` to explicitly set `sourcemap: false` in Vite config.
- Refactor `apps/server/package.json` package scripts. Replace Windows cmd specific `copy` command with a cross-platform script or a `.ps1` script that correctly resolves and copies `better_sqlite3.node`.
- Provide a `start-prod.ps1` script at the root or server app to easily launch the built backend.
- Write `OPERATIONS.md` detailing how to run these build and start commands.

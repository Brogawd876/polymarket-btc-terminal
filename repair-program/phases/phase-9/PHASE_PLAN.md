PHASE ID
Phase 9

PHASE OBJECTIVE
Ensure the extension and backend can be reliably built, packaged, and operated on Windows.

BASELINE COMMIT
N/A

CURRENT BEHAVIOR
- The WXT extension builds, but source maps might be exposed if not explicitly disabled.
- The server's `package-exe` script uses `copy` from Windows `cmd`, which fails in bash and can be inconsistent in standard npm execution contexts.
- There is no documented or unified set of standard scripts ensuring single-command builds and startups verified for PowerShell on Windows.

TARGET BEHAVIOR
- `wxt.config.ts` explicitly drops sourcemaps for production.
- `package.json` build/package scripts for the backend use a robust cross-platform Node script or a `.ps1` script to handle native files (`better-sqlite3`), avoiding hardcoded `cmd` functions like `copy`.
- Users can run a single command (e.g., `pnpm package:extension`) to get a clean `.zip` for Chrome/Firefox.
- Users can run a single command (e.g., `pnpm start:server` or a `.ps1` script) to run the packaged backend on Windows.

TARGET FILES
- `apps/extension/wxt.config.ts`
- `apps/server/package.json`
- `apps/server/scripts/package.ts` (or `.ps1` script for packaging)
- `scripts/build.ps1`
- `scripts/start-server.ps1`

CONNECTED FILES
- `package.json` (Root)

CALLERS
- Developer CLI

CALLEES
- Build systems (`wxt`, `vite`, `esbuild`)

SHARED CONTRACTS
- The backend expects `better_sqlite3.node` in the same directory as the executing bundled code.

ENVIRONMENT VARIABLES
- Depends on existing variables (e.g., `NODE_ENV=production`)

DATABASE IMPACT
- The SQLite native binary must be resolvable at runtime after the build/bundle process.

FRONTEND IMPACT
- Zero-sourcemap production zip ensures smaller size and security of frontend code.

BACKEND IMPACT
- Clear execution pipeline (`dist/bundle.js` + `.node` file) for production environments.

TEST IMPACT
- Need to ensure build passes on Windows and artifact paths are verified.

OPERATIONS IMPACT
- Clear and robust steps provided in `OPERATIONS.md`.

CONFIRMED DEFECTS
- Use of `copy` command in server `package.json` limits cross-platform / cross-shell compatibility on Windows.

ROOT CAUSES
- Relying on shell-specific file operations instead of Node.js `fs` API or standard tools.

NON-ISSUES
- The actual source code logic.

UNVERIFIED ASSUMPTIONS
- WXT handles zipping perfectly fine, as long as sourcemaps are disabled in vite config.
- `esbuild` correctly ignores `*.node` as external when configured.

DEPENDENCIES
- Node.js >=20
- wxt
- esbuild

RISKS
- SQLite native bindings breaking if Node versions mismatch between build and run.

IMPLEMENTATION CELLS
1. **Extension Config:** Update `wxt.config.ts` to disable sourcemaps.
2. **Server Build Script:** Create a Node.js script (`apps/server/scripts/copy-assets.js`) or `.ps1` wrapper to cleanly copy `better_sqlite3.node` to `dist`. Update `apps/server/package.json` to use this script.
3. **Operations README:** Write `OPERATIONS.md` detailing the build, package, and run instructions.

FILE OWNERSHIP
- `apps/extension/wxt.config.ts`
- `apps/server/package.json`

SEQUENCE
1. Modify `wxt.config.ts`.
2. Update backend packaging scripts and test copy behavior.
3. Document operations.

ACCEPTANCE CRITERIA
- `pnpm package:extension` produces a zip without `.map` files.
- Backend can be fully built and started via PowerShell without `cmd` errors.
- `OPERATIONS.md` explains the exact commands.

NEGATIVE TESTS
- Ensure `better_sqlite3.node` is not missing from `dist` upon backend bundle.
- Ensure `.map` files are not found in the extension dist.

REGRESSION TESTS
- Verify end-to-end functionality using the produced zip and bundle.

RUNTIME CHECKS
- `start-server.ps1` checks for the existence of `dist/bundle.js` before executing.

ROLLBACK PLAN
- Revert `package.json` and `wxt.config.ts` changes.

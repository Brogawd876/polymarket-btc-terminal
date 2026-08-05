# Connected Code Map: Phase 10

## Target Files
- `c:\Users\Yasser\Downloads\Polymarket control\repair-program\FINAL_VERIFICATION_REPORT.md` (To be generated)

## Source Files
The entire codebase will be systematically audited (read-only) to verify compliance. Key files to be audited include:
- `package.json` (root, apps, and packages)
- `.github/workflows/` or equivalent CI configurations (if any)
- `tests/e2e/extension-panel.test.ts`
- `packages/server/src/db/index.ts`
- Workspace configuration files (e.g., `pnpm-workspace.yaml`, `tsconfig.base.json`)

## Verification Points
- Backend server startup path resolution
- E2E test passing state
- Execution of workspace and server scripts (`lint`, `typecheck`, `live:diagnose`, `public:diagnose`, `live:smoke`, `db:migrate`, `db:reset:test`)
- End-to-end integration (extension loading + browser interaction)

DEFECT ID: 01
PHASE: 8
CELL: Implementation
SEVERITY: Blocking
OBSERVED BEHAVIOR: pnpm verify fails during E2E testing because balance and realizedPnl are not destructured from useWebSocket in App.tsx, causing a TypeError when PositionsTab tries to format balance.
EXPECTED BEHAVIOR: The variables are correctly passed and tests pass.
REPRODUCTION: Run pnpm verify.
CODE EVIDENCE: App.tsx missing destructuring.
RECOMMENDED RESCAN RADIUS: LOCAL RESCAN

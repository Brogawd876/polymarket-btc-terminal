PHASE ID
Phase 4

PHASE OBJECTIVE
Resolve TypeScript compiler errors blocking successful `pnpm verify` in the Polymarket integration modules.

BASELINE COMMIT
(Determined at runtime)

CURRENT BEHAVIOR
TypeScript compiler errors are present during `pnpm build:server` due to missing `super()` calls, incorrect relative imports, and implicit `any` parameter types.

TARGET BEHAVIOR
All TypeScript errors are resolved, and the project successfully compiles and passes tests when `pnpm verify` is executed.

TARGET FILES
- `apps/server/src/integrations/polymarket/adapters/OfficialSdkTradingAdapter.ts`
- `apps/server/src/integrations/polymarket/adapters/PaperTradingAdapter.test.ts`
- `apps/server/src/integrations/polymarket/index.ts`

CONNECTED FILES
- `apps/server/src/integrations/polymarket/adapters/TradingAdapter.ts`
- `apps/server/src/db/index.ts`

CALLERS
- Server bootstrap modules requiring the Polymarket adapters.

CALLEES
- `db` module.

SHARED CONTRACTS
- `TradingAdapter` abstract class.

ENVIRONMENT VARIABLES
- N/A

DATABASE IMPACT
- None.

FRONTEND IMPACT
- None.

BACKEND IMPACT
- Modifies import paths and minor type adjustments to ensure the server compiles correctly. No logic changes.

TEST IMPACT
- `PaperTradingAdapter.test.ts` is updated to fix implicit `any` type, allowing tests to compile and run.

OPERATIONS IMPACT
- Enables successful CI/CD builds by fixing compilation blockers.

CONFIRMED DEFECTS
1. `OfficialSdkTradingAdapter.ts` is missing a `super()` call in its constructor.
2. `OfficialSdkTradingAdapter.ts` imports from `../../db/index` instead of `../../../db/index`.
3. `index.ts` exports from `./adapter` instead of `./adapters`.
4. `PaperTradingAdapter.test.ts` uses an implicit `any` for the `call` parameter in `mock.calls.find(call => ...)`.

ROOT CAUSES
- Typos and strict TypeScript configurations not properly handled during the initial implementation of the adapter classes.

NON-ISSUES
- The actual logic of the Polymarket trading integration is unaffected.

UNVERIFIED ASSUMPTIONS
- Fixing these specific errors will completely resolve all `pnpm verify` failures in the workspace.

DEPENDENCIES
- N/A

RISKS
- Missing `super()` could have runtime implications if the base class constructor is expected to run, though in this case `TradingAdapter` is abstract and likely has no constructor logic.

IMPLEMENTATION CELLS
- Cell 1: Fix `OfficialSdkTradingAdapter.ts` (import and `super()`)
- Cell 2: Fix `PaperTradingAdapter.test.ts` (explicit typing)
- Cell 3: Fix `index.ts` (export path)

FILE OWNERSHIP
- Backend / Integration Team

SEQUENCE
1. Apply fixes to `OfficialSdkTradingAdapter.ts`.
2. Apply fixes to `PaperTradingAdapter.test.ts`.
3. Apply fixes to `index.ts`.
4. Run `pnpm verify`.

ACCEPTANCE CRITERIA
- `pnpm verify` completes without any TS errors (exit code 0).

NEGATIVE TESTS
- Introducing arbitrary TS errors in these files causes `pnpm verify` to fail again.

REGRESSION TESTS
- `vitest run tests/integration` and `vitest` pass successfully to confirm no regressions.

RUNTIME CHECKS
- Server starts successfully without module resolution errors.

ROLLBACK PLAN
- Revert changes to the 3 target files.

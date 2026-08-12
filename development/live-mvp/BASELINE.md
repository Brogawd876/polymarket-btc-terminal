# Live MVP Baseline State

## Repository Identification
- Repository: `Brogawd876/polymarket-btc-terminal`
- Starting Branch Candidate Comparison:
  - `master`: `635db26` ("Implement final UI bug fixes, fix RTDS parser payload, correct module imports, and stop DB reset on startup")
  - `repair-master`: `7fc6555` ("Fix live Polymarket market discovery")
- Candidate Selected: `repair-master` (Contains newest commit history)
- MVP Branch Created: `live-mvp-recovery` (branched from `repair-master` @ `7fc6555`)

## Initial Build & Verification Status
- `pnpm typecheck`:
  - `apps/server`: `tsc --noEmit` PASS
  - `apps/extension`: `echo typecheck` (NO-OP / MOCK SCRIPT - VIOLATION)
  - `packages/shared`: `echo typecheck` (NO-OP / MOCK SCRIPT - VIOLATION)
- `pnpm lint`:
  - All packages running `echo lint` (NO-OP / MOCK SCRIPT - VIOLATION)
- `pnpm test`:
  - All packages running `echo test` (NO-OP / MOCK SCRIPT - VIOLATION)
- `pnpm test:integration`:
  - `vitest run --passWithNoTests tests/integration`: No tests found (0 assertions - VIOLATION)
- `pnpm public:diagnose`:
  - Runs `scripts/public-diagnose.ts`, prints "Public diagnose completed." without validating endpoints or market status.

## Major Baseline Defect Summary
1. **Mock Verification Scripts**: `package.json` across workspace projects contains `echo lint`, `echo typecheck`, `echo test`, and `--passWithNoTests`.
2. **Outcome Label Mapping Bug**: `DiscoveryService` assumes array order `[0]` = YES/UP, `[1]` = NO/DOWN instead of explicit outcome label matching.
3. **Price-to-Beat Anchor Bug**: `rtds.ts` sets `price_to_beat` dynamically to previous incoming BTC value rather than maintaining a fixed, validated per-market `MarketAnchor`.
4. **Paper Trading Remnants**: `PaperTradingAdapter.ts` and `paper_balance` table exist in production codebase without operational state segregation.
5. **Missing Arming Protocol**: Extension UI lacks the required `[HOLD TO ARM LIVE]` control and `LIVE_ARMED` / readiness state validation.
6. **UI Sizing & Terminology Defect**: UI uses `YES`/`NO` instead of `UP`/`DOWN`, percentage BUY sizing instead of fixed USD spend, and preset text labels on buttons instead of calculated numeric prices only.
7. **Atomic Idempotency Violation**: Server checks idempotency non-atomically and lacks proper state reservation prior to remote CLOB submission.
8. **Missing Authoritative Snapshot & Event Schemas**: `packages/shared` lacks comprehensive `LiveReadiness`, full `OrderState`, `ARM_LIVE`/`DISARM_LIVE` messages, and strict event contracts.

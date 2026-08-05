# Live MVP Defect Ledger

| Defect ID | Component | Description | Severity | Target Fix | Status |
|-----------|-----------|-------------|----------|------------|--------|
| DEF-001 | Scripts | Workspace scripts use `echo lint`, `echo typecheck`, `echo test`, `--passWithNoTests` | Critical | `package.json` | Open |
| DEF-002 | Shared Schemas | `packages/shared/src/index.ts` lacks `LiveReadiness`, 9 operational states, `ARM_LIVE`, `DISARM_LIVE`, `CANCEL_ALL`, full `OrderState` enum | Critical | `packages/shared` | Open |
| DEF-003 | Market Discovery | `discovery.ts` assumes array index `tokens[0]` is YES/UP and `tokens[1]` is NO/DOWN without checking outcome labels | High | `discovery.ts` | Open |
| DEF-004 | RTDS Price Anchor | `rtds.ts` updates `price_to_beat` dynamically to previous tick instead of maintaining fixed per-market `MarketAnchor` | Critical | `rtds.ts` | Open |
| DEF-005 | Paper Trading | Production code contains `PaperTradingAdapter.ts` and `paper_balance` table | High | `apps/server` | Open |
| DEF-006 | Extension UI | UI uses YES/NO terminology instead of UP/DOWN | Medium | `TradingPanel.tsx` | Open |
| DEF-007 | Extension UI | UI lacks `[HOLD TO ARM LIVE]` control and armed state expiry | Critical | `TradingPanel.tsx` | Open |
| DEF-008 | Extension UI | Preset buttons show text names instead of calculated numeric prices (e.g. `[34¢]`) | High | `TradingPanel.tsx` | Open |
| DEF-009 | Extension UI | BUY sizing uses percentage of balance instead of fixed USD spend ($10, $25, $50, $100, Custom) | High | `TradingPanel.tsx` | Open |
| DEF-010 | Extension UI | SELL sizing reuses BUY dollar fields instead of outcome position shares percentage | High | `TradingPanel.tsx` | Open |
| DEF-011 | Server Routes | Server lacks `LiveReadiness` endpoint and blocking reasons calculation | Critical | `routes/index.ts` | Open |
| DEF-012 | Order Idempotency | `routes/index.ts` checks idempotency non-atomically after receiving request rather than reserving before remote submission | High | `routes/index.ts` | Open |
| DEF-013 | Diagnostic Tools | `public:diagnose` and `live:diagnose` lack comprehensive verification checks | High | `scripts/` | Open |

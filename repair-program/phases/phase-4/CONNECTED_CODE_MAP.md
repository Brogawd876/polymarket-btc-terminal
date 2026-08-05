# Connected Code Map (Phase 4)

## Core Files
- `apps/server/src/integrations/polymarket/adapters/OfficialSdkTradingAdapter.ts`
- `apps/server/src/integrations/polymarket/adapters/PaperTradingAdapter.test.ts`
- `apps/server/src/integrations/polymarket/index.ts`

## Related Files
- `apps/server/src/integrations/polymarket/adapters/TradingAdapter.ts`: Base class for `OfficialSdkTradingAdapter`.
- `apps/server/src/db/index.ts`: Targeted by the incorrect relative import in `OfficialSdkTradingAdapter.ts`.

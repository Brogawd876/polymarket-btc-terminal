# Test Plan: Phase 5

## Unit Tests
1. **Preset Engine Tests**:
   - Given BEST_BID=0.40, a -2¢ CENT_OFFSET Buy preset computes to 0.38.
   - Given BEST_ASK=0.50, a -15% PERCENT_OFFSET Buy preset computes to 0.425 -> 0.43 (rounded).
   - CLAMP mode: Given BEST_ASK=0.40, an ABSOLUTE_PRICE Buy of 0.45 clamps to 0.39.
   - DISABLE mode: Given BEST_ASK=0.40, an ABSOLUTE_PRICE Buy of 0.45 becomes undefined (button disabled).

2. **Size Conversion Tests**:
   - $100 size at $0.50 limit price should calculate exactly 200 shares.
   - 50% Sell of a 200 share position should calculate exactly 100 shares.

## Integration Tests
1. **Frontend to Backend**:
   - Clicking a `34¢` button triggers a WS payload with `price: "0.34"`.
   - Modifying a preset updates the DB and immediately changes the button display upon reload.

# ADR 0001: Use String/Fixed-Point for Financial Arithmetic
**Status:** Accepted
**Context:** Floating point precision issues (e.g. 0.1 + 0.2 = 0.30000000000000004) cause fatal errors in order matching and signature generation.
**Decision:** All prices and sizes will be passed across network boundaries and stored as strings. We will use `z.string()` in Zod with decimal validation, and libraries like `decimal.js` or `ethers` for math inside the backend.
**Consequences:** Safer financial logic, slight overhead in parsing strings to Decimal on each calculation.

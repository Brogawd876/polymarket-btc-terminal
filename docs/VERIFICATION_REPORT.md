# Verification Status

## Current disposition

**NOT RELEASED FOR UNRESTRICTED LIVE TRADING.**

This file is the authoritative verification record. It replaces earlier production-ready claims. Those claims were based largely on compilation, shallow unit/integration coverage, and extension mounting; they did not prove exchange lifecycle correctness, market identity, reconciliation, cancellation certainty, reservations, or security boundaries.

This status must remain conservative until reproducible evidence exists for every release gate below. Documentation wording is not acceptance evidence.

## Evidence policy

Every verification entry must include:

- Git commit SHA and dirty-worktree status.
- Date, operator, platform, Node/pnpm versions, and relevant non-secret configuration.
- Exact command or test procedure and retained output/artifact location.
- Expected result, actual result, and pass/fail determination.
- Known limitations, skipped checks, and any manual judgment.
- For browser checks: extension build identifier, Chrome version, viewport, screenshots, and console/backend logs.
- For live checks: explicit authorization and spend cap, request/remote order IDs, database reconciliation, cancellation/fill result, and proof no unintended order remains open.

CI status proves only that the committed deterministic commands passed in an isolated credential-free runner. It does not prove startup behavior on Windows, Chrome extension behavior, exchange connectivity, or production readiness.

## Confirmed audit findings requiring closure

- Local authentication can expose sensitive account/command paths to permitted browser origins.
- Order commands are not fully bound to the authoritative condition/token/outcome tuple.
- Ambiguous remote submissions may be represented as retryable failures.
- Cancellation and startup reconciliation can report cancellation without remote proof.
- User-stream protocol parsing, authentication health, heartbeat, and reconnect reconciliation are incomplete.
- Readiness can be based on Gamma freshness rather than coherent CLOB book quality.
- Page anchor updates can conflict with backend market state; anchors are not authoritatively persisted/validated.
- Transient missing/crossed books can replace valid prices and cause UI flicker or missing-price states.
- Displayed maker prices are not durable executable quotes and may be silently changed before submission.
- Open BUY collateral and SELL shares are not transactionally reserved.
- Fill/order/position accounting is not fully transactional or chronologically deterministic.
- Historical database inspection found incomplete outcomes, unknown fees represented as zero, and aggregate discrepancies.
- Startup/build output paths and process ownership are inconsistent.
- Existing automated browser tests do not exercise the actual trading workflow.

## Deterministic CI scope

The GitHub workflow must run with no Polymarket credentials and live trading explicitly disabled. It invokes existing root commands for:

- dependency installation from the lockfile;
- lint;
- typecheck;
- unit tests;
- integration tests;
- server build;
- Chrome extension build; and
- extension packaging.

`live:diagnose` and `live:smoke` are forbidden in CI. Browser E2E remains outside the default CI gate until it runs against a controlled fake backend/feed without external order capability.

## Release gates

| Gate | Required evidence | Current status |
| --- | --- | --- |
| Credential containment | Secret scan, rotated exposed credentials, no browser profile in repo | OPEN |
| Local security boundary | Unauthorized and wrong-origin tests cannot read state or command trading | OPEN |
| Market identity | Wrong condition/token/outcome/revision rejected before signing | OPEN |
| Quote integrity | Exact displayed maker price submits or expires; no silent repricing | OPEN |
| Stable books | Missing/crossed/stale updates retain last-good display and block execution | OPEN |
| Anchor integrity | Window-valid persisted anchor; page lag cannot mutate execution market | OPEN |
| Rollover | Forced disarm and atomic CURRENT switch after anchor/book qualification | OPEN |
| Submission ambiguity | Crash/timeout resolves one remote order with no duplicate retry | OPEN |
| User stream | Authenticated health, heartbeat, fixtures, reconnect reconciliation | OPEN |
| Cancellation | `CANCEL_PENDING`, partial bulk results, remote confirmation | OPEN |
| Reservations | Concurrent BUY/SELL cannot exceed available collateral/shares | OPEN |
| Accounting | Deduplicated confirmed fills and deterministic restart/P&L | OPEN |
| Migration safety | Backup plus migration of current databases preserves and reports all rows | OPEN |
| Windows operations | Owned PID, graceful start/stop/status, canonical DB/build paths | OPEN |
| Extension workflow | Real extension QA across required viewports, keyboard paths, reconnect, rollover | OPEN |
| Controlled live smoke | Approved cap, actual app path, reconciled result, no residual order | OPEN |

## Current verification record

No new command results are asserted by this documentation change. The CI workflow and commands must be executed at the resulting commit before their statuses can be recorded. Previous numerical pass counts and "fully operational" conclusions are archived as unverified historical statements in the superseded reports.

## Updating this report

Change a gate from `OPEN` only when its evidence is linked or stored with the repository's verification artifacts. Use `PASS`, `FAIL`, or `BLOCKED`; never infer `PASS` from the absence of a reported failure. Any code or dependency change affecting a passed gate invalidates that gate until the relevant checks run again.

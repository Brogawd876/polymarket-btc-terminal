# Requirements Traceability

| Req ID | Description | Component | Status | Notes |
|--------|-------------|-----------|--------|-------|
| REQ-001 | Fix missing workspace scripts (`lint`, `typecheck`) | Workspace | UNVERIFIED | Identified during baseline |
| REQ-002 | Fix missing server scripts (`live:diagnose`, `public:diagnose`, `live:smoke`, `db:migrate`, `db:reset:test`) | Server | UNVERIFIED | Identified during baseline |
| REQ-003 | Fix E2E tests (`extension-panel.test.ts`) | Extension / Tests | UNVERIFIED | Fails on Shadow DOM locator attachment |
| REQ-004 | Fix backend startup (`../../db/index.js` module error) | Server | UNVERIFIED | Fails due to incorrect path or resolution in `ts-node-dev` |

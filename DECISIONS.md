# Project Decisions Log

- **Architecture Boundary Split**: We have strictly divided the app into a frontend WXT extension (UI/Capture) and a Node.js backend (Execution/State/DB).
- **Shared Contracts**: Implemented in `packages/shared` using Zod for runtime validation to ensure data consistency across IPC and WebSocket boundaries.
- **Traceability**: All requirements map to E2E tests enforcing latency and execution success.

# Polymarket Server

## Running the Server

**NOTE:** Run the server from the `apps/server/` directory, not from `apps/server/dist/`.
The `better-sqlite3` native binding is resolved relative to CWD.

**Correct:**
```bash
cd apps/server
node dist/index.js
```

**Incorrect:**
```bash
node apps/server/dist/index.js
```

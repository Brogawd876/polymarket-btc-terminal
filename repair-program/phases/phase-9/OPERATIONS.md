# Operations Guide

This guide describes how to build and run the Polymarket BTC 5-Minute Execution Terminal on a Windows environment.

## Requirements
- Windows 10/11
- Node.js >= 20.0.0
- pnpm

## 1. Building the Extension
To generate a production `.zip` of the Chrome extension without exposing source maps:
```powershell
pnpm package:extension
```
This will create a clean `.zip` file in `apps/extension/.output/` (or similar configured directory by WXT). You can then load this zip into Chrome/Firefox or publish it.

## 2. Building the Backend Server
To create a standalone production bundle of the Fastify server:
```powershell
pnpm --filter server bundle
# Note: You must run the custom copy script to ensure `better_sqlite3.node` is inside the dist folder.
# The updated implementation automatically copies this file when bundling.
```

## 3. Running the Backend Server
Once the bundle is built, start the server using the generated output:
```powershell
node apps/server/dist/bundle.js
```
*Ensure that your `.env` file is present in the `apps/server` directory before starting the backend.*

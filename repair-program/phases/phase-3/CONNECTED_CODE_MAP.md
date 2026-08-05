# Connected Code Map

- `apps/server/src/integrations/polymarket/rtds.ts`: The primary file handling connection and subscription to the RTDS stream. Needs to be rewritten to target the Chainlink topic instead of the CLOB.
- `apps/server/src/routes/index.ts`: Handles incoming `PLACE_ORDER` and `CANCEL_ORDER` websocket messages. Needs to integrate the stale reference lock check from `rtds.ts` to block trading when data is stale.
- `packages/shared/src/index.ts`: Defines the `RTDS_UPDATE` message schema in `WsEventSchema`. Might need payload modifications.
- `apps/extension/src/hooks/useWebSocket.ts`: Parses the `RTDS_UPDATE` event and sets `rtdsPrice`.
- `apps/extension/src/components/App.tsx`: Renders the `BTC:` header using `rtdsPrice`.
- `apps/extension/src/components/TradingPanel.tsx`: May need to indicate staleness state, or App.tsx may disable actions.

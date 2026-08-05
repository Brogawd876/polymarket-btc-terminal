# Polymarket Integration Contracts & Current SDK Reference

## SDK Specifications
- SDK Package: `@polymarket/clob-client-v2` (v1.1.0)
- Client Imports: `ClobClient`, `OrderType`, `Side as ClobSide`, `AssetType`, `SignatureTypeV2`
- Chain ID: `137` (Polygon Mainnet)
- Network Endpoints:
  - CLOB Host: `https://clob.polymarket.com`
  - User WS: `wss://ws-subscriptions-clob.polymarket.com/ws/user`
  - Market WS: `wss://ws-subscriptions-clob.polymarket.com/ws/market`
  - Chainlink RTDS WS: `wss://ws-live-data.polymarket.com` (Topic: `crypto_prices_chainlink`, Symbol: `btc/usd`)
  - Gamma API Host: `https://gamma-api.polymarket.com`

## Key Contract & SDK Operational Rules
1. **API Key Derivation & Creds**:
   - `clobClient.createOrDeriveApiKey()` derives/creates L2 API credentials (`key`, `secret`, `passphrase`).
   - L2 WS Auth payload requires HMAC-SHA256 signature of `${timestamp}GET/ws/user` using base64 decoded secret.
2. **Order Construction**:
   - Limit orders use `createOrder` + `postOrder(signedOrder, OrderType.GTC, postOnly)`.
   - Post-Only enforcement: `postOnly = true` on `createAndPostOrder` / `postOrder`.
   - Tick Size: Fetched dynamically via `clobClient.getTickSize(tokenId)`.
   - Minimum Size: Enforced per market minimum order size (fetched from market details or `getClobMarketInfo`).
   - Fee Rate: Fetched via `getFeeRateBps(tokenId)`.
3. **Outcome Label Mapping**:
   - Tokens must be matched by explicit outcome labels ("UP" / "DOWN" or "Above" / "Below" mapped to UP/DOWN), never by array index `tokens[0]`.
4. **Price-to-Beat Reference Anchor**:
   - Chainlink BTC/USD RTDS feed delivers live price.
   - Market Opening Reference Anchor (`MarketAnchor`) is fixed at market window start for condition ID and validated against RTDS / Gamma event start time.
5. **Account & Collateral**:
   - Collateral Token: Polygon USDC.e (`0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`, 6 decimals).
   - Balance checked via `clobClient.getBalanceAllowance({ asset_type: AssetType.COLLATERAL })` or direct ERC20 `balanceOf(funderAddress || signerAddress)`.

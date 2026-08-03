import { WebSocket } from 'ws';

export const mockMarketData = {
  id: 'market-btc-5m-12345',
  conditionId: '0x1234567890abcdef',
  question: 'Will BTC be above $65,000 at 12:05 PM?',
  outcomes: ['Yes', 'No'],
  outcomePrices: ['0.45', '0.55'],
  resolutionDate: new Date(Date.now() + 5 * 60000).toISOString(),
};

export class MockWebSocketServer {
  public clients: WebSocket[] = [];
  
  // Expose a method to simulate incoming price updates
  broadcastPriceUpdate(marketId: string, prices: string[]) {
    const payload = JSON.stringify({
      type: 'price_update',
      market: marketId,
      prices
    });
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    });
  }
}

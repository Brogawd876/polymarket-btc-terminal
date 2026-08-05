import { MarketState } from '@polymarket-btc/shared';

export class DiscoveryService {
  private pollInterval: NodeJS.Timeout | null = null;
  private onMarketsDiscovered: (markets: MarketState[]) => void;
  private marketFamily: string;
  
  constructor(onMarketsDiscovered: (markets: MarketState[]) => void) {
    this.onMarketsDiscovered = onMarketsDiscovered;
    this.marketFamily = process.env.MARKET_FAMILY || 'btc-updown-5m';
  }

  start() {
    this.poll();
    this.pollInterval = setInterval(() => this.poll(), 15000);
  }

  stop() {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }

  private async poll() {
    try {
      const res = await fetch(`https://gamma-api.polymarket.com/events?limit=100&active=true`);
      const events: any[] = await res.json();
      
      const familyEvents = events.filter(e => 
        (e.slug && e.slug.includes(this.marketFamily)) || 
        (e.ticker && e.ticker.includes(this.marketFamily)) ||
        (e.seriesSlug && e.seriesSlug.includes(this.marketFamily))
      );
      
      const markets: MarketState[] = [];
      const now = Date.now();
      
      for (const event of familyEvents) {
        if (!event.markets || event.markets.length === 0) continue;
        const market = event.markets[0];
        
        const endDate = new Date(market.endDate).getTime();
        const startDate = new Date(market.startDate || event.startDate).getTime();
        
        let type: 'PREVIOUS' | 'CURRENT' | 'NEXT' = 'PREVIOUS';
        if (now < startDate) {
           type = 'NEXT';
        } else if (now >= startDate && now < endDate) {
           type = 'CURRENT';
        } else {
           type = 'PREVIOUS';
        }
        
        if (market.status === 'RESOLVED') continue;

        const tokens = market.clobTokenIds ? JSON.parse(market.clobTokenIds) : market.tokens;
        const yesTokenId = Array.isArray(tokens) ? tokens[0]?.token_id || tokens[0] : null;
        const noTokenId = Array.isArray(tokens) ? tokens[1]?.token_id || tokens[1] : null;

        if (!yesTokenId || !noTokenId) continue;

        markets.push({
          marketId: market.conditionId,
          conditionId: market.conditionId,
          yesTokenId,
          noTokenId,
          yesPrice: '0',
          noPrice: '0',
          status: market.closed ? 'RESOLVING' : 'OPEN',
          lastUpdated: Date.now(),
          targetTime: endDate,
          type,
          title: event.title
        });
      }
      
      this.onMarketsDiscovered(markets);
    } catch(err) {
      console.error('Discovery poll error:', err);
    }
  }
}

import { MarketState } from '@polymarket-btc/shared';

type GammaEvent = {
  title?: string;
  startTime?: string;
  startDate?: string;
  endDate?: string;
  markets?: GammaMarket[];
};

type GammaMarket = {
  conditionId?: string;
  clobTokenIds?: string;
  tokens?: Array<string | { token_id?: string; tokenId?: string; id?: string }>;
  outcomePrices?: string;
  bestBid?: string | number;
  bestAsk?: string | number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  acceptingOrders?: boolean;
  endDate?: string;
  startDate?: string;
  eventStartTime?: string;
};

export class DiscoveryService {
  private pollInterval: NodeJS.Timeout | null = null;
  private onMarketsDiscovered: (markets: MarketState[]) => void;
  private marketFamily: string;
  private slugPrefix: string;
  private slotMs: number;
  
  private latestMarkets: MarketState[] = [];

  constructor(onMarketsDiscovered: (markets: MarketState[]) => void) {
    this.onMarketsDiscovered = onMarketsDiscovered;
    this.marketFamily = process.env.MARKET_FAMILY || 'btc-up-or-down-5m';
    this.slugPrefix = process.env.MARKET_SLUG_PREFIX || 'btc-updown-5m';
    this.slotMs = Number(process.env.MARKET_SLOT_MS || 5 * 60 * 1000);
  }

  getMarkets() {
    return this.latestMarkets;
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
      const events = await this.fetchCurrentWindowEvents();
      console.log(`Fetched ${events.length} events from Gamma API for ${this.slugPrefix}`);

      const markets: MarketState[] = [];
      const now = Date.now();
      
      for (const event of events) {
        if (!event.markets || event.markets.length === 0) continue;
        const market = event.markets[0];

        if (!market.conditionId || market.archived || market.closed || market.active === false) continue;

        const endDate = this.parseTime(market.endDate || event.endDate);
        const startDate = this.parseTime(market.eventStartTime || market.startDate || event.startTime || event.startDate);
        if (!endDate || !startDate) continue;
        if (endDate < now - this.slotMs) continue;
        
        let type: 'PREVIOUS' | 'CURRENT' | 'NEXT' = 'PREVIOUS';
        if (now < startDate) {
           type = 'NEXT';
        } else if (now >= startDate && now < endDate) {
           type = 'CURRENT';
        } else {
           type = 'PREVIOUS';
        }
        
        const tokens = this.parseTokens(market);
        const yesTokenId = Array.isArray(tokens) ? tokens[0]?.token_id || tokens[0] : null;
        const noTokenId = Array.isArray(tokens) ? tokens[1]?.token_id || tokens[1] : null;

        if (!yesTokenId || !noTokenId) continue;
        const prices = this.parseOutcomePrices(market.outcomePrices);
        const yesBid = this.stringifyDecimal(market.bestBid);
        const yesAsk = this.stringifyDecimal(market.bestAsk);
        const yesPrice = prices[0] || yesBid || yesAsk || '0';
        const noPrice = prices[1] || '0';

        markets.push({
          marketId: market.conditionId,
          conditionId: market.conditionId,
          yesTokenId,
          noTokenId,
          yesPrice,
          noPrice,
          yesBid: yesBid || undefined,
          yesAsk: yesAsk || undefined,
          status: market.closed ? 'RESOLVING' : 'OPEN',
          lastUpdated: Date.now(),
          targetTime: endDate,
          type,
          title: event.title
        });
      }

      markets.sort((a, b) => (a.targetTime || 0) - (b.targetTime || 0));
      this.latestMarkets = markets;
      console.log(`Discovery poll complete. Found ${markets.length} valid markets.`);
      this.onMarketsDiscovered(markets);
    } catch(err) {
      console.error('Discovery poll error:', err);
    }
  }

  private async fetchCurrentWindowEvents(): Promise<GammaEvent[]> {
    const now = Date.now();
    const currentSlotStart = Math.floor(now / this.slotMs) * (this.slotMs / 1000);
    const offsets = Array.from({ length: 18 }, (_, index) => index - 3);
    const slugs = offsets.map(offset => `${this.slugPrefix}-${currentSlotStart + offset * (this.slotMs / 1000)}`);
    const events = await Promise.all(slugs.map(slug => this.fetchEventBySlug(slug)));
    const found = events.flat();

    if (found.length > 0) return found;

    const res = await fetch(`https://gamma-api.polymarket.com/events?series_slug=${this.marketFamily}`);
    const fallback = await res.json();
    return Array.isArray(fallback) ? fallback : [fallback];
  }

  private async fetchEventBySlug(slug: string): Promise<GammaEvent[]> {
    try {
      const res = await fetch(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) return [];

      const payload = await res.json();
      if (Array.isArray(payload)) return payload;
      if (payload && typeof payload === 'object') return [payload];
    } catch (err) {
      console.warn(`Failed to fetch Gamma event ${slug}:`, err);
    }

    return [];
  }

  private parseTime(value?: string): number | null {
    if (!value) return null;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseTokens(market: GammaMarket) {
    if (market.clobTokenIds) {
      try {
        return JSON.parse(market.clobTokenIds);
      } catch {
        return [];
      }
    }

    return market.tokens || [];
  }

  private parseOutcomePrices(value?: string): string[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  private stringifyDecimal(value?: string | number): string | null {
    if (value === undefined || value === null || value === '') return null;
    const normalized = String(value);
    return /^\d+(\.\d+)?$/.test(normalized) ? normalized : null;
  }
}

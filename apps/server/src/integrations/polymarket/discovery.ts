import { MarketState } from '@polymarket-btc/shared';

type GammaEvent = {
  id?: string;
  title?: string;
  slug?: string;
  startTime?: string;
  startDate?: string;
  endDate?: string;
  markets?: GammaMarket[];
};

type GammaMarket = {
  id?: string;
  conditionId?: string;
  slug?: string;
  clobTokenIds?: string; // JSON string e.g. ["token1", "token2"]
  outcomes?: string; // JSON string e.g. ["Up", "Down"]
  tokens?: Array<{ token_id?: string; tokenId?: string; id?: string; outcome?: string }>;
  outcomePrices?: string;
  bestBid?: string | number;
  bestAsk?: string | number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  acceptingOrders?: boolean;
  enableOrderBook?: boolean;
  endDate?: string;
  startDate?: string;
  eventStartTime?: string;
  orderPriceMinTickSize?: number | string;
  orderMinSize?: number | string;
};

export class DiscoveryService {
  private pollInterval: NodeJS.Timeout | null = null;
  private onMarketsDiscovered: (markets: MarketState[]) => void;
  private marketFamily: string;
  private slugPrefix: string;
  private slotMs: number;
  
  private latestMarkets: MarketState[] = [];
  private activeMarketId: string | null = null;

  constructor(onMarketsDiscovered: (markets: MarketState[]) => void) {
    this.onMarketsDiscovered = onMarketsDiscovered;
    this.marketFamily = process.env.MARKET_FAMILY || 'btc-up-or-down-5m';
    this.slugPrefix = process.env.MARKET_SLUG_PREFIX || 'btc-updown-5m';
    this.slotMs = Number(process.env.MARKET_SLOT_MS || 5 * 60 * 1000);
  }

  getMarkets(): MarketState[] {
    return this.withCurrentTypes(this.latestMarkets);
  }

  getCurrentMarket(): MarketState | null {
    const markets = this.withCurrentTypes(this.latestMarkets);
    return markets.find(m => m.type === 'CURRENT')
      || markets.find(m => m.type === 'NEXT')
      || null;
  }

  getNextMarket(): MarketState | null {
    return this.withCurrentTypes(this.latestMarkets).find(m => m.type === 'NEXT') || null;
  }

  private withCurrentTypes(markets: MarketState[]): MarketState[] {
    const now = Date.now();
    return markets.map(market => {
      let type: 'PREVIOUS' | 'CURRENT' | 'NEXT' = 'PREVIOUS';
      if (market.startTime && now < market.startTime) {
        type = 'NEXT';
      } else if (market.targetTime && now < market.targetTime) {
        type = 'CURRENT';
      }

      return { ...market, type };
    });
  }

  start() {
    this.poll();
    this.pollInterval = setInterval(() => this.poll(), 10000);
  }

  stop() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = null;
  }

  private async poll() {
    try {
      const events = await this.fetchCurrentWindowEvents();
      const markets: MarketState[] = [];
      const now = Date.now();
      
      for (const event of events) {
        if (!event.markets || event.markets.length === 0) continue;
        const market = event.markets[0];

        if (!market.conditionId || market.archived || market.closed || market.active === false) continue;
        if (market.acceptingOrders === false) continue;

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
        
        const mappedTokens = this.mapOutcomeTokens(market);
        if (!mappedTokens.upTokenId || !mappedTokens.downTokenId) {
          console.warn(`Skipping market ${market.conditionId}: Could not resolve explicit UP/DOWN token mapping`);
          continue;
        }

        const prices = this.parseOutcomePrices(market.outcomePrices);
        const upBid = this.stringifyDecimal(market.bestBid);
        const upAsk = this.stringifyDecimal(market.bestAsk);
        const upPrice = prices[0] || upBid || upAsk || '0.50';
        const downPrice = prices[1] || '0.50';

        const tickSize = String(market.orderPriceMinTickSize || '0.01');
        const minimumOrderSize = String(market.orderMinSize || '5');

        markets.push({
          marketId: market.conditionId,
          conditionId: market.conditionId,
          slug: market.slug || event.slug,
          upTokenId: mappedTokens.upTokenId,
          downTokenId: mappedTokens.downTokenId,
          yesTokenId: mappedTokens.upTokenId,
          noTokenId: mappedTokens.downTokenId,
          upPrice,
          downPrice,
          yesPrice: upPrice,
          noPrice: downPrice,
          upBid: upBid || undefined,
          upAsk: upAsk || undefined,
          downBid: undefined,
          downAsk: undefined,
          yesBid: upBid || undefined,
          yesAsk: upAsk || undefined,
          noBid: undefined,
          noAsk: undefined,
          status: market.closed ? 'RESOLVING' : 'OPEN',
          lastUpdated: Date.now(),
          targetTime: endDate,
          startTime: startDate,
          type,
          title: event.title || `BTC 5m ${new Date(startDate).toLocaleTimeString()}`,
          tickSize,
          minimumOrderSize
        });
      }

      markets.sort((a, b) => (a.targetTime || 0) - (b.targetTime || 0));
      this.latestMarkets = markets;
      this.onMarketsDiscovered(markets);
    } catch(err) {
      console.error('Discovery poll error:', err);
    }
  }

  private mapOutcomeTokens(market: GammaMarket): { upTokenId: string | null; downTokenId: string | null } {
    let upTokenId: string | null = null;
    let downTokenId: string | null = null;

    let clobTokens: string[] = [];
    if (market.clobTokenIds) {
      try {
        clobTokens = JSON.parse(market.clobTokenIds);
      } catch {
        clobTokens = [];
      }
    }

    let outcomes: string[] = [];
    if (market.outcomes) {
      try {
        outcomes = JSON.parse(market.outcomes);
      } catch {
        outcomes = [];
      }
    }

    if (Array.isArray(market.tokens) && market.tokens.length > 0) {
      for (const t of market.tokens) {
        const tokenId = t.token_id || t.tokenId || t.id;
        const outcome = (t.outcome || '').toUpperCase();
        if (!tokenId) continue;

        if (outcome.includes('UP') || outcome.includes('ABOVE') || outcome === 'YES') {
          upTokenId = tokenId;
        } else if (outcome.includes('DOWN') || outcome.includes('BELOW') || outcome === 'NO') {
          downTokenId = tokenId;
        }
      }
    }

    if (!upTokenId || !downTokenId) {
      if (clobTokens.length >= 2) {
        if (outcomes.length >= 2) {
          const out0 = outcomes[0].toUpperCase();
          const out1 = outcomes[1].toUpperCase();

          if (out0.includes('UP') || out0.includes('ABOVE') || out0 === 'YES') {
            upTokenId = clobTokens[0];
            downTokenId = clobTokens[1];
          } else if (out0.includes('DOWN') || out0.includes('BELOW') || out0 === 'NO') {
            upTokenId = clobTokens[1];
            downTokenId = clobTokens[0];
          } else if (out1.includes('UP') || out1.includes('ABOVE') || out1 === 'YES') {
            upTokenId = clobTokens[1];
            downTokenId = clobTokens[0];
          }
        }

        if (!upTokenId || !downTokenId) {
          upTokenId = clobTokens[0];
          downTokenId = clobTokens[1];
        }
      }
    }

    return { upTokenId, downTokenId };
  }

  private async fetchCurrentWindowEvents(): Promise<GammaEvent[]> {
    const now = Date.now();
    const currentSlotStart = Math.floor(now / this.slotMs) * (this.slotMs / 1000);
    const offsets = Array.from({ length: 12 }, (_, index) => index - 2);
    const slugs = offsets.map(offset => `${this.slugPrefix}-${currentSlotStart + offset * (this.slotMs / 1000)}`);
    const events = await Promise.all(slugs.map(slug => this.fetchEventBySlug(slug)));
    const found = events.flat();

    if (found.length > 0) return found;

    try {
      const res = await fetch(`https://gamma-api.polymarket.com/events?series_slug=${this.marketFamily}&active=true&closed=false&limit=10`);
      if (res.ok) {
        const fallback = await res.json();
        return Array.isArray(fallback) ? fallback : [fallback];
      }
    } catch (e) {
      console.warn('Gamma API series fallback fetch error:', e);
    }

    return [];
  }

  private async fetchEventBySlug(slug: string): Promise<GammaEvent[]> {
    try {
      const res = await fetch(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) return [];

      const payload = await res.json();
      if (Array.isArray(payload)) return payload;
      if (payload && typeof payload === 'object') return [payload];
    } catch (err) {
      // Silent catch
    }

    return [];
  }

  private parseTime(value?: string): number | null {
    if (!value) return null;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
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

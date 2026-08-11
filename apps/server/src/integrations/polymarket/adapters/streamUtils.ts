import type { BookQuality, BookState, Outcome } from '@polymarket-btc/shared';

export interface PriceLevel {
  price: string;
  size: string;
}

export interface LocalOrderBook {
  bids: PriceLevel[];
  asks: PriceLevel[];
  sourceTimestamp: number;
  receiveTimestamp: number;
  version: number;
  tickSize?: string;
  lastTradePrice?: string;
}

export function normalizeSourceTimestamp(value: unknown): number | undefined {
  if (typeof value === 'string' && value.trim() && !/^\d+(\.\d+)?$/.test(value.trim())) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  let numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
  if (numeric < 10_000_000_000) return Math.round(numeric * 1000);
  while (numeric > 10_000_000_000_000) numeric /= 1000;
  return Math.round(numeric);
}

export function messageSourceTimestamp(message: any): number | undefined {
  return normalizeSourceTimestamp(
    message?.timestamp
      ?? message?.source_timestamp
      ?? message?.last_update
      ?? message?.payload?.timestamp,
  );
}

export function emptyOrderBook(): LocalOrderBook {
  return {
    bids: [],
    asks: [],
    sourceTimestamp: 0,
    receiveTimestamp: 0,
    version: 0,
  };
}

export function applyBookSnapshot(
  previous: LocalOrderBook | undefined,
  snapshot: any,
  receiveTimestamp = Date.now(),
): LocalOrderBook {
  const sourceTimestamp = messageSourceTimestamp(snapshot) || previous?.sourceTimestamp || 0;
  if (previous && sourceTimestamp < previous.sourceTimestamp) return previous;

  return {
    bids: normalizeLevels(snapshot?.bids, 'bid'),
    asks: normalizeLevels(snapshot?.asks, 'ask'),
    sourceTimestamp,
    receiveTimestamp,
    version: (previous?.version || 0) + 1,
    tickSize: normalizePositiveString(snapshot?.tick_size ?? snapshot?.tickSize) || previous?.tickSize,
    lastTradePrice: normalizePositiveString(snapshot?.last_trade_price) || previous?.lastTradePrice,
  };
}

export function applyBookDelta(
  previous: LocalOrderBook | undefined,
  change: any,
  parentSourceTimestamp?: number,
  receiveTimestamp = Date.now(),
): LocalOrderBook {
  const current = previous || emptyOrderBook();
  const sourceTimestamp = messageSourceTimestamp(change) || parentSourceTimestamp;
  if (!sourceTimestamp) return current;
  if (sourceTimestamp < current.sourceTimestamp) return current;

  let bids = current.bids;
  let asks = current.asks;

  if (Array.isArray(change?.bids)) bids = normalizeLevels(change.bids, 'bid');
  if (Array.isArray(change?.asks)) asks = normalizeLevels(change.asks, 'ask');

  const side = String(change?.side || '').toUpperCase();
  const price = normalizePositiveString(change?.price);
  const size = normalizeNonNegativeString(change?.size);
  if (price && size !== undefined && (side === 'BUY' || side === 'BID')) {
    bids = mutateLevel(bids, price, size, 'bid');
  } else if (price && size !== undefined && (side === 'SELL' || side === 'ASK')) {
    asks = mutateLevel(asks, price, size, 'ask');
  }

  return {
    ...current,
    bids,
    asks,
    sourceTimestamp,
    receiveTimestamp,
    version: current.version + 1,
    tickSize: normalizePositiveString(change?.new_tick_size ?? change?.tick_size) || current.tickSize,
    lastTradePrice: normalizePositiveString(change?.last_trade_price) || current.lastTradePrice,
  };
}

export function mutateLevel(
  levels: PriceLevel[],
  price: string,
  size: string,
  side: 'bid' | 'ask',
): PriceLevel[] {
  const priceNumber = Number(price);
  const sizeNumber = Number(size);
  if (!Number.isFinite(priceNumber) || priceNumber <= 0 || !Number.isFinite(sizeNumber) || sizeNumber < 0) {
    return levels;
  }

  const next = levels.filter((level) => Number(level.price) !== priceNumber);
  if (sizeNumber > 0) next.push({ price: String(price), size: String(size) });
  return sortLevels(next, side);
}

export function bestPrice(levels: PriceLevel[], side: 'bid' | 'ask'): string {
  if (!levels.length) return '0';
  const sorted = sortLevels(levels, side);
  return sorted[0]?.price || '0';
}

export function bookStaleReason(
  book: LocalOrderBook | undefined,
  now = Date.now(),
  staleAfterMs = 10_000,
): string | undefined {
  if (!book || book.sourceTimestamp <= 0) return 'BOOK_NOT_INITIALIZED';
  if (now - book.sourceTimestamp > staleAfterMs) return 'BOOK_SOURCE_STALE';
  if (!book.bids.length || !book.asks.length) return 'BOOK_INCOMPLETE';
  const bid = Number(bestPrice(book.bids, 'bid'));
  const ask = Number(bestPrice(book.asks, 'ask'));
  if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return 'BOOK_INCOMPLETE';
  if (bid > ask) return 'BOOK_CROSSED';
  return undefined;
}

export function toPublicBookState(
  book: LocalOrderBook | undefined,
  tokenId: string,
  outcome: Outcome,
  tickSize: string,
  minimumOrderSize: string,
  staleReason?: string,
): BookState | undefined {
  if (!book) return undefined;

  const bid = bestPrice(book.bids, 'bid');
  const ask = bestPrice(book.asks, 'ask');
  const spreadValue = Number(ask) - Number(bid);
  const spread = Number.isFinite(spreadValue) && spreadValue >= 0
    ? spreadValue.toFixed(8).replace(/\.?0+$/, '') || '0'
    : undefined;
  const qualityByReason: Record<string, BookQuality> = {
    BOOK_NOT_INITIALIZED: 'INITIALIZING',
    BOOK_SOURCE_STALE: 'STALE',
    BOOK_INCOMPLETE: 'INCOMPLETE',
    BOOK_CROSSED: 'CROSSED',
  };
  const quality = staleReason ? qualityByReason[staleReason] || 'INVALID' : 'FRESH';

  return {
    tokenId,
    outcome,
    bid,
    ask,
    spread,
    lastTrade: book.lastTradePrice,
    tickSize: book.tickSize || tickSize,
    minimumOrderSize,
    exchangeTimestamp: book.sourceTimestamp || undefined,
    receiveTimestamp: book.receiveTimestamp,
    lastGoodTimestamp: quality === 'FRESH' || quality === 'STALE' ? book.sourceTimestamp || undefined : undefined,
    version: book.version,
    quality,
    staleReason,
  };
}

export function privateEventKey(item: any): string | undefined {
  const eventType = String(item?.event_type ?? item?.event ?? item?.type ?? '').toLowerCase();
  const id = item?.id ?? item?.trade_id ?? item?.order_id ?? item?.taker_order_id;
  if (!eventType || !id) return undefined;
  return [eventType, id, item?.status ?? '', item?.last_update ?? item?.timestamp ?? ''].join(':');
}

function normalizeLevels(levels: unknown, side: 'bid' | 'ask'): PriceLevel[] {
  if (!Array.isArray(levels)) return [];
  const byPrice = new Map<number, PriceLevel>();
  for (const level of levels) {
    const price = normalizePositiveString((level as any)?.price);
    const size = normalizeNonNegativeString((level as any)?.size);
    if (!price || size === undefined || Number(size) <= 0) continue;
    byPrice.set(Number(price), { price, size });
  }
  return sortLevels([...byPrice.values()], side);
}

function sortLevels(levels: PriceLevel[], side: 'bid' | 'ask'): PriceLevel[] {
  return [...levels].sort((a, b) => side === 'bid' ? Number(b.price) - Number(a.price) : Number(a.price) - Number(b.price));
}

function normalizePositiveString(value: unknown): string | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? String(value) : undefined;
}

function normalizeNonNegativeString(value: unknown): string | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? String(value) : undefined;
}

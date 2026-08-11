import type {
  AccountState,
  LiveReadiness,
  MarketAnchor,
  MarketState,
  OperationalState,
  Order,
  Position,
  PresetConfig,
  ExecutableQuote,
} from '@polymarket-btc/shared';
import type { ParsedServerEvent } from './protocol';

export interface TerminalState {
  connected: boolean;
  revision: number;
  operationalState: OperationalState;
  readiness: LiveReadiness | null;
  account: AccountState | null;
  marketInfo: MarketState | null;
  discoveredMarkets: MarketState[];
  anchor: MarketAnchor | null;
  referenceData: Record<string, unknown> | null;
  orders: Order[];
  positions: Position[];
  presets: PresetConfig[];
  quotes: ExecutableQuote[];
  settings: Record<string, unknown>;
  balance: number;
  realizedPnl: number;
  rtdsPrice: number | null;
  rtdsMetrics: Record<string, unknown>;
  lastError: string;
  lastResult: string;
  lastResponseId: string | null;
  lastResponseType: string | null;
}

export const initialTerminalState: TerminalState = {
  connected: false,
  revision: -1,
  operationalState: 'OFFLINE',
  readiness: null,
  account: null,
  marketInfo: null,
  discoveredMarkets: [],
  anchor: null,
  referenceData: null,
  orders: [],
  positions: [],
  presets: [],
  quotes: [],
  settings: {},
  balance: 0,
  realizedPnl: 0,
  rtdsPrice: null,
  rtdsMetrics: { connected: false, stale: true, dataAgeMs: 0 },
  lastError: '',
  lastResult: 'No command result yet',
  lastResponseId: null,
  lastResponseType: null,
};

export type TerminalAction =
  | { type: 'CONNECTION'; connected: boolean }
  | { type: 'PROTOCOL_ERROR'; message: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'SERVER_EVENT'; parsed: ParsedServerEvent };

const MUTATING_EVENTS = new Set([
  'TERMINAL_SNAPSHOT', 'SNAPSHOT', 'READINESS_UPDATED', 'MARKET_UPDATE', 'MARKET_UPDATED',
  'DISCOVERY_UPDATE', 'REFERENCE_UPDATED', 'RTDS_UPDATE', 'RTDS_STATUS', 'ACCOUNT_UPDATED',
  'ORDER_RESULT', 'ORDER_UPDATE', 'ORDER_UPDATED', 'POSITION_UPDATED', 'SETTINGS_UPDATED',
  'EXECUTABLE_QUOTES_UPDATED',
]);

const upsertOrder = (orders: Order[], order: Order): Order[] => {
  const index = orders.findIndex(item => item.id === order.id);
  if (index < 0) return [order, ...orders];
  const next = [...orders];
  next[index] = order;
  return next;
};

const upsertPosition = (positions: Position[], position: Position): Position[] => {
  const index = positions.findIndex(item => item.tokenId === position.tokenId);
  if (index < 0) return [position, ...positions];
  const next = [...positions];
  next[index] = position;
  return next;
};

const applySnapshot = (state: TerminalState, payload: any, revision: number): TerminalState => ({
  ...state,
  connected: true,
  revision,
  operationalState: payload.operationalState,
  readiness: payload.readiness,
  account: payload.account ?? state.account,
  marketInfo: payload.market ?? null,
  discoveredMarkets: payload.markets ?? [],
  anchor: payload.anchor ?? null,
  referenceData: payload.reference ?? state.referenceData,
  rtdsPrice: payload.reference?.currentPrice ?? state.rtdsPrice,
  rtdsMetrics: payload.reference ?? state.rtdsMetrics,
  orders: payload.orders ?? [],
  positions: payload.positions ?? [],
  presets: payload.presets?.length ? payload.presets : state.presets,
  quotes: payload.quotes?.length ? payload.quotes : state.quotes,
  settings: payload.settings && Object.keys(payload.settings).length ? payload.settings : state.settings,
  balance: payload.balance ?? payload.account?.collateralBalance ?? state.balance,
  realizedPnl: payload.realizedPnl ?? state.realizedPnl,
  lastError: '',
});

export function terminalReducer(state: TerminalState, action: TerminalAction): TerminalState {
  if (action.type === 'CLEAR_ERROR') return { ...state, lastError: '' };
  if (action.type === 'PROTOCOL_ERROR') return { ...state, lastError: action.message };
  if (action.type === 'CONNECTION') {
    if (action.connected) return { ...state, connected: true, lastError: '' };
    return {
      ...state,
      connected: false,
      operationalState: 'OFFLINE',
      readiness: null,
      rtdsMetrics: { ...state.rtdsMetrics, connected: false, stale: true },
      lastError: 'Backend connection lost. Reconnecting...',
    };
  }

  const { event, revision } = action.parsed;
  if (MUTATING_EVENTS.has(event.type)) {
    if (revision === null) return { ...state, lastError: `Ignored unrevisioned ${event.type} event.` };
    if (revision <= state.revision) return state;
  }
  const nextRevision = revision ?? state.revision;
  const payload: any = 'payload' in event ? event.payload : undefined;
  const responseMeta = {
    lastResponseId: typeof (event as any).id === 'string' ? (event as any).id : state.lastResponseId,
    lastResponseType: typeof (event as any).id === 'string' ? event.type : state.lastResponseType,
  };

  switch (event.type) {
    case 'TERMINAL_SNAPSHOT':
    case 'SNAPSHOT':
      return applySnapshot(state, payload, nextRevision);
    case 'READINESS_UPDATED':
      return { ...state, revision: nextRevision, readiness: payload, operationalState: payload.liveArmed ? 'LIVE_ARMED' : 'LIVE_DISARMED', lastError: '' };
    case 'MARKET_UPDATE':
    case 'MARKET_UPDATED':
      return {
        ...state,
        revision: nextRevision,
        marketInfo: payload,
        operationalState: payload.operationalState ?? state.operationalState,
        readiness: payload.readiness ?? state.readiness,
        positions: payload.positions ?? state.positions,
        orders: payload.orders ?? state.orders,
        balance: payload.balance ?? state.balance,
        discoveredMarkets: payload.markets ?? state.discoveredMarkets,
        lastError: '',
      };
    case 'DISCOVERY_UPDATE':
      return { ...state, revision: nextRevision, discoveredMarkets: payload };
    case 'REFERENCE_UPDATED':
      return {
        ...state,
        revision: nextRevision,
        referenceData: payload,
        rtdsPrice: payload.currentPrice,
        rtdsMetrics: payload,
      };
    case 'RTDS_UPDATE':
      return { ...state, revision: nextRevision, rtdsPrice: payload.price, rtdsMetrics: { ...state.rtdsMetrics, ...payload } };
    case 'RTDS_STATUS':
      return { ...state, revision: nextRevision, rtdsMetrics: { ...state.rtdsMetrics, connected: payload.connected } };
    case 'ORDER_UPDATE':
    case 'ORDER_UPDATED':
      return { ...state, ...responseMeta, revision: nextRevision, orders: upsertOrder(state.orders, payload), lastError: '', lastResult: `${payload.side} ${payload.outcome ?? ''} ${payload.status}`.trim() };
    case 'POSITION_UPDATED':
      return { ...state, revision: nextRevision, positions: upsertPosition(state.positions, payload) };
    case 'ACCOUNT_UPDATED':
      return { ...state, revision: nextRevision, account: payload, balance: payload.collateralBalance ?? state.balance };
    case 'SETTINGS_UPDATED':
      return { ...state, revision: nextRevision, settings: payload, lastResult: 'Settings saved' };
    case 'EXECUTABLE_QUOTES_UPDATED':
      return { ...state, revision: nextRevision, quotes: payload.quotes, lastError: '' };
    case 'ORDER_RESULT':
      return { ...state, ...responseMeta, revision: nextRevision, lastError: payload.result === 'REJECTED' ? payload.errorMessage ?? 'Order rejected' : '', lastResult: `Order ${payload.result}` };
    case 'ERROR':
      if (payload?.code === 'QUOTE_UNAVAILABLE') {
        return { ...state, ...responseMeta, quotes: [], lastError: payload.message ?? event.error ?? 'Quotes are temporarily unavailable.' };
      }
      return { ...state, ...responseMeta, lastError: payload?.message ?? event.error ?? 'Backend rejected the request.', lastResult: 'Command rejected' };
    case 'PROTOCOL_ERROR':
      return { ...state, ...responseMeta, lastError: payload?.message ?? 'Protocol error' };
    case 'COMMAND_ACCEPTED':
      return { ...state, ...responseMeta, lastError: '', lastResult: payload?.message ?? 'Command accepted' };
    default:
      return state;
  }
}

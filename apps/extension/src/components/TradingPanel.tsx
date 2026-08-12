import React, { useState, useEffect, useRef } from 'react';
import type { 
  MarketState, 
  Side, 
  Order, 
  PresetConfig, 
  LiveReadiness, 
  OperationalState, 
  Position,
  Outcome,
  ExecutableQuote,
} from '@polymarket-btc/shared';
import { AlertTriangle, Play, Square, Zap, Loader2 } from 'lucide-react';
import { RequestGate } from '../requestGate';
import type { ExecutionMode, PageFollowPreference } from '../uiPreferences';

interface Props {
  operationalState: OperationalState;
  readiness: LiveReadiness | null;
  marketInfo: MarketState | null;
  discoveredMarkets?: MarketState[];
  sendMessage: (msg: unknown) => string | null;
  orders?: Order[];
  positions?: Position[];
  presets?: PresetConfig[];
  quotes?: ExecutableQuote[];
  rtdsMetrics?: any;
  balance?: number;
  pageHref?: string;
  pageFollow: PageFollowPreference;
  executionMode: ExecutionMode;
  setExecutionMode: (mode: ExecutionMode) => void;
  backendError?: string;
  lastResult?: string;
  lastResponseId?: string | null;
  lastResponseType?: string | null;
  clearBackendError?: () => void;
  connected?: boolean;
}

const DEFAULT_PRESETS: PresetConfig[] = [
  { id: 'buy-1', name: 'Match Ask', side: 'BUY', mode: 'CENT_OFFSET', reference: 'BEST_ASK', value: 0, active: true, clampMode: 'CLAMP' },
  { id: 'buy-2', name: '1c under ask', side: 'BUY', mode: 'CENT_OFFSET', reference: 'BEST_ASK', value: -0.01, active: true, clampMode: 'CLAMP' },
  { id: 'buy-3', name: '15% under ask', side: 'BUY', mode: 'PERCENT_OFFSET', reference: 'BEST_ASK', value: -15, active: true, clampMode: 'CLAMP' },
  { id: 'buy-4', name: '20% under ask', side: 'BUY', mode: 'PERCENT_OFFSET', reference: 'BEST_ASK', value: -20, active: true, clampMode: 'CLAMP' },
  { id: 'buy-5', name: '50% under ask', side: 'BUY', mode: 'PERCENT_OFFSET', reference: 'BEST_ASK', value: -50, active: true, clampMode: 'CLAMP' },

  { id: 'sell-1', name: 'Match Bid', side: 'SELL', mode: 'CENT_OFFSET', reference: 'BEST_BID', value: 0, active: true, clampMode: 'CLAMP' },
  { id: 'sell-2', name: '1c over bid', side: 'SELL', mode: 'CENT_OFFSET', reference: 'BEST_BID', value: 0.01, active: true, clampMode: 'CLAMP' },
  { id: 'sell-3', name: '15% over bid', side: 'SELL', mode: 'PERCENT_OFFSET', reference: 'BEST_BID', value: 15, active: true, clampMode: 'CLAMP' },
  { id: 'sell-4', name: '20% over bid', side: 'SELL', mode: 'PERCENT_OFFSET', reference: 'BEST_BID', value: 20, active: true, clampMode: 'CLAMP' },
  { id: 'sell-5', name: '50% over bid', side: 'SELL', mode: 'PERCENT_OFFSET', reference: 'BEST_BID', value: 50, active: true, clampMode: 'CLAMP' },
];

const TradingPanel: React.FC<Props> = ({ 
  operationalState,
  readiness,
  marketInfo, 
  discoveredMarkets = [], 
  sendMessage, 
  orders = [], 
  positions = [],
  presets = DEFAULT_PRESETS, 
  quotes = [],
  rtdsMetrics, 
  balance = 0,
  pageHref = '',
  pageFollow,
  executionMode,
  setExecutionMode,
  backendError = '',
  lastResult = 'No command result yet',
  lastResponseId = null,
  lastResponseType = null,
  clearBackendError,
  connected
}) => {
  const [buyUsdSpend, setBuyUsdSpend] = useState<string>('25');
  const [sellShares, setSellShares] = useState<string>('');
  const [activeOutcome, setActiveOutcome] = useState<Outcome>('UP');
  const [slippageBps, setSlippageBps] = useState<number>(100);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string>('');
  const [countdown, setCountdown] = useState<string>('');
  const requestGate = useRef(new RequestGate());
  const activeOrderRequestId = useRef<string | null>(null);
  const activePresets = presets.length > 0 ? presets : DEFAULT_PRESETS;

  const activeTokenId = marketInfo 
    ? (activeOutcome === 'UP' ? (marketInfo.upTokenId || marketInfo.yesTokenId) : (marketInfo.downTokenId || marketInfo.noTokenId))
    : '';

  const activePosition = positions.find(p => p.tokenId === activeTokenId);
  const availableShares = activePosition ? parseFloat(activePosition.netSize || activePosition.netShares || '0') : 0;
  const walletBalance = Number.isFinite(balance) ? Math.max(0, balance) : 0;
  const maxSpendCents = Math.floor(walletBalance * 100) / 100;
  const maxBuySpend = maxSpendCents.toFixed(2);
  const buySpendNum = parseFloat(buyUsdSpend) || 0;
  const hasEnoughBalance = maxSpendCents > 0 && buySpendNum > 0 && buySpendNum <= maxSpendCents;
  const minimumOrderSize = parseFloat(marketInfo?.minimumOrderSize || '0') || 0;

  useEffect(() => {
    if (!marketInfo?.targetTime) return;
    const interval = setInterval(() => {
      const diff = marketInfo.targetTime! - Date.now();
      if (diff > 0) {
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setCountdown(`${m}m ${s}s`);
      } else {
        setCountdown('RESOLVED / SWITCHING');
      }
    }, 100);
    return () => clearInterval(interval);
  }, [marketInfo]);

  useEffect(() => {
    if (!activeOrderRequestId.current || lastResponseId !== activeOrderRequestId.current) return;
    if (lastResponseType === 'COMMAND_ACCEPTED') return;
    requestGate.current.complete(activeOrderRequestId.current);
    activeOrderRequestId.current = null;
    setIsSubmitting(false);
  }, [lastResponseId, lastResponseType]);

  useEffect(() => {
    if (maxSpendCents <= 0) return;
    const selectedSpend = parseFloat(buyUsdSpend);
    if (Number.isFinite(selectedSpend) && selectedSpend > maxSpendCents) {
      setBuyUsdSpend(maxBuySpend);
    }
  }, [buyUsdSpend, maxBuySpend, maxSpendCents]);

  useEffect(() => {
    if (!marketInfo?.conditionId) return;
    const request = () => sendMessage({ type: 'REQUEST_QUOTES', payload: {
      conditionId: marketInfo.conditionId,
      outcome: activeOutcome,
      requestedDollars: buyUsdSpend,
      requestedShares: sellShares || String(availableShares),
      slippageBps,
    } });
    request();
    const interval = setInterval(request, 1000);
    return () => clearInterval(interval);
  }, [marketInfo?.conditionId, activeOutcome, buyUsdSpend, sellShares, availableShares, slippageBps, sendMessage]);

  const formatMarketTime = (timestamp?: number) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  const getMarketLabel = (market: MarketState) => {
    const time = formatMarketTime(market.targetTime);
    const type = market.type || 'MARKET';
    return time ? `${type} ${time}` : type;
  };

  const selectableMarkets = discoveredMarkets.filter(m => m.type !== 'PREVIOUS' && m.status !== 'CLOSED' && m.status !== 'RESOLVING');
  const pageMarketSlug = pageHref.match(/\/event\/([^/?#]+)/)?.[1] || '';
  const panelMarketSlug = marketInfo?.slug || '';
  const pageMarketMismatch = Boolean(pageMarketSlug && panelMarketSlug && pageMarketSlug !== panelMarketSlug);
  const openPanelMarket = () => {
    if (panelMarketSlug) {
      window.location.href = `/event/${panelMarketSlug}`;
    }
  };

  const handleArmLive = () => {
    sendMessage({ type: 'ARM_LIVE', payload: { durationSeconds: 300 } });
  };

  const handleDisarmLive = () => {
    sendMessage({ type: 'DISARM_LIVE' });
  };

  useEffect(() => {
    if (connected === false && isSubmitting) {
      if (activeOrderRequestId.current) {
        requestGate.current.complete(activeOrderRequestId.current);
        activeOrderRequestId.current = null;
      }
      setIsSubmitting(false);
    }
  }, [connected, isSubmitting]);

  const submitOrder = (quote: ExecutableQuote, side: Side, dollarSpend?: string, shares?: string) => {
    if (isSubmitting) return;
    const requestId = crypto.randomUUID();
    if (!requestGate.current.begin(requestId)) return;
    activeOrderRequestId.current = requestId;
    setError('');
    clearBackendError?.();
    setIsSubmitting(true);
    const acceptedId = sendMessage({
      type: 'PLACE_ORDER_INTENT',
      id: requestId,
      payload: {
        requestId,
        conditionId: quote.conditionId,
        tokenId: quote.tokenId,
        outcome: quote.outcome,
        side,
        executionMode: quote.executionMode,
        orderType: quote.executionMode === 'IMMEDIATE' ? 'FAK' : 'GTC',
        quoteId: quote.quoteId,
        marketRevision: quote.marketRevision,
        dollarSpend: side === 'BUY' ? dollarSpend : undefined,
        shares: side === 'SELL' ? shares : undefined,
        slippageBps: quote.executionMode === 'IMMEDIATE' ? slippageBps : undefined,
        postOnly: quote.executionMode === 'MAKER',
      },
    });
    if (!acceptedId) {
      requestGate.current.complete(requestId);
      activeOrderRequestId.current = null;
      setIsSubmitting(false);
    } else {
      setTimeout(() => {
        if (activeOrderRequestId.current === requestId) {
          requestGate.current.complete(requestId);
          activeOrderRequestId.current = null;
          setIsSubmitting(false);
          setError('Order request timed out');
        }
      }, 5000);
    }
  };

  const handlePlaceOrder = (presetId: string, side: Side, capturedSize: string, capturedUsd?: string) => {
    const quote = quotes.find(item => item.presetId === presetId && item.side === side && item.outcome === activeOutcome
      && item.executionMode === 'MAKER' && item.expiresAt > Date.now());
    if (!quote) { setError('Quote expired; wait for the next price update.'); return; }
    submitOrder(quote, side, capturedUsd, capturedSize);
  };

  const getActiveQuote = () => {
    if (!marketInfo) return { bid: 0, ask: 0, mid: 0 };
    const isUp = activeOutcome === 'UP';
    const bid = parseFloat(isUp ? (marketInfo.upBid || marketInfo.yesBid || '0') : (marketInfo.downBid || marketInfo.noBid || '0'));
    const ask = parseFloat(isUp ? (marketInfo.upAsk || marketInfo.yesAsk || '0') : (marketInfo.downAsk || marketInfo.noAsk || '0'));
    const mid = bid > 0 && ask > 0 ? (bid + ask) / 2 : parseFloat(isUp ? (marketInfo.upPrice || marketInfo.yesPrice || '0.50') : (marketInfo.downPrice || marketInfo.noPrice || '0.50'));
    return { bid, ask, mid };
  };

  const formatCents = (value: number) => Number.isFinite(value) && value > 0 ? `${Math.round(value * 100)}¢` : '--';
  const floorToDecimals = (value: number, decimals: number) => {
    if (!Number.isFinite(value) || value <= 0) return (0).toFixed(decimals);
    const scale = 10 ** decimals;
    return (Math.floor(value * scale) / scale).toFixed(decimals);
  };
  const defaultSellShares = floorToDecimals(availableShares, 4);
  const formatHeldShares = (value: number) => floorToDecimals(value, 4);

  const handleOneTapOrder = (side: Side) => {
    const quote = quotes.find(item => item.side === side && item.outcome === activeOutcome
      && item.executionMode === 'IMMEDIATE' && item.expiresAt > Date.now());
    const capturedSize = side === 'SELL' ? (sellShares || defaultSellShares) : undefined;
    const capturedUsd = side === 'BUY' ? buyUsdSpend : undefined;
    if (!quote) { setError('Quote expired; wait for the next price update.'); return; }
    submitOrder(quote, side, capturedUsd, capturedSize);
  };

  const calculatePresetPrice = (preset: PresetConfig): string | null =>
    quotes.find(item => item.presetId === preset.id && item.side === preset.side && item.outcome === activeOutcome
      && item.executionMode === 'MAKER' && item.expiresAt > Date.now())?.displayedPrice || null;

  const isExecutionBlocked: boolean = !readiness || (readiness.blockingReasons && readiness.blockingReasons.length > 0) || !readiness.liveArmed;
  const activeQuote = getActiveQuote();
  const oneTapBuyShares = activeQuote.ask > 0 ? buySpendNum / activeQuote.ask : 0;
  const oneTapSellShares = parseFloat(sellShares || defaultSellShares) || 0;
  const oneTapBuyValid = hasEnoughBalance && oneTapBuyShares > 0 && (minimumOrderSize <= 0 || oneTapBuyShares >= minimumOrderSize);
  const oneTapSellValid = oneTapSellShares > 0 && oneTapSellShares <= availableShares && (minimumOrderSize <= 0 || oneTapSellShares >= minimumOrderSize);
  const activeOrders = orders.filter(order => !['CANCELLED', 'CANCELED', 'FILLED', 'REJECTED', 'EXPIRED'].includes(order.status));
  const handleCancelAll = () => sendMessage({ type: 'CANCEL_ALL', payload: marketInfo?.conditionId ? { conditionId: marketInfo.conditionId } : undefined });

  return (
    <div className="flex flex-col gap-3 font-sans text-xs">
      {/* Operational State & Arming Header */}
      <div className="bg-gray-800 p-2.5 rounded border border-gray-700 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${
              operationalState === 'LIVE_ARMED' ? 'bg-green-500 animate-pulse' :
              operationalState === 'LIVE_DISARMED' ? 'bg-yellow-500' :
              operationalState === 'READ_ONLY' ? 'bg-blue-500' : 'bg-red-500'
            }`} />
            <span className="font-bold tracking-wider text-gray-200 uppercase">{operationalState}</span>
          </div>

          {readiness?.liveArmed ? (
            <button 
              onClick={handleDisarmLive}
              className="flex items-center gap-1 bg-red-800 hover:bg-red-700 text-white text-[10px] px-2 py-1 rounded font-bold uppercase"
            >
              <Square size={12} /> Disarm
            </button>
          ) : (
            <button 
              onClick={handleArmLive}
              disabled={Boolean(readiness && readiness.blockingReasons.filter(r => r !== 'LIVE EXECUTION DISARMED').length > 0)}
              className="flex items-center gap-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-[10px] px-2.5 py-1 rounded font-bold uppercase tracking-wider"
            >
              <Play size={12} /> ARM LIVE
            </button>
          )}
        </div>

        {/* Blocking reasons banner */}
        {readiness && readiness.blockingReasons.length > 0 && (
          <div className="bg-red-950/80 border border-red-800 p-1.5 rounded text-[10px] text-red-300 font-mono flex flex-col gap-0.5">
            {readiness.blockingReasons.map((reason, idx) => (
              <div key={idx} className="flex items-start gap-1">
                <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                <span>{reason}</span>
              </div>
            ))}
          </div>
        )}

        {pageMarketMismatch && pageFollow === 'PROMPT' && (
          <div className="bg-yellow-950/80 border border-yellow-700 p-1.5 rounded text-[10px] text-yellow-200 font-mono flex items-center justify-between gap-2">
            <div className="flex items-start gap-1">
              <AlertTriangle size={10} className="shrink-0 mt-0.5" />
              <span>POLYMARKET PAGE LAGGING; TERMINAL TRADES CURRENT MARKET</span>
            </div>
            <button
              onClick={openPanelMarket}
              className="px-2 py-0.5 bg-yellow-600 hover:bg-yellow-500 text-gray-950 rounded font-bold uppercase"
              title={panelMarketSlug ? `Open ${panelMarketSlug}` : 'Open panel market'}
            >
              Open
            </button>
          </div>
        )}
      </div>

      <div className="bg-gray-800 px-2 py-1.5 rounded border border-gray-700 grid grid-cols-[auto_auto_1fr_auto] items-center gap-2 text-[10px] font-mono">
        <span className="text-gray-400">MARKET <strong className="text-white">{marketInfo?.type || 'NONE'}</strong></span>
        <span className="text-gray-400">OPEN <strong className="text-white">{activeOrders.length}</strong></span>
        <span className="text-gray-400 truncate" title={lastResult}>LAST <strong className="text-white">{lastResult}</strong></span>
        <button onClick={handleCancelAll} disabled={activeOrders.length === 0} className="bg-red-900 hover:bg-red-800 disabled:opacity-40 px-2 py-1 rounded font-bold text-white" title="Cancel all open orders">CANCEL ALL</button>
      </div>

      {/* Discovered Markets Selector */}
      {selectableMarkets.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {selectableMarkets.map(m => (
            <button
              key={m.marketId}
              onClick={() => {
                sendMessage({
                  type: 'SUBSCRIBE_MARKET',
                  payload: {
                    conditionId: m.conditionId,
                    yesTokenId: m.upTokenId || m.yesTokenId,
                    noTokenId: m.downTokenId || m.noTokenId,
                    upTokenId: m.upTokenId || m.yesTokenId,
                    downTokenId: m.downTokenId || m.noTokenId,
                  }
                });
              }}
              className={`px-2 py-1 rounded text-[10px] border font-mono whitespace-nowrap ${
                marketInfo?.marketId === m.marketId 
                  ? 'bg-blue-900 border-blue-500 text-white font-bold' 
                  : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
              }`}
              title={`${m.type || 'MARKET'}: ${m.title || m.marketId}${m.targetTime ? `, ends ${formatMarketTime(m.targetTime)}` : ''}`}
            >
              {m.type === 'CURRENT' && <span className="text-green-400 font-bold mr-1">•</span>}
              {m.type === 'NEXT' && <span className="text-yellow-400 font-bold mr-1">•</span>}
              {getMarketLabel(m)}
            </button>
          ))}
        </div>
      )}

      {/* Chainlink Reference & Price Anchor Card */}
      <div className="bg-gray-800 p-2.5 rounded border border-gray-700 flex flex-col gap-1.5 font-mono text-[11px]">
        <div className="flex justify-between items-center text-gray-400 text-[10px]">
          <span>BTC/USD CHAINLINK REFERENCE</span>
          <span>AGE: {rtdsMetrics?.dataAgeMs ? (rtdsMetrics.dataAgeMs / 1000).toFixed(1) : '0.0'}s</span>
        </div>
        <div className="flex justify-between items-baseline">
          <div>
            <span className="text-gray-400 text-[10px] block">PRICE TO BEAT</span>
            <span className="text-sm font-bold text-yellow-400">
              {rtdsMetrics?.priceToBeat && parseFloat(rtdsMetrics.priceToBeat) > 0 
                ? `$${parseFloat(rtdsMetrics.priceToBeat).toLocaleString('en-US', { minimumFractionDigits: 2 })}` 
                : 'ANCHOR PENDING'}
            </span>
          </div>
          <div className="text-right">
            <span className="text-gray-400 text-[10px] block">CHAINLINK LIVE</span>
            <span className="text-sm font-bold text-white">
              {rtdsMetrics?.currentPrice ? `$${rtdsMetrics.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : 'OFFLINE'}
            </span>
          </div>
        </div>
        {rtdsMetrics?.difference !== undefined && (
          <div className="flex justify-between items-center text-[10px] pt-1 border-t border-gray-700/60">
            <span className="text-gray-400">DIFF: {rtdsMetrics.difference >= 0 ? `+$${rtdsMetrics.difference.toFixed(2)}` : `-$${Math.abs(rtdsMetrics.difference).toFixed(2)}`}</span>
            <span className={`font-bold ${rtdsMetrics.leadingOutcome === 'UP' ? 'text-green-400' : rtdsMetrics.leadingOutcome === 'DOWN' ? 'text-red-400' : 'text-gray-400'}`}>
              LEADING: {rtdsMetrics.leadingOutcome || 'NONE'}
            </span>
          </div>
        )}
      </div>

      {/* Market Prices Overview */}
      {marketInfo && (
        <div className="bg-gray-800 p-2 rounded border border-gray-700 flex justify-between items-center text-[11px] font-mono">
          <div className="flex items-center gap-2">
            <span className="text-green-400 font-bold">UP</span>
            <span>BID: {marketInfo.upBid || marketInfo.yesBid || '0.00'}</span>
            <span>ASK: {marketInfo.upAsk || marketInfo.yesAsk || '0.00'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-red-400 font-bold">DOWN</span>
            <span>BID: {marketInfo.downBid || marketInfo.noBid || '0.00'}</span>
            <span>ASK: {marketInfo.downAsk || marketInfo.noAsk || '0.00'}</span>
          </div>
        </div>
      )}

      {/* Outcome Switcher */}
      <div className="bg-gray-800 p-1 rounded border border-gray-700 grid grid-cols-2 gap-1">
        <button
          onClick={() => setExecutionMode('MAKER')}
          className={`py-1.5 rounded text-[11px] font-bold uppercase flex items-center justify-center gap-1 ${
            executionMode === 'MAKER' ? 'bg-blue-700 text-white' : 'text-gray-400 hover:bg-gray-700'
          }`}
          title="Place post-only resting limit orders"
        >
          Maker
        </button>
        <button
          onClick={() => setExecutionMode('IMMEDIATE')}
          className={`py-1.5 rounded text-[11px] font-bold uppercase flex items-center justify-center gap-1 ${
            executionMode === 'IMMEDIATE' ? 'bg-yellow-600 text-gray-950' : 'text-gray-400 hover:bg-gray-700'
          }`}
          title="Use a FAK market order with slippage protection"
        >
          <Zap size={12} /> Immediate <span className="text-[9px]">FAK</span>
        </button>
      </div>

      <div className="flex bg-gray-900 rounded p-1 shadow-inner border border-gray-700">
        <button 
          onClick={() => setActiveOutcome('UP')}
          className={`flex-1 py-1.5 rounded font-bold text-xs transition-colors ${
            activeOutcome === 'UP' ? 'bg-green-700 text-white shadow' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          UP
        </button>
        <button 
          onClick={() => setActiveOutcome('DOWN')}
          className={`flex-1 py-1.5 rounded font-bold text-xs transition-colors ${
            activeOutcome === 'DOWN' ? 'bg-red-700 text-white shadow' : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          DOWN
        </button>
      </div>

      {/* BUY Sizing Section */}
      <div className="bg-gray-800 p-2.5 rounded border border-gray-700 flex flex-col gap-2">
        <div className="flex justify-between items-center text-[11px]">
          <span className="font-bold text-green-400 uppercase">BUY SIZING (USD)</span>
          <span className="text-gray-400 font-mono">BAL: ${balance.toFixed(2)}</span>
        </div>
        <div className="flex gap-1">
          {['10', '25', '50', '100'].map(usd => (
            <button
              key={usd}
              onClick={() => setBuyUsdSpend(usd)}
              disabled={parseFloat(usd) > maxSpendCents}
              className={`flex-1 py-1 rounded text-xs font-mono border disabled:opacity-40 disabled:hover:bg-gray-700 ${
                buyUsdSpend === usd ? 'bg-green-800 border-green-500 text-white font-bold' : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
              }`}
            >
              ${usd}
            </button>
          ))}
          <button
            onClick={() => setBuyUsdSpend(maxBuySpend)}
            disabled={maxSpendCents <= 0}
            className={`flex-1 py-1 rounded text-xs font-mono border ${
              buyUsdSpend === maxBuySpend ? 'bg-green-800 border-green-500 text-white font-bold' : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
            } disabled:opacity-40 disabled:hover:bg-gray-700`}
            title={`Use full available balance: $${maxBuySpend}`}
          >
            MAX
          </button>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-gray-400">Custom USD:</label>
          <input 
            id="buy-usd-spend"
            name="buyUsdSpend"
            type="number"
            value={buyUsdSpend}
            onChange={e => setBuyUsdSpend(e.target.value)}
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white font-mono text-xs outline-none focus:border-blue-500"
            placeholder="Spend USD"
          />
        </div>
        {!hasEnoughBalance && buySpendNum > 0 && (
          <div className="text-[10px] text-yellow-300 font-mono">Spend must be between $0.01 and ${maxBuySpend}.</div>
        )}

        {/* Dynamic BUY Price Buttons */}
        {executionMode === 'MAKER' && <div className="text-[10px] text-gray-400 font-bold pt-1 border-t border-gray-700">BUY {activeOutcome} MAKER PRESETS</div>}
        {executionMode === 'MAKER' && <div className="grid grid-cols-3 gap-1.5">
          {activePresets.filter(p => p.side === 'BUY' && p.active).map(preset => {
            const price = calculatePresetPrice(preset);
            const priceNum = price ? parseFloat(price) : 0.5;
            const shares = priceNum > 0 ? (buySpendNum / priceNum).toFixed(1) : '0';
            const sharesNum = parseFloat(shares);
            const priceCents = price ? Math.round(parseFloat(price) * 100) : '-';
            const meetsMinimumSize = minimumOrderSize <= 0 || sharesNum >= minimumOrderSize;

            return (
              <button
                key={preset.id}
                onClick={() => price && handlePlaceOrder(preset.id, 'BUY', shares, buyUsdSpend)}
                disabled={isExecutionBlocked || !price || isSubmitting || !hasEnoughBalance || !meetsMinimumSize}
                className="bg-green-700 hover:bg-green-600 disabled:opacity-40 py-2 rounded text-center font-mono font-bold text-white border border-green-500/50 shadow flex flex-col items-center justify-center"
                title={`${preset.name} - Est Shares: ${shares}${!meetsMinimumSize ? `; minimum ${minimumOrderSize} shares` : ''}`}
              >
                <span className="text-sm font-bold flex items-center justify-center gap-1">
                  {isSubmitting && <Loader2 size={12} className="animate-spin" />}
                  BUY {activeOutcome} [{priceCents}¢]
                </span>
                <span className="text-[9px] text-green-200 font-normal">(${buyUsdSpend})</span>
              </button>
            );
          })}
        </div>}
      </div>

      {/* SELL Sizing Section */}
      <div className="bg-gray-800 p-2.5 rounded border border-gray-700 flex flex-col gap-2">
        <div className="flex justify-between items-center text-[11px]">
          <span className="font-bold text-red-400 uppercase">SELL SIZING ({activeOutcome} POSITION)</span>
          <span className="text-gray-400 font-mono">HELD: {formatHeldShares(availableShares)} SHARES</span>
        </div>
        <div className="flex gap-1">
          {['25', '50', '100'].map(pct => (
            <button
              key={pct}
              onClick={() => {
                const calculated = floorToDecimals(availableShares * (parseFloat(pct) / 100), 4);
                setSellShares(calculated);
              }}
              disabled={availableShares <= 0}
              className="flex-1 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 border border-gray-600 rounded text-xs font-mono text-gray-300"
            >
              {pct}%
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-gray-400">Custom Shares:</label>
          <input 
            id="sell-shares"
            name="sellShares"
            type="number"
            value={sellShares}
            onChange={e => setSellShares(e.target.value)}
            className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white font-mono text-xs outline-none focus:border-blue-500"
            placeholder="Shares to sell"
          />
        </div>

        {/* Dynamic SELL Price Buttons */}
        {executionMode === 'MAKER' && <div className="text-[10px] text-gray-400 font-bold pt-1 border-t border-gray-700">SELL {activeOutcome} MAKER PRESETS</div>}
        {executionMode === 'MAKER' && <div className="grid grid-cols-3 gap-1.5">
          {activePresets.filter(p => p.side === 'SELL' && p.active).map(preset => {
            const price = calculatePresetPrice(preset);
            const sharesToSell = sellShares || defaultSellShares;
            const sharesToSellNum = parseFloat(sharesToSell) || 0;
            const priceCents = price ? Math.round(parseFloat(price) * 100) : '-';
            const sellSizeValid = sharesToSellNum > 0 && sharesToSellNum <= availableShares && (minimumOrderSize <= 0 || sharesToSellNum >= minimumOrderSize);

            return (
              <button
                key={preset.id}
                onClick={() => price && sellSizeValid && handlePlaceOrder(preset.id, 'SELL', sharesToSell)}
                disabled={isExecutionBlocked || !price || !sellSizeValid || isSubmitting}
                className="bg-red-700 hover:bg-red-600 disabled:opacity-40 py-2 rounded text-center font-mono font-bold text-white border border-red-500/50 shadow flex flex-col items-center justify-center"
                title={`${preset.name} - Shares: ${sharesToSell}${sharesToSellNum > availableShares ? '; exceeds held shares' : ''}${minimumOrderSize > 0 && sharesToSellNum < minimumOrderSize ? `; minimum ${minimumOrderSize} shares` : ''}`}
              >
                <span className="text-sm font-bold flex items-center justify-center gap-1">
                  {isSubmitting && <Loader2 size={12} className="animate-spin" />}
                  SELL {activeOutcome} [{priceCents}¢]
                </span>
                <span className="text-[9px] text-red-200 font-normal">({sharesToSell} sh)</span>
              </button>
            );
          })}
        </div>}
      </div>

      {executionMode === 'IMMEDIATE' && (
        <div className="bg-yellow-950/30 p-2.5 rounded border border-yellow-700/70 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-yellow-300 font-bold uppercase text-[11px]">
              <Zap size={12} />
              Immediate FAK
            </div>
            <div className="flex items-center gap-1 text-[10px] font-mono text-gray-300">
              <span>Slip</span>
              {[50, 100, 200].map(value => (
                <button
                  key={value}
                  onClick={() => setSlippageBps(value)}
                  className={`px-1.5 py-0.5 rounded border ${slippageBps === value ? 'bg-yellow-600 border-yellow-400 text-gray-950 font-bold' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}
                >
                  {(value / 100).toFixed(value % 100 === 0 ? 0 : 1)}%
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
            <div className="bg-gray-900/80 border border-gray-700 rounded p-1.5">
              <div className="text-gray-500">BUY REF</div>
              <div className="text-green-300 font-bold">{formatCents(activeQuote.ask || activeQuote.mid)}</div>
            </div>
            <div className="bg-gray-900/80 border border-gray-700 rounded p-1.5">
              <div className="text-gray-500">SELL REF</div>
              <div className="text-red-300 font-bold">{formatCents(activeQuote.bid || activeQuote.mid)}</div>
            </div>
            <div className="bg-gray-900/80 border border-gray-700 rounded p-1.5">
              <div className="text-gray-500">MODE</div>
              <div className="text-yellow-300 font-bold">FAK</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => handleOneTapOrder('BUY')}
              disabled={isExecutionBlocked || isSubmitting || !oneTapBuyValid || activeQuote.ask <= 0}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-40 py-2.5 rounded text-center font-mono font-bold text-white border border-green-500/60 shadow flex flex-col items-center justify-center"
              title={`Market buy up to $${buyUsdSpend}; estimated ${oneTapBuyShares.toFixed(2)} shares`}
            >
              <span className="text-sm font-bold flex items-center justify-center gap-1">
                {isSubmitting && <Loader2 size={12} className="animate-spin" />}
                BUY {activeOutcome}
              </span>
              <span className="text-[9px] text-green-200 font-normal">${buyUsdSpend} now</span>
            </button>
            <button
              onClick={() => handleOneTapOrder('SELL')}
              disabled={isExecutionBlocked || isSubmitting || !oneTapSellValid || activeQuote.bid <= 0}
              className="bg-red-700 hover:bg-red-600 disabled:opacity-40 py-2.5 rounded text-center font-mono font-bold text-white border border-red-500/60 shadow flex flex-col items-center justify-center"
              title={`Market sell ${oneTapSellShares.toFixed(4)} shares`}
            >
              <span className="text-sm font-bold flex items-center justify-center gap-1">
                {isSubmitting && <Loader2 size={12} className="animate-spin" />}
                SELL {activeOutcome}
              </span>
              <span className="text-[9px] text-red-200 font-normal">{oneTapSellShares.toFixed(2)} sh now</span>
            </button>
          </div>
          {minimumOrderSize > 0 && !oneTapBuyValid && buySpendNum > 0 && (
            <div className="text-[10px] text-yellow-300 font-mono">Buy size estimates below the {minimumOrderSize} share minimum at current ask.</div>
          )}
        </div>
      )}

      {(error || backendError) && (
        <div className="bg-red-900/80 border border-red-500 text-red-200 p-2 rounded text-xs font-mono">
          {error || backendError}
        </div>
      )}
    </div>
  );
};

export default TradingPanel;

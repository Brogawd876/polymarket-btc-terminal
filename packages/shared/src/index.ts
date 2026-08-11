import { z } from 'zod';

export const PROTOCOL_VERSION = 3 as const;

export const ProtocolVersionSchema = z.literal(PROTOCOL_VERSION);

export const OperationalStateSchema = z.enum([
  'OFFLINE',
  'READ_ONLY',
  'LIVE_DISARMED',
  'LIVE_ARMED',
  'SUBMITTING',
  'RECONCILING',
  'STALE_DATA',
  'MARKET_SWITCHING',
  'ERROR'
]);
export type OperationalState = z.infer<typeof OperationalStateSchema>;

export const OrderStateSchema = z.enum([
  'CREATED',
  'VALIDATING',
  'SUBMITTING',
  'ACCEPTED',
  'LIVE',
  'PARTIALLY_FILLED',
  'FILLED',
  'CANCEL_PENDING',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
  'RECONCILING',
  'UNKNOWN'
]);
export type OrderState = z.infer<typeof OrderStateSchema>;

export const SideSchema = z.enum(['BUY', 'SELL']);
export type Side = z.infer<typeof SideSchema>;

export const ExecutionModeSchema = z.enum(['MAKER', 'IMMEDIATE', 'ONE_TAP']);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const OutcomeSchema = z.enum(['UP', 'DOWN']);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const PresetModeSchema = z.enum(['PERCENT_OFFSET', 'CENT_OFFSET', 'ABSOLUTE_PRICE']);
export type PresetMode = z.infer<typeof PresetModeSchema>;

export const PresetReferenceSchema = z.enum(['BEST_BID', 'BEST_ASK', 'MIDPOINT', 'LAST_TRADE']);
export type PresetReference = z.infer<typeof PresetReferenceSchema>;

export const ClampModeSchema = z.enum(['CLAMP', 'DISABLE']);
export type ClampMode = z.infer<typeof ClampModeSchema>;

export const PresetConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  side: SideSchema,
  mode: PresetModeSchema,
  reference: PresetReferenceSchema,
  value: z.number(),
  active: z.boolean().default(true),
  clampMode: ClampModeSchema.default('CLAMP'),
});
export type PresetConfig = z.infer<typeof PresetConfigSchema>;

export const StringAmountSchema = z.string().regex(/^\d+(\.\d+)?$/, "Must be a valid decimal string");

export const BookQualitySchema = z.enum([
  'INITIALIZING',
  'FRESH',
  'STALE',
  'RECOVERING',
  'INCOMPLETE',
  'CROSSED',
  'INVALID',
]);
export type BookQuality = z.infer<typeof BookQualitySchema>;

export const BookStateSchema = z.object({
  tokenId: z.string(),
  outcome: OutcomeSchema,
  bid: StringAmountSchema.optional(),
  ask: StringAmountSchema.optional(),
  spread: StringAmountSchema.optional(),
  lastTrade: StringAmountSchema.optional(),
  tickSize: StringAmountSchema,
  minimumOrderSize: StringAmountSchema,
  exchangeTimestamp: z.number().optional(),
  receiveTimestamp: z.number(),
  lastGoodTimestamp: z.number().optional(),
  version: z.number().int().nonnegative(),
  quality: BookQualitySchema,
  staleReason: z.string().optional(),
});
export type BookState = z.infer<typeof BookStateSchema>;

export const ReadinessCheckSchema = z.object({
  code: z.string(),
  subsystem: z.enum(['SYSTEM', 'MARKET', 'REFERENCE', 'ACCOUNT', 'RECOVERY', 'RISK', 'EXECUTION']),
  ready: z.boolean(),
  message: z.string(),
  measuredValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  limitValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type ReadinessCheck = z.infer<typeof ReadinessCheckSchema>;

export const LiveReadinessSchema = z.object({
  backendConnected: z.boolean(),
  publicMarketConnected: z.boolean(),
  referenceConnected: z.boolean(),
  selectedMarketValid: z.boolean(),
  currentWindowValid: z.boolean(),
  accountConfigured: z.boolean(),
  accountAuthenticated: z.boolean(),
  userStreamConnected: z.boolean(),
  balanceLoaded: z.boolean(),
  allowanceValid: z.boolean(),
  reconciliationComplete: z.boolean(),
  marketDataFresh: z.boolean(),
  referenceDataFresh: z.boolean(),
  minimumTimeRemainingSatisfied: z.boolean(),
  liveEnabledByConfiguration: z.boolean(),
  liveArmed: z.boolean(),
  blockingReasons: z.array(z.string()),
  executionPermitted: z.boolean().optional(),
  checks: z.array(ReadinessCheckSchema).optional(),
  revision: z.number().int().nonnegative().optional(),
  stale: z.boolean().optional(),
  staleReason: z.string().optional(),
  bookSourceTimestamp: z.number().optional(),
  bookReceiveTimestamp: z.number().optional(),
  bookAgeMs: z.number().optional(),
});
export type LiveReadiness = z.infer<typeof LiveReadinessSchema>;

export const MarketAnchorSchema = z.object({
  conditionId: z.string(),
  windowStart: z.number(),
  value: z.string(),
  sourceTimestamp: z.number(),
  validated: z.boolean(),
  source: z.enum(['POLYMARKET_PAGE', 'CHAINLINK_WINDOW', 'PERSISTED']).optional(),
  observedAt: z.number().optional(),
  validationMethod: z.string().optional(),
  validationEvidence: z.string().optional(),
});
export type MarketAnchor = z.infer<typeof MarketAnchorSchema>;

export const MarketStateSchema = z.object({
  marketId: z.string(),
  conditionId: z.string(),
  slug: z.string().optional(),
  upTokenId: z.string(),
  downTokenId: z.string(),
  // Keep yesTokenId / noTokenId for compatibility
  yesTokenId: z.string(),
  noTokenId: z.string(),
  upPrice: StringAmountSchema,
  downPrice: StringAmountSchema,
  yesPrice: StringAmountSchema.optional(),
  noPrice: StringAmountSchema.optional(),
  upBid: StringAmountSchema.optional(),
  upAsk: StringAmountSchema.optional(),
  downBid: StringAmountSchema.optional(),
  downAsk: StringAmountSchema.optional(),
  yesBid: StringAmountSchema.optional(),
  yesAsk: StringAmountSchema.optional(),
  noBid: StringAmountSchema.optional(),
  noAsk: StringAmountSchema.optional(),
  status: z.enum(['OPEN', 'RESOLVING', 'RESOLVED', 'CLOSED']),
  lastUpdated: z.number(),
  targetTime: z.number().optional(),
  startTime: z.number().optional(),
  type: z.enum(['PREVIOUS', 'CURRENT', 'NEXT']).optional(),
  title: z.string().optional(),
  tickSize: z.string().default('0.01'),
  minimumOrderSize: z.string().default('5'),
  revision: z.number().int().nonnegative().optional(),
  stale: z.boolean().optional(),
  staleReason: z.string().optional(),
  bookSourceTimestamp: z.number().optional(),
  bookReceiveTimestamp: z.number().optional(),
  bookAgeMs: z.number().optional(),
  transitionPhase: z.enum(['STEADY', 'CUTOFF', 'SWITCHING', 'VALIDATING_ANCHOR', 'WAITING_FOR_BOOKS']).optional(),
  upBook: BookStateSchema.optional(),
  downBook: BookStateSchema.optional(),
});
export type MarketState = z.infer<typeof MarketStateSchema>;

export const ExecutableQuoteSchema = z.object({
  quoteId: z.string(),
  conditionId: z.string(),
  tokenId: z.string(),
  outcome: OutcomeSchema,
  side: SideSchema,
  executionMode: z.enum(['MAKER', 'IMMEDIATE']),
  presetId: z.string().optional(),
  referenceType: PresetReferenceSchema,
  referencePrice: StringAmountSchema,
  rawCalculatedPrice: StringAmountSchema,
  tickSize: StringAmountSchema,
  makerBoundary: StringAmountSchema,
  displayedPrice: StringAmountSchema,
  submittedPrice: StringAmountSchema,
  clamped: z.boolean(),
  clampReason: z.string().optional(),
  bookVersion: z.number().int().nonnegative(),
  marketRevision: z.number().int().nonnegative(),
  calculatedAt: z.number(),
  expiresAt: z.number(),
  estimatedShares: StringAmountSchema.optional(),
  estimatedDollars: StringAmountSchema.optional(),
});
export type ExecutableQuote = z.infer<typeof ExecutableQuoteSchema>;

export const OrderIntentSchema = z.object({
  requestId: z.string(),
  conditionId: z.string(),
  tokenId: z.string(),
  outcome: OutcomeSchema,
  side: SideSchema,
  executionMode: ExecutionModeSchema,
  orderType: z.enum(['GTC', 'GTD', 'FAK', 'FOK']),
  quoteId: z.string().optional(),
  marketRevision: z.number().int().nonnegative(),
  dollarSpend: StringAmountSchema.optional(),
  shares: StringAmountSchema.optional(),
  slippageBps: z.number().int().min(0).max(5000).optional(),
  expiration: z.number().optional(),
  postOnly: z.boolean().optional(),
}).superRefine((intent, ctx) => {
  if (intent.side === 'BUY' && !intent.dollarSpend) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'BUY intent requires dollarSpend', path: ['dollarSpend'] });
  }
  if (intent.side === 'SELL' && !intent.shares) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SELL intent requires shares', path: ['shares'] });
  }
  if (!intent.quoteId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Executable quote is required', path: ['quoteId'] });
  }
});
export type OrderIntent = z.infer<typeof OrderIntentSchema>;

export const SubmissionResultSchema = z.object({
  requestId: z.string(),
  orderId: z.string(),
  remoteOrderId: z.string().optional(),
  result: z.enum(['ACCEPTED', 'REJECTED', 'AMBIGUOUS']),
  requestedAmount: StringAmountSchema.optional(),
  executedAmount: StringAmountSchema.optional(),
  unfilledAmount: StringAmountSchema.optional(),
  filledShares: StringAmountSchema.optional(),
  averageExecutionPrice: StringAmountSchema.optional(),
  fee: StringAmountSchema.optional(),
  remoteTradeIds: z.array(z.string()).default([]),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});
export type SubmissionResult = z.infer<typeof SubmissionResultSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  clientRequestId: z.string().optional(),
  remoteOrderId: z.string().optional(),
  conditionId: z.string().optional(),
  tokenId: z.string(),
  outcome: OutcomeSchema.optional(),
  side: SideSchema,
  dollarSpend: StringAmountSchema.optional(),
  size: StringAmountSchema, // requested shares
  price: StringAmountSchema, // limit price
  executionMode: ExecutionModeSchema.optional(),
  orderType: z.enum(['GTC', 'GTD', 'FAK', 'FOK']).optional(),
  presetId: z.string().optional(),
  filledShares: StringAmountSchema.default('0'),
  remainingShares: StringAmountSchema.optional(),
  averageFillPrice: StringAmountSchema.optional(),
  fees: StringAmountSchema.optional(),
  feesKnown: z.boolean().optional(),
  status: z.string(), // OrderState
  state: OrderStateSchema.optional(),
  remoteState: z.string().optional(),
  timestamp: z.number(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
  requestedPrice: StringAmountSchema.optional(),
  submittedPrice: StringAmountSchema.optional(),
  requestedShares: StringAmountSchema.optional(),
  submissionResult: z.enum(['ACCEPTED', 'REJECTED', 'AMBIGUOUS']).optional(),
  reconciliationRequired: z.boolean().optional(),
});
export type Order = z.infer<typeof OrderSchema>;

export const PositionSchema = z.object({
  tokenId: z.string(),
  conditionId: z.string().optional(),
  outcome: OutcomeSchema.optional(),
  netSize: StringAmountSchema,
  netShares: StringAmountSchema.optional(),
  availableShares: StringAmountSchema.optional(),
  reservedShares: StringAmountSchema.optional(),
  avgPrice: StringAmountSchema,
  averageEntry: StringAmountSchema.optional(),
  currentBestBid: StringAmountSchema.optional(),
  estimatedLiquidationValue: StringAmountSchema.optional(),
  fees: StringAmountSchema.default('0'),
  unrealizedPnl: z.number().default(0),
  realizedPnl: z.number().default(0),
  resolutionState: z.string().optional(),
  updatedAt: z.number(),
  feesKnown: z.boolean().optional(),
});
export type Position = z.infer<typeof PositionSchema>;

export const AccountStateSchema = z.object({
  signerAddress: z.string().optional(),
  funderAddress: z.string().optional(),
  signatureType: z.number().optional(),
  collateralBalance: z.number(),
  allowanceValid: z.boolean(),
  authenticated: z.boolean(),
  userStreamConnected: z.boolean(),
  lastReconciliationTime: z.number().optional(),
  balanceSourceTimestamp: z.number().optional(),
  balanceAgeMs: z.number().optional(),
  balanceStale: z.boolean().optional(),
  balanceStaleReason: z.string().optional(),
});
export type AccountState = z.infer<typeof AccountStateSchema>;

export const TerminalSnapshotSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  revision: z.number().int().nonnegative(),
  publishedAt: z.number(),
  operationalState: OperationalStateSchema,
  readiness: LiveReadinessSchema,
  account: AccountStateSchema.optional(),
  market: MarketStateSchema.optional(),
  markets: z.array(MarketStateSchema),
  anchor: MarketAnchorSchema.optional(),
  reference: z.object({
    currentPrice: z.number(), sourceTimestamp: z.number(), dataAgeMs: z.number(),
    connected: z.boolean(), stale: z.boolean(), priceToBeat: z.string().optional(),
    difference: z.number().optional(), leadingOutcome: OutcomeSchema.optional(),
  }).optional(),
  orders: z.array(OrderSchema),
  positions: z.array(PositionSchema),
  quotes: z.array(ExecutableQuoteSchema).default([]),
  balance: z.number().optional(),
  realizedPnl: z.number().optional(),
  presets: z.array(PresetConfigSchema).default([]),
  settings: z.record(z.unknown()).default({}),
});
export type TerminalSnapshot = z.infer<typeof TerminalSnapshotSchema>;

export const BaseMessageSchema = z.object({
  id: z.string().optional(),
  protocolVersion: ProtocolVersionSchema.optional(),
});

export const WsEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('HELLO'),
    payload: z.object({
      protocolVersion: ProtocolVersionSchema,
      extensionVersion: z.string(),
    }),
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('HELLO_ACK'),
    payload: z.object({
      protocolVersion: ProtocolVersionSchema,
      serverVersion: z.string(),
      sessionId: z.string(),
      pairingToken: z.string().min(32),
    }),
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('AUTH'),
    payload: z.object({ token: z.string() })
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('AUTH_OK')
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('AUTH_ERROR'),
    payload: z.object({ message: z.string() })
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('SNAPSHOT_REQUEST')
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('TERMINAL_SNAPSHOT'),
    payload: TerminalSnapshotSchema,
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('REQUEST_QUOTES'),
    payload: z.object({
      conditionId: z.string(),
      outcome: OutcomeSchema,
      requestedDollars: StringAmountSchema.optional(),
      requestedShares: StringAmountSchema.optional(),
      slippageBps: z.number().int().min(0).max(5000).optional(),
    }),
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('EXECUTABLE_QUOTES_UPDATED'),
    payload: z.object({
      conditionId: z.string(),
      outcome: OutcomeSchema,
      marketRevision: z.number().int().nonnegative(),
      quotes: z.array(ExecutableQuoteSchema),
    }),
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('PLACE_ORDER_INTENT'),
    payload: OrderIntentSchema,
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('ORDER_RESULT'),
    payload: SubmissionResultSchema,
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('PROTOCOL_ERROR'),
    payload: z.object({
      code: z.string(),
      message: z.string(),
      receivedProtocolVersion: z.number().optional(),
    }),
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('SNAPSHOT'),
    payload: z.object({
      operationalState: OperationalStateSchema,
      readiness: LiveReadinessSchema,
      account: AccountStateSchema.optional(),
      market: MarketStateSchema.optional(),
      markets: z.array(MarketStateSchema).optional(),
      anchor: MarketAnchorSchema.optional(),
      orders: z.array(OrderSchema),
      positions: z.array(PositionSchema),
      balance: z.number().optional(),
      realizedPnl: z.number().optional(),
      presets: z.array(PresetConfigSchema).optional(),
      settings: z.record(z.any()).optional(),
    })
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('ARM_LIVE'),
    payload: z.object({ durationSeconds: z.number().optional() }).optional()
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('DISARM_LIVE')
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('SELECT_MARKET'),
    payload: z.object({ conditionId: z.string() })
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('SUBSCRIBE_MARKET'),
    payload: z.object({
      conditionId: z.string(),
      yesTokenId: z.string(),
      noTokenId: z.string(),
      upTokenId: z.string().optional(),
      downTokenId: z.string().optional(),
    }),
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('READINESS_UPDATED'),
    payload: LiveReadinessSchema,
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('MARKET_UPDATE'),
    payload: MarketStateSchema.extend({
      operationalState: OperationalStateSchema.optional(),
      readiness: LiveReadinessSchema.optional(),
      positions: z.array(PositionSchema).optional(),
      orders: z.array(OrderSchema).optional(),
      balance: z.number().optional(),
      markets: z.array(MarketStateSchema).optional(),
    }),
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('MARKET_UPDATED'),
    payload: MarketStateSchema,
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('DISCOVERY_UPDATE'),
    payload: z.array(MarketStateSchema),
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('REFERENCE_UPDATED'),
    payload: z.object({
      currentPrice: z.number(),
      sourceTimestamp: z.number(),
      dataAgeMs: z.number(),
      connected: z.boolean(),
      stale: z.boolean(),
      priceToBeat: z.string().optional(),
      difference: z.number().optional(),
      leadingOutcome: OutcomeSchema.optional(),
    })
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('RTDS_UPDATE'),
    payload: z.object({
      price: z.number(),
      source_timestamp: z.number().optional(),
      data_age: z.number().optional(),
      stale: z.boolean().optional(),
    })
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('RTDS_STATUS'),
    payload: z.object({
      connected: z.boolean(),
    })
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('PAGE_ANCHOR_UPDATE'),
    payload: z.object({
      slug: z.string(),
      priceToBeat: z.string(),
    })
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('PRESET_PRICES_UPDATED'),
    payload: z.object({
      buyPrices: z.array(z.object({ presetId: z.string(), price: z.string(), label: z.string() })),
      sellPrices: z.array(z.object({ presetId: z.string(), price: z.string(), label: z.string() })),
    })
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('ACCOUNT_UPDATED'),
    payload: AccountStateSchema,
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('ORDER_UPDATE'),
    payload: OrderSchema,
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('ORDER_UPDATED'),
    payload: OrderSchema,
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('FILL_UPDATED'),
    payload: z.object({
      fillId: z.string(),
      orderId: z.string(),
      tokenId: z.string(),
      outcome: OutcomeSchema.optional(),
      side: SideSchema,
      price: z.string(),
      size: z.string(),
      fee: z.string(),
      timestamp: z.number(),
    })
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('POSITION_UPDATED'),
    payload: PositionSchema,
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('PLACE_ORDER'),
    payload: z.object({
      tokenId: z.string(),
      outcome: OutcomeSchema.optional(),
      side: SideSchema,
      dollarSpend: z.string().optional(),
      size: StringAmountSchema,
      price: StringAmountSchema,
      executionMode: ExecutionModeSchema.optional(),
      presetId: z.string().optional(),
      orderType: z.enum(['GTC', 'FAK', 'FOK']).default('GTC'),
      slippageBps: z.number().optional(),
    }),
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('CANCEL_ORDER'),
    payload: z.object({
      orderId: z.string(),
    }),
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('CANCEL_ALL'),
    payload: z.object({
      conditionId: z.string().optional(),
    }).optional()
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('UPDATE_PRESETS'),
    payload: z.array(PresetConfigSchema),
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('UPDATE_SIZE_PRESETS'),
    payload: z.object({
      buySizesUsd: z.array(z.number()),
      sellPercentages: z.array(z.number()),
    })
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('UPDATE_SETTINGS'),
    payload: z.record(z.any()),
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('SETTINGS_UPDATED'),
    payload: z.record(z.any()),
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('RECONCILE'),
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('PING'),
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('PONG'),
    payload: z.object({ timestamp: z.number() }),
  }).merge(BaseMessageSchema),

  z.object({
    type: z.literal('ERROR'),
    payload: z.object({ message: z.string(), code: z.string().optional() }).optional(),
    error: z.string().optional(),
  }).merge(BaseMessageSchema),
]);
export type WsEvent = z.infer<typeof WsEventSchema>;

export const ClientCommandTypeSchema = z.enum([
  'HELLO',
  'AUTH',
  'SNAPSHOT_REQUEST',
  'ARM_LIVE',
  'DISARM_LIVE',
  'SELECT_MARKET',
  'SUBSCRIBE_MARKET',
  'PAGE_ANCHOR_UPDATE',
  'REQUEST_QUOTES',
  'PLACE_ORDER_INTENT',
  'PLACE_ORDER',
  'CANCEL_ORDER',
  'CANCEL_ALL',
  'UPDATE_PRESETS',
  'UPDATE_SIZE_PRESETS',
  'UPDATE_SETTINGS',
  'RECONCILE',
  'PING',
]);

export const ServerEventTypeSchema = z.enum([
  'HELLO_ACK',
  'AUTH_OK',
  'AUTH_ERROR',
  'TERMINAL_SNAPSHOT',
  'SNAPSHOT',
  'READINESS_UPDATED',
  'MARKET_UPDATE',
  'MARKET_UPDATED',
  'DISCOVERY_UPDATE',
  'REFERENCE_UPDATED',
  'RTDS_UPDATE',
  'RTDS_STATUS',
  'EXECUTABLE_QUOTES_UPDATED',
  'ACCOUNT_UPDATED',
  'ORDER_RESULT',
  'ORDER_UPDATE',
  'ORDER_UPDATED',
  'FILL_UPDATED',
  'POSITION_UPDATED',
  'SETTINGS_UPDATED',
  'PONG',
  'PROTOCOL_ERROR',
  'ERROR',
]);

export const ClientCommandEnvelopeSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  id: z.string(),
  type: ClientCommandTypeSchema,
  payload: z.unknown().optional(),
}).strict().superRefine((command, ctx) => {
  if (!WsEventSchema.safeParse(command).success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid ${command.type} command payload`, path: ['payload'] });
  }
});

export const ServerEventEnvelopeSchema = z.object({
  protocolVersion: ProtocolVersionSchema,
  id: z.string().optional(),
  type: ServerEventTypeSchema,
  payload: z.unknown().optional(),
}).strict();

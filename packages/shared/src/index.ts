import { z } from 'zod';

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
});
export type LiveReadiness = z.infer<typeof LiveReadinessSchema>;

export const MarketAnchorSchema = z.object({
  conditionId: z.string(),
  windowStart: z.number(),
  value: z.string(),
  sourceTimestamp: z.number(),
  validated: z.boolean(),
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
});
export type MarketState = z.infer<typeof MarketStateSchema>;

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
  presetId: z.string().optional(),
  filledShares: StringAmountSchema.default('0'),
  remainingShares: StringAmountSchema.optional(),
  averageFillPrice: StringAmountSchema.optional(),
  fees: StringAmountSchema.default('0'),
  status: z.string(), // OrderState
  state: OrderStateSchema.optional(),
  remoteState: z.string().optional(),
  timestamp: z.number(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
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
});
export type AccountState = z.infer<typeof AccountStateSchema>;

export const BaseMessageSchema = z.object({
  id: z.string().optional(),
});

export const WsEventSchema = z.discriminatedUnion('type', [
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
      balance: z.number().optional(),
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
      presetId: z.string().optional(),
      orderType: z.enum(['GTC']).default('GTC'),
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
    type: z.literal('ERROR'),
    payload: z.object({ message: z.string(), code: z.string().optional() }).optional(),
    error: z.string().optional(),
  }).merge(BaseMessageSchema),
]);
export type WsEvent = z.infer<typeof WsEventSchema>;

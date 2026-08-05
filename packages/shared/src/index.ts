import { z } from 'zod';

export const PresetModeSchema = z.enum(['PERCENT_OFFSET', 'CENT_OFFSET', 'ABSOLUTE_PRICE']);
export type PresetMode = z.infer<typeof PresetModeSchema>;

export const PresetReferenceSchema = z.enum(['BEST_BID', 'BEST_ASK', 'MIDPOINT', 'LAST_TRADE']);
export type PresetReference = z.infer<typeof PresetReferenceSchema>;

export const PresetConfigSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  side: z.enum(['BUY', 'SELL']),
  mode: PresetModeSchema,
  reference: PresetReferenceSchema.optional(),
  value: z.number(),
  active: z.boolean().default(true),
});
export type PresetConfig = z.infer<typeof PresetConfigSchema>;

// Use strings for financial calculations to avoid floating point inaccuracies
export const StringAmountSchema = z.string().regex(/^\d+(\.\d+)?$/, "Must be a valid decimal string");

export const SideSchema = z.enum(['BUY', 'SELL']);
export type Side = z.infer<typeof SideSchema>;

export const OrderStatusSchema = z.enum(['PENDING', 'FILLED', 'REJECTED', 'CANCELLED']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  tokenId: z.string(),
  side: SideSchema,
  size: StringAmountSchema,
  price: StringAmountSchema,
  status: OrderStatusSchema,
  timestamp: z.number(),
});
export type Order = z.infer<typeof OrderSchema>;

export const MarketStateSchema = z.object({
  marketId: z.string(),
  conditionId: z.string(),
  yesTokenId: z.string(),
  noTokenId: z.string(),
  yesPrice: StringAmountSchema,
  noPrice: StringAmountSchema,
  yesBid: StringAmountSchema.optional(),
  yesAsk: StringAmountSchema.optional(),
  noBid: StringAmountSchema.optional(),
  noAsk: StringAmountSchema.optional(),
  status: z.enum(['OPEN', 'RESOLVING', 'RESOLVED', 'CLOSED']),
  lastUpdated: z.number(),
  targetTime: z.number().optional(),
  type: z.enum(['PREVIOUS', 'CURRENT', 'NEXT']).optional(),
  title: z.string().optional(),
});
export type MarketState = z.infer<typeof MarketStateSchema>;

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
      orders: z.array(OrderSchema),
      positions: z.array(z.any()), // Can be refined later
      balance: z.number().optional(),
      realizedPnl: z.number().optional(),
      settings: z.object({
        maxLoss: z.string().optional(),
        maxProfit: z.string().optional(),
      }).optional(),
    })
  }).merge(BaseMessageSchema),
  z.object({
    type: z.literal('SUBSCRIBE_MARKET'),
    payload: z.object({
      conditionId: z.string(),
      yesTokenId: z.string(),
      noTokenId: z.string(),
    }),
  }).merge(BaseMessageSchema),
  z.object({
    type: z.literal('MARKET_UPDATE'),
    payload: MarketStateSchema,
  }).merge(BaseMessageSchema),
  z.object({
    type: z.literal('DISCOVERY_UPDATE'),
    payload: z.array(MarketStateSchema),
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
    type: z.literal('ORDER_UPDATE'),
    payload: OrderSchema,
  }).merge(BaseMessageSchema),
  z.object({
    type: z.literal('PLACE_ORDER'),
    payload: z.object({
      tokenId: z.string(),
      side: SideSchema,
      size: StringAmountSchema,
      price: StringAmountSchema,
      orderType: z.enum(['GTC', 'FAK', 'FOK']).optional(),
    }),
  }).merge(BaseMessageSchema),
  z.object({
    type: z.literal('CANCEL_ORDER'),
    payload: z.object({
      orderId: z.string(),
    }),
  }).merge(BaseMessageSchema),
  z.object({
    type: z.literal('UPDATE_SETTINGS'),
    payload: z.object({
      maxLoss: z.string().optional(),
      maxProfit: z.string().optional(),
    })
  }).merge(BaseMessageSchema),
  z.object({
    type: z.literal('PING'),
  }).merge(BaseMessageSchema),
  z.object({
    type: z.literal('ERROR'),
    payload: z.object({ message: z.string() }).optional(), // added payload as object for ERROR to match structure, or just error string.
  }).merge(BaseMessageSchema).extend({ error: z.string().optional() }), // keep legacy error field support for now if needed.
]);
export type WsEvent = z.infer<typeof WsEventSchema>;

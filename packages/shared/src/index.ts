import { z } from 'zod';

// Use strings for financial calculations to avoid floating point inaccuracies
export const StringAmountSchema = z.string().regex(/^\d+(\.\d+)?$/, "Must be a valid decimal string");

export const SideSchema = z.enum(['BUY', 'SELL']);
export type Side = z.infer<typeof SideSchema>;

export const OrderStatusSchema = z.enum(['PENDING', 'FILLED', 'REJECTED', 'CANCELLED']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  side: SideSchema,
  size: StringAmountSchema,
  price: StringAmountSchema,
  status: OrderStatusSchema,
  timestamp: z.number(),
});
export type Order = z.infer<typeof OrderSchema>;

export const MarketStateSchema = z.object({
  marketId: z.string(),
  yesPrice: StringAmountSchema,
  noPrice: StringAmountSchema,
  status: z.enum(['OPEN', 'RESOLVING', 'RESOLVED']),
  lastUpdated: z.number(),
});
export type MarketState = z.infer<typeof MarketStateSchema>;

// WebSocket Events
export const WsEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('MARKET_UPDATE'),
    payload: MarketStateSchema,
  }),
  z.object({
    type: z.literal('ORDER_UPDATE'),
    payload: OrderSchema,
  }),
  z.object({
    type: z.literal('PLACE_ORDER'),
    payload: z.object({
      marketId: z.string(),
      side: SideSchema,
      size: StringAmountSchema,
      price: StringAmountSchema,
    }),
  }),
  z.object({
    type: z.literal('ERROR'),
    error: z.string(),
  }),
]);
export type WsEvent = z.infer<typeof WsEventSchema>;

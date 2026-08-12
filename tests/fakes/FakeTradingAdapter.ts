import { Order, Side, OrderStatus } from '@polymarket-btc/shared';

export class FakeTradingAdapter {
  private isConnected: boolean = false;
  private mockBalance: number = 1000.0;
  private orders: Map<string, Order> = new Map();

  async initialize(): Promise<void> {
    this.isConnected = true;
  }

  async shutdown(): Promise<void> {
    this.isConnected = false;
  }

  async placeOrder(tokenId: string, side: Side, size: string, price: string): Promise<Order> {
    const id = `fake_order_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const order: Order = {
      id,
      tokenId,
      side,
      size,
      price,
      status: 'PENDING',
      timestamp: Date.now(),
    };
    this.orders.set(id, order);
    return order;
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    if (this.orders.has(orderId)) {
      const existing = this.orders.get(orderId)!;
      this.orders.set(orderId, { ...existing, status: 'CANCELLED' });
      return true;
    }
    return false;
  }

  async getBalance(): Promise<number> {
    return this.mockBalance;
  }
}

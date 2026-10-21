// Simulated broker: cash, positions, fills with slippage and fees.

import { Asset, roundLot, rulesFor } from './assets';
import { Fill, Side } from './types';

export interface Position {
  quantity: number;
  avgCost: number;
}

export interface PortfolioState {
  cash: number;
  positions: Record<string, Position>;
  fills: Fill[];
  feesPaid: number;
}

const MAX_FILLS = 500;

export class Portfolio {
  cash: number;
  positions: Record<string, Position> = {};
  fills: Fill[] = [];
  feesPaid = 0;

  constructor(cash: number, readonly assets: Record<string, Asset>) {
    this.cash = cash;
  }

  marketValue(symbol: string, prices: Record<string, number>): number {
    const pos = this.positions[symbol];
    return pos ? pos.quantity * prices[symbol] : 0;
  }

  equity(prices: Record<string, number>): number {
    let total = this.cash;
    for (const symbol of Object.keys(this.positions)) total += this.marketValue(symbol, prices);
    return total;
  }

  fillPrice(symbol: string, side: Side, mid: number): number {
    const slip = rulesFor(this.assets[symbol]).slippageBps / 10_000;
    return side === 'buy' ? mid * (1 + slip) : mid * (1 - slip);
  }

  /** Fill an order at mid +/- slippage. Long-only: sells are capped at the
   * position held and buys at the cash available. */
  execute(tick: number, time: number, symbol: string, side: Side, quantity: number,
          mid: number, reason: string): Fill | null {
    const rules = rulesFor(this.assets[symbol]);
    let qty = roundLot(quantity, rules.lotSize);
    const price = this.fillPrice(symbol, side, mid);
    const feeRate = rules.feeBps / 10_000;
    const pos = this.positions[symbol] ?? { quantity: 0, avgCost: 0 };

    if (side === 'buy') {
      qty = Math.min(qty, roundLot(this.cash / (price * (1 + feeRate)), rules.lotSize));
    } else {
      qty = Math.min(qty, pos.quantity);
    }
    if (!(qty > 0)) return null;

    const notional = qty * price;
    const fee = notional * feeRate;
    if (side === 'buy') {
      const newQty = pos.quantity + qty;
      pos.avgCost = (pos.avgCost * pos.quantity + notional) / newQty;
      pos.quantity = Number(newQty.toFixed(10));
      this.positions[symbol] = pos;
      this.cash -= notional + fee;
    } else {
      pos.quantity = Number((pos.quantity - qty).toFixed(10));
      this.cash += notional - fee;
      if (pos.quantity <= 0) delete this.positions[symbol];
    }
    this.feesPaid += fee;
    const fill: Fill = { tick, time, symbol, side, quantity: qty, price, fee, reason };
    this.fills.push(fill);
    if (this.fills.length > MAX_FILLS) this.fills.splice(0, this.fills.length - MAX_FILLS);
    return fill;
  }

  toState(): PortfolioState {
    return { cash: this.cash, positions: this.positions, fills: this.fills, feesPaid: this.feesPaid };
  }

  loadState(state: PortfolioState): void {
    this.cash = state.cash;
    this.positions = state.positions;
    this.fills = state.fills;
    this.feesPaid = state.feesPaid;
  }
}

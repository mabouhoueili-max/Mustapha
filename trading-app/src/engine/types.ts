// Messages the three agents pass to each other.

export type Side = 'buy' | 'sell';
export type PriceSource = 'live' | 'sim' | 'stale';

/** Published by the market data agent once per tick. */
export interface MarketSnapshot {
  tick: number;
  timestamp: number; // ms since epoch (live) or simulated ms since start (sim)
  prices: Record<string, number>;
  source: Record<string, PriceSource>;
}

/** Sent to the risk manager by the trader agent, or by you from the Trade sheet. */
export interface OrderProposal {
  symbol: string;
  side: Side;
  quantity: number;
  reason: string;
}

export interface RiskDecision {
  proposal: OrderProposal;
  approved: boolean;
  quantity: number;
  notes: string[];
}

export interface Fill {
  tick: number;
  time: number;
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
  fee: number;
  reason: string;
}

export type AgentName = 'market' | 'trader' | 'risk' | 'you';

export interface LogEntry {
  tick: number;
  time: number;
  agent: AgentName;
  text: string;
}

export function isFresh(source: PriceSource | undefined): boolean {
  return source === 'live' || source === 'sim';
}

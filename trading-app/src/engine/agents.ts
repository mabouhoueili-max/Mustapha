// The three agents.
//
// MarketDataAgent  -- watches the market and publishes one price snapshot per tick.
// TraderAgent      -- reads snapshots and proposes orders (moving-average trend strategy).
// RiskManagerAgent -- approves, resizes or rejects every proposal (the trader's and yours),
//                     and forces exits (stop-loss, drawdown kill switch) on its own.

import { Asset, AssetClass, roundLot, rulesFor } from './assets';
import { LiveFeed } from './feeds';
import { Portfolio } from './portfolio';
import { AgentName, isFresh, MarketSnapshot, OrderProposal, PriceSource, RiskDecision } from './types';

export type Logger = (agent: AgentName, tick: number, text: string) => void;

const YEAR_MS = 365 * 24 * 3600 * 1000;

/** Small seeded PRNG (mulberry32) so simulated runs are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MarketState {
  prices: Record<string, number>;
  tick: number;
  clock: number;
  seed: number;
}

export class MarketDataAgent {
  static role = 'Publishes prices for every asset: live quotes in Live mode, simulated in Sim mode.';
  prices: Record<string, number>;
  tick = 0;
  clock = 0;
  private rand: () => number;
  private seed: number;

  constructor(readonly assets: Asset[], private log: Logger,
              readonly live: LiveFeed | null, private msPerTick = 3600_000, seed = Date.now()) {
    this.seed = seed;
    this.rand = makeRng(seed);
    // Live mode starts with no prices: nothing is tradable until a real quote arrives.
    this.prices = live ? {} : Object.fromEntries(assets.map((a) => [a.symbol, a.startPrice]));
  }

  private gauss(): number {
    const u = Math.max(this.rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand());
  }

  private simulate(asset: Asset): number {
    // One geometric-Brownian-motion step with a little drift.
    const dt = this.msPerTick / YEAR_MS;
    const vol = rulesFor(asset).annualVol;
    const step = (0.05 - 0.5 * vol * vol) * dt + vol * Math.sqrt(dt) * this.gauss();
    return this.prices[asset.symbol] * Math.exp(step);
  }

  async publish(): Promise<MarketSnapshot> {
    this.tick += 1;
    const source: Record<string, PriceSource> = {};
    if (!this.live) {
      this.clock += this.msPerTick;
      for (const a of this.assets) {
        this.prices[a.symbol] = this.simulate(a);
        source[a.symbol] = 'sim';
      }
      return { tick: this.tick, timestamp: this.clock, prices: { ...this.prices }, source };
    }

    // Live: real quotes only. A failed quote keeps the last real price, marked stale.
    this.clock = Date.now();
    const quotes = await this.live.quotes(this.assets);
    for (const a of this.assets) {
      if (a.symbol in quotes) {
        this.prices[a.symbol] = quotes[a.symbol];
        source[a.symbol] = 'live';
      } else if (a.symbol in this.prices) {
        source[a.symbol] = 'stale';
      }
    }
    const errors = Object.entries(this.live.lastErrors);
    if (errors.length) {
      this.log('market', this.tick, `no live quote for ${errors.map(([s, e]) => `${s} (${e})`).join('; ')}`);
    }
    return { tick: this.tick, timestamp: this.clock, prices: { ...this.prices }, source };
  }

  /** Recent real 1-minute closes per symbol, so the trader can start at once. */
  async warmupHistory(bars: number): Promise<Record<string, number[]>> {
    if (!this.live) return {};
    const out: Record<string, number[]> = {};
    const all = await Promise.all(this.assets.map((a) => this.live!.history(a, bars)));
    this.assets.forEach((a, i) => {
      if (all[i].length) out[a.symbol] = all[i];
    });
    this.log('market', 0, `warm-up history loaded for ${Object.keys(out).length}/${this.assets.length} symbols`);
    return out;
  }

  toState(): MarketState {
    return { prices: this.prices, tick: this.tick, clock: this.clock, seed: this.seed + this.tick };
  }

  loadState(s: MarketState): void {
    this.prices = s.prices;
    this.tick = s.tick;
    this.clock = s.clock;
    this.rand = makeRng(s.seed);
  }
}

export class TraderAgent {
  static role = 'Proposes trades: buys when the fast moving average crosses above the slow one and sells on the reverse. Manages only positions it opened.';
  history: Record<string, number[]> = {};
  enabled = true;
  managed = new Set<string>(); // positions the trader opened; ones you trade by hand are yours

  constructor(readonly assets: Asset[], private log: Logger, readonly fast = 10, readonly slow = 30,
              readonly targetWeight = 0.1, readonly band = 0.002) {
    if (fast >= slow) throw new Error('fast window must be shorter than slow window');
    for (const a of assets) this.history[a.symbol] = [];
  }

  private push(symbol: string, price: number): void {
    const h = this.history[symbol];
    h.push(price);
    if (h.length > this.slow) h.splice(0, h.length - this.slow);
  }

  seedHistory(history: Record<string, number[]>): void {
    for (const [sym, closes] of Object.entries(history)) {
      if (sym in this.history) closes.forEach((p) => this.push(sym, p));
    }
  }

  averages(symbol: string): [number, number] | null {
    const h = this.history[symbol];
    if (h.length < this.slow) return null;
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    return [mean(h.slice(-this.fast)), mean(h)];
  }

  propose(snap: MarketSnapshot, portfolio: Portfolio): OrderProposal[] {
    for (const [sym, price] of Object.entries(snap.prices)) {
      if (isFresh(snap.source[sym]) && sym in this.history) this.push(sym, price);
    }
    if (!this.enabled) return [];
    const equity = portfolio.equity(snap.prices);
    const orders: OrderProposal[] = [];
    for (const a of this.assets) {
      if (!isFresh(snap.source[a.symbol])) continue; // no fresh price this tick: don't act on it
      const avgs = this.averages(a.symbol);
      if (!avgs) continue;
      const [fast, slow] = avgs;
      const held = portfolio.positions[a.symbol];
      const price = snap.prices[a.symbol];
      if (fast > slow * (1 + this.band) && !held) {
        const qty = roundLot((equity * this.targetWeight) / price, rulesFor(a).lotSize);
        if (qty > 0) {
          orders.push({ symbol: a.symbol, side: 'buy', quantity: qty,
            reason: `uptrend: MA${this.fast} ${fast.toFixed(2)} > MA${this.slow} ${slow.toFixed(2)}` });
        }
      } else if (fast < slow * (1 - this.band) && held && this.managed.has(a.symbol)) {
        orders.push({ symbol: a.symbol, side: 'sell', quantity: held.quantity,
          reason: `downtrend: MA${this.fast} ${fast.toFixed(2)} < MA${this.slow} ${slow.toFixed(2)}` });
      }
    }
    for (const o of orders) this.log('trader', snap.tick, `propose ${o.side} ${fmtQty(o.quantity)} ${o.symbol} (${o.reason})`);
    return orders;
  }
}

export const DEFAULT_CLASS_LIMITS: Record<AssetClass, number> = {
  stock: 0.5,
  etf: 0.5,
  commodity: 0.3,
  crypto: 0.25,
};

export interface RiskLimits {
  maxPosition: number;
  classLimits: Record<AssetClass, number>;
  minCash: number;
  stopLoss: number;
  maxDrawdown: number;
  cooldownTicks: number;
}

export const DEFAULT_RISK: RiskLimits = {
  maxPosition: 0.2,
  classLimits: DEFAULT_CLASS_LIMITS,
  minCash: 0.05,
  stopLoss: 0.08,
  maxDrawdown: 0.2,
  cooldownTicks: 20,
};

export interface RiskState {
  peakEquity: number;
  halted: boolean;
  cooldownUntil: Record<string, number>;
}

export class RiskManagerAgent {
  static role = 'Enforces position, asset-class and cash limits, stop-losses, and a drawdown kill switch.';
  peakEquity = 0;
  halted = false;
  cooldownUntil: Record<string, number> = {}; // symbol -> tick when buys resume
  private assets: Record<string, Asset>;

  constructor(assets: Asset[], private log: Logger, readonly limits: RiskLimits = DEFAULT_RISK) {
    this.assets = Object.fromEntries(assets.map((a) => [a.symbol, a]));
  }

  drawdown(equity: number): number {
    return this.peakEquity ? 1 - equity / this.peakEquity : 0;
  }

  private classValue(cls: AssetClass, pf: Portfolio, prices: Record<string, number>): number {
    let v = 0;
    for (const sym of Object.keys(pf.positions)) {
      if (this.assets[sym].assetClass === cls) v += pf.marketValue(sym, prices);
    }
    return v;
  }

  /** Orders the risk manager raises on its own, before the trader is heard. */
  forcedExits(snap: MarketSnapshot, pf: Portfolio): OrderProposal[] {
    const equity = pf.equity(snap.prices);
    this.peakEquity = Math.max(this.peakEquity, equity);
    const dd = this.drawdown(equity);
    const exits: OrderProposal[] = [];
    if (!this.halted && dd >= this.limits.maxDrawdown) {
      this.halted = true;
      this.log('risk', snap.tick, `KILL SWITCH: drawdown ${pct(dd)} >= ${pct(this.limits.maxDrawdown, 0)}; liquidating and halting new buys`);
      for (const [sym, pos] of Object.entries(pf.positions)) {
        exits.push({ symbol: sym, side: 'sell', quantity: pos.quantity, reason: 'risk: drawdown kill switch' });
      }
      return exits;
    }
    for (const [sym, pos] of Object.entries(pf.positions)) {
      if (!isFresh(snap.source[sym])) continue; // don't stop out on a stale price
      const loss = 1 - snap.prices[sym] / pos.avgCost;
      if (loss >= this.limits.stopLoss) {
        this.log('risk', snap.tick, `stop-loss on ${sym}: down ${pct(loss)} from cost ${pos.avgCost.toFixed(2)}; no buys for ${this.limits.cooldownTicks} ticks`);
        this.cooldownUntil[sym] = snap.tick + this.limits.cooldownTicks;
        exits.push({ symbol: sym, side: 'sell', quantity: pos.quantity, reason: `risk: stop-loss ${pct(loss)}` });
      }
    }
    return exits;
  }

  review(proposal: OrderProposal, snap: MarketSnapshot, pf: Portfolio, who: AgentName = 'trader'): RiskDecision {
    const decision: RiskDecision = { proposal, approved: true, quantity: proposal.quantity, notes: [] };
    if (proposal.side === 'sell') return decision; // reducing risk is always allowed

    if (this.halted) return this.reject(decision, snap, 'trading halted by kill switch', who);
    if (!isFresh(snap.source[proposal.symbol])) return this.reject(decision, snap, 'no fresh price', who);
    if (snap.tick < (this.cooldownUntil[proposal.symbol] ?? 0)) {
      return this.reject(decision, snap, 'cooling down after stop-loss', who);
    }

    const asset = this.assets[proposal.symbol];
    const price = snap.prices[proposal.symbol];
    const equity = pf.equity(snap.prices);
    const cls = asset.assetClass;
    const headroom: [string, number][] = [
      [`position cap ${pct(this.limits.maxPosition, 0)}`,
        equity * this.limits.maxPosition - pf.marketValue(proposal.symbol, snap.prices)],
      [`${cls} cap ${pct(this.limits.classLimits[cls], 0)}`,
        equity * this.limits.classLimits[cls] - this.classValue(cls, pf, snap.prices)],
      [`cash buffer ${pct(this.limits.minCash, 0)}`, pf.cash - equity * this.limits.minCash],
    ];
    let qty = proposal.quantity;
    for (const [limit, room] of headroom) {
      const allowed = roundLot(Math.max(room, 0) / price, rulesFor(asset).lotSize);
      if (allowed < qty) {
        qty = allowed;
        decision.notes.push(`resized by ${limit}`);
      }
    }
    if (!(qty > 0)) return this.reject(decision, snap, decision.notes.join('; ') || 'no room', who);
    decision.quantity = qty;
    if (decision.notes.length) {
      this.log('risk', snap.tick, `resize ${who === 'you' ? 'your ' : ''}buy ${proposal.symbol} ${fmtQty(proposal.quantity)} -> ${fmtQty(qty)} (${decision.notes.join('; ')})`);
    }
    return decision;
  }

  private reject(d: RiskDecision, snap: MarketSnapshot, why: string, who: AgentName): RiskDecision {
    d.approved = false;
    d.quantity = 0;
    d.notes.push(why);
    this.log('risk', snap.tick, `reject ${who === 'you' ? 'your ' : ''}${d.proposal.side} ${d.proposal.symbol}: ${why}`);
    return d;
  }

  toState(): RiskState {
    return { peakEquity: this.peakEquity, halted: this.halted, cooldownUntil: this.cooldownUntil };
  }

  loadState(s: RiskState): void {
    this.peakEquity = s.peakEquity;
    this.halted = s.halted;
    this.cooldownUntil = s.cooldownUntil;
  }
}

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits)}%`;
}

export function fmtQty(q: number): string {
  return Number(q.toFixed(4)).toString();
}

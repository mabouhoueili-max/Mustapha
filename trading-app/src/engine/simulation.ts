// Runs the three agents tick by tick against a simulated broker.

import { Asset, ASSET_CLASSES, AssetClass, DEFAULT_UNIVERSE } from './assets';
import { DEFAULT_RISK, fmtQty, Logger, MarketDataAgent, MarketState, RiskLimits, RiskManagerAgent, RiskState, TraderAgent } from './agents';
import { FetchText, LiveFeed } from './feeds';
import { Portfolio, PortfolioState } from './portfolio';
import { Fill, LogEntry, MarketSnapshot, Side } from './types';

export type FeedMode = 'live' | 'sim';

export interface Settings {
  mode: FeedMode;
  symbols: string[];
  cash: number;
  intervalSec: number; // seconds between ticks
  autoTrade: boolean; // trader agent on/off; you can always trade by hand
  fast: number;
  slow: number;
  targetWeight: number;
  risk: RiskLimits;
}

export const DEFAULT_SETTINGS: Settings = {
  mode: 'live',
  symbols: DEFAULT_UNIVERSE.map((a) => a.symbol),
  cash: 100_000,
  intervalSec: 30,
  autoTrade: true,
  fast: 10,
  slow: 30,
  targetWeight: 0.1,
  risk: DEFAULT_RISK,
};

export interface EquityPoint {
  t: number;
  equity: number;
}

export interface SimState {
  version: 1;
  settings: Settings;
  portfolio: PortfolioState;
  market: MarketState;
  risk: RiskState;
  traderHistory: Record<string, number[]>;
  traderManaged?: string[];
  log: LogEntry[];
  equityCurve: EquityPoint[];
  startingEquity: number;
  openPrices: Record<string, number>;
  last: MarketSnapshot | null;
  warmedUp: boolean;
}

export interface TickResult {
  snapshot: MarketSnapshot;
  fills: Fill[];
  rejected: number;
}

const MAX_LOG = 300;
const MAX_CURVE = 600;

export class Simulation {
  readonly assets: Asset[];
  readonly market: MarketDataAgent;
  readonly trader: TraderAgent;
  readonly risk: RiskManagerAgent;
  readonly portfolio: Portfolio;
  log: LogEntry[] = [];
  equityCurve: EquityPoint[] = [];
  startingEquity: number;
  openPrices: Record<string, number> = {}; // first price seen this session, for change %
  last: MarketSnapshot | null = null;
  warmedUp = false;

  constructor(readonly settings: Settings, fetchText?: FetchText, seed?: number) {
    this.assets = DEFAULT_UNIVERSE.filter((a) => settings.symbols.includes(a.symbol));
    const logger: Logger = (agent, tick, text) => this.addLog(agent, tick, text);
    const live = settings.mode === 'live' ? new LiveFeed(fetchText) : null;
    this.market = new MarketDataAgent(this.assets, logger, live, 3600_000, seed);
    this.trader = new TraderAgent(this.assets, logger, settings.fast, settings.slow, settings.targetWeight);
    this.trader.enabled = settings.autoTrade;
    this.risk = new RiskManagerAgent(this.assets, logger, settings.risk);
    this.portfolio = new Portfolio(settings.cash, Object.fromEntries(this.assets.map((a) => [a.symbol, a])));
    this.startingEquity = settings.cash;
  }

  addLog(agent: LogEntry['agent'], tick: number, text: string): void {
    this.log.push({ agent, tick, text, time: Date.now() });
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG);
  }

  private now(snap: MarketSnapshot): number {
    return this.settings.mode === 'live' ? snap.timestamp : Date.now();
  }

  /** Live mode: preload the trader with recent real bars instead of waiting. */
  async warmUp(): Promise<void> {
    if (this.warmedUp) return;
    this.warmedUp = true;
    this.trader.seedHistory(await this.market.warmupHistory(this.trader.slow));
  }

  async step(): Promise<TickResult> {
    const snap = await this.market.publish();
    this.last = snap;
    for (const [sym, price] of Object.entries(snap.prices)) {
      if (!(sym in this.openPrices)) this.openPrices[sym] = price;
    }
    const result: TickResult = { snapshot: snap, fills: [], rejected: 0 };
    const pf = this.portfolio;
    const time = this.now(snap);

    // 1. Risk manager acts first on stop-losses and the kill switch.
    const exited = new Set<string>();
    for (const o of this.risk.forcedExits(snap, pf)) {
      const fill = pf.execute(snap.tick, time, o.symbol, o.side, o.quantity, snap.prices[o.symbol], o.reason);
      if (fill) {
        result.fills.push(fill);
        exited.add(o.symbol);
      }
    }

    // 2. Trader proposes; 3. risk manager rules on each; 4. broker fills.
    for (const p of this.trader.propose(snap, pf)) {
      if (exited.has(p.symbol)) continue;
      const d = this.risk.review(p, snap, pf);
      if (!d.approved) {
        result.rejected += 1;
        continue;
      }
      const fill = pf.execute(snap.tick, time, p.symbol, p.side, d.quantity, snap.prices[p.symbol], p.reason);
      if (fill) {
        result.fills.push(fill);
        if (fill.side === 'buy') this.trader.managed.add(fill.symbol);
      }
    }
    for (const sym of [...this.trader.managed]) {
      if (!pf.positions[sym]) this.trader.managed.delete(sym);
    }

    this.recordEquity(time);
    return result;
  }

  private recordEquity(t: number): void {
    if (!this.last) return;
    this.equityCurve.push({ t, equity: this.portfolio.equity(this.last.prices) });
    if (this.equityCurve.length > MAX_CURVE) {
      // keep the shape of a long run: halve the resolution of the older half
      const half = Math.floor(this.equityCurve.length / 2);
      const thinned = this.equityCurve.slice(0, half).filter((_, i) => i % 2 === 0);
      this.equityCurve = thinned.concat(this.equityCurve.slice(half));
    }
  }

  /** An order you place by hand. It goes through the risk manager like any other. */
  manualOrder(symbol: string, side: Side, quantity: number): { ok: boolean; message: string; fill?: Fill } {
    const snap = this.last;
    if (!snap || !(symbol in snap.prices)) return { ok: false, message: `No price for ${symbol} yet.` };
    if (!(quantity > 0)) return { ok: false, message: 'Enter a quantity above zero.' };
    if (side === 'sell' && !this.portfolio.positions[symbol]) return { ok: false, message: `You don't hold ${symbol}.` };
    const proposal = { symbol, side, quantity, reason: 'manual order' };
    this.addLog('you', snap.tick, `${side} ${fmtQty(quantity)} ${symbol}`);
    if (this.trader.managed.delete(symbol)) {
      this.addLog('trader', snap.tick, `leaving ${symbol} to you from now on`);
    }
    const d = this.risk.review(proposal, snap, this.portfolio, 'you');
    if (!d.approved) return { ok: false, message: `Risk manager rejected it: ${d.notes.join('; ')}` };
    const fill = this.portfolio.execute(snap.tick, this.now(snap), symbol, side, d.quantity, snap.prices[symbol], 'manual order');
    if (!fill) return { ok: false, message: side === 'buy' ? 'Not enough cash for one lot.' : 'Nothing to sell.' };
    this.recordEquity(this.now(snap));
    const resized = d.notes.length ? ` (risk manager ${d.notes.join('; ')})` : '';
    return { ok: true, fill, message: `Filled ${side} ${fmtQty(fill.quantity)} ${symbol} @ ${fill.price.toFixed(2)}${resized}` };
  }

  // ---- read-outs -----------------------------------------------------

  equity(): number {
    return this.last ? this.portfolio.equity(this.last.prices) : this.portfolio.cash;
  }

  maxDrawdown(): number {
    let peak = this.startingEquity;
    let worst = 0;
    for (const p of this.equityCurve) {
      peak = Math.max(peak, p.equity);
      worst = Math.max(worst, 1 - p.equity / peak);
    }
    return worst;
  }

  exposureByClass(): Record<AssetClass, number> {
    const out = Object.fromEntries(ASSET_CLASSES.map((c) => [c, 0])) as Record<AssetClass, number>;
    if (!this.last) return out;
    for (const sym of Object.keys(this.portfolio.positions)) {
      out[this.portfolio.assets[sym].assetClass] += this.portfolio.marketValue(sym, this.last.prices);
    }
    return out;
  }

  // ---- persistence ---------------------------------------------------

  toState(): SimState {
    return {
      version: 1,
      settings: this.settings,
      portfolio: this.portfolio.toState(),
      market: this.market.toState(),
      risk: this.risk.toState(),
      traderHistory: this.trader.history,
      traderManaged: [...this.trader.managed],
      log: this.log,
      equityCurve: this.equityCurve,
      startingEquity: this.startingEquity,
      openPrices: this.openPrices,
      last: this.last,
      warmedUp: this.warmedUp,
    };
  }

  static fromState(s: SimState, fetchText?: FetchText): Simulation {
    const sim = new Simulation(s.settings, fetchText);
    sim.portfolio.loadState(s.portfolio);
    sim.market.loadState(s.market);
    sim.risk.loadState(s.risk);
    sim.trader.seedHistory(s.traderHistory);
    sim.trader.managed = new Set(s.traderManaged ?? Object.keys(s.portfolio.positions));
    sim.log = s.log;
    sim.equityCurve = s.equityCurve;
    sim.startingEquity = s.startingEquity;
    sim.openPrices = s.openPrices;
    sim.last = s.last;
    sim.warmedUp = s.warmedUp;
    return sim;
  }
}

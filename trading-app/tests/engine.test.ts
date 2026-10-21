/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RiskManagerAgent, TraderAgent } from '../src/engine/agents';
import { DEFAULT_UNIVERSE, roundLot } from '../src/engine/assets';
import { LiveFeed, parseChart, parseChartCloses, parseCoinbase, YAHOO_HOSTS } from '../src/engine/feeds';
import { Portfolio } from '../src/engine/portfolio';
import { DEFAULT_SETTINGS, Settings, Simulation } from '../src/engine/simulation';
import { LogEntry, MarketSnapshot, PriceSource } from '../src/engine/types';

const ASSETS = Object.fromEntries(DEFAULT_UNIVERSE.map((a) => [a.symbol, a]));
const noLog = () => {};

function snap(prices: Record<string, number>, tick = 1, source: PriceSource = 'sim'): MarketSnapshot {
  return { tick, timestamp: 0, prices, source: Object.fromEntries(Object.keys(prices).map((s) => [s, source])) };
}

const pf = (cash = 100_000) => new Portfolio(cash, ASSETS);

/** Stands in for the internet: answers Coinbase and Yahoo URLs. */
class FakeNet {
  fail = new Set<string>();
  down = new Set<string>();
  price = 100;
  calls: string[] = [];
  constructor(public closes: number[] = []) {}
  fetch = async (url: string) => {
    this.calls.push(url);
    const host = new URL(url).host;
    if (this.down.has(host) || [...this.fail].some((s) => url.includes(`/${encodeURIComponent(ASSETS[s].liveSymbol)}`))) {
      throw new Error('connection refused');
    }
    if (host === 'api.coinbase.com') return JSON.stringify({ data: { amount: '61234.5' } });
    return JSON.stringify({ chart: { result: [{
      meta: { regularMarketPrice: this.price },
      indicators: { quote: [{ close: [...this.closes, null] }] },
    }] } });
  };
}

const settings = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

test('roundLot', () => {
  assert.equal(roundLot(10.9, 1), 10);
  assert.equal(roundLot(0.123456, 0.0001), 0.1234);
  assert.equal(roundLot(-1, 1), 0);
});

test('portfolio applies slippage and fees, caps buys by cash and sells by holdings', () => {
  const p = pf(1_000);
  const buy = p.execute(1, 0, 'AAPL', 'buy', 100, 230, 't')!;
  assert.equal(buy.quantity, 4);
  assert.ok(Math.abs(buy.price - 230 * 1.0002) < 1e-9);
  const sell = p.execute(2, 0, 'AAPL', 'sell', 100, 230, 't')!;
  assert.equal(sell.quantity, 4);
  assert.ok(p.cash < 1_000);
  assert.equal(p.execute(3, 0, 'AAPL', 'sell', 1, 230, 't'), null);
  assert.equal(pf().execute(1, 0, 'BTC', 'buy', 0.123456, 60_000, 't')!.quantity, 0.1234);
});

test('parsers reject garbage', () => {
  assert.equal(parseChart('{}'), null);
  assert.equal(parseChart('not json'), null);
  assert.equal(parseCoinbase('{"data":{"amount":"-1"}}'), null);
  assert.deepEqual(parseChartCloses('{}'), []);
});

test('live feed: Coinbase for crypto, Yahoo for the rest, with fallbacks', async () => {
  const net = new FakeNet();
  net.down = new Set(['api.coinbase.com', YAHOO_HOSTS[0]]);
  const feed = new LiveFeed(net.fetch);
  assert.deepEqual(await feed.quotes([ASSETS.ETH, ASSETS.GOLD]), { ETH: 100, GOLD: 100 });
  net.down.clear();
  net.fail.add('SPY');
  assert.deepEqual(await feed.quotes([ASSETS.BTC, ASSETS.SPY]), { BTC: 61234.5 });
  assert.match(feed.lastErrors.SPY, /connection refused/);
});

test('live mode never simulates: unquoted symbols have no price, failed ones go stale', async () => {
  const net = new FakeNet();
  net.fail.add('AAPL');
  const sim = new Simulation(settings({ symbols: ['AAPL', 'SPY', 'BTC'] }), net.fetch);
  let r = await sim.step();
  assert.equal(r.snapshot.prices.BTC, 61234.5);
  assert.equal(r.snapshot.prices.SPY, 100);
  assert.ok(!('AAPL' in r.snapshot.prices));
  assert.ok(sim.log.some((l: LogEntry) => l.agent === 'market' && l.text.includes('AAPL')));
  net.fail = new Set(['SPY']);
  r = await sim.step();
  assert.equal(r.snapshot.source.SPY, 'stale');
  assert.equal(r.snapshot.source.AAPL, 'live');
});

test('warm-up lets the trader act on the first live tick', async () => {
  const net = new FakeNet(Array.from({ length: 40 }, (_, i) => 100 + i * 0.5));
  const sim = new Simulation(settings({ symbols: ['SPY'] }), net.fetch);
  await sim.warmUp();
  assert.equal(sim.trader.history.SPY.length, 30);
  net.price = 125;
  const r = await sim.step();
  assert.deepEqual(r.fills.map((f) => f.side), ['buy']);
});

test('trader buys an uptrend and sells a downtrend; can be switched off', () => {
  const trader = new TraderAgent([ASSETS.SPY], noLog, 2, 4, 0.1, 0);
  const p = pf();
  let orders = [] as ReturnType<TraderAgent['propose']>;
  [100, 100, 101, 102].forEach((price, i) => (orders = trader.propose(snap({ SPY: price }, i + 1), p)));
  assert.deepEqual(orders.map((o) => o.side), ['buy']);
  p.execute(4, 0, 'SPY', 'buy', orders[0].quantity, 102, 't');
  trader.managed.add('SPY');
  [99, 97].forEach((price, i) => (orders = trader.propose(snap({ SPY: price }, i + 5), p)));
  assert.deepEqual(orders.map((o) => o.side), ['sell']);
  trader.enabled = false;
  assert.deepEqual(trader.propose(snap({ SPY: 80 }, 7), p), []);
  assert.throws(() => new TraderAgent([], noLog, 30, 10));
});

test('risk: resizes to position cap, enforces class cap, refuses stale prices', () => {
  const risk = new RiskManagerAgent(DEFAULT_UNIVERSE, noLog, { ...DEFAULT_SETTINGS.risk, maxPosition: 0.1 });
  const d = risk.review({ symbol: 'SPY', side: 'buy', quantity: 100, reason: 't' }, snap({ SPY: 500 }), pf());
  assert.equal(d.approved, true);
  assert.equal(d.quantity, 20);
  assert.equal(risk.review({ symbol: 'SPY', side: 'buy', quantity: 1, reason: 't' }, snap({ SPY: 500 }, 1, 'stale'), pf()).approved, false);

  const loose = new RiskManagerAgent(DEFAULT_UNIVERSE, noLog, { ...DEFAULT_SETTINGS.risk, maxPosition: 1 });
  const p = pf();
  p.execute(1, 0, 'BTC', 'buy', 0.4, 60_000, 't');
  const prices = { BTC: 60_000, ETH: 3_000 };
  const small = loose.review({ symbol: 'ETH', side: 'buy', quantity: 5, reason: 't' }, snap(prices), p);
  assert.ok(small.approved && small.quantity < 0.5);
  p.execute(2, 0, 'ETH', 'buy', small.quantity, 3_000, 't');
  assert.equal(loose.review({ symbol: 'ETH', side: 'buy', quantity: 5, reason: 't' }, snap(prices), p).approved, false);
});

test('risk: stop-loss with cooldown, kill switch halts buys, sells always allowed', () => {
  const risk = new RiskManagerAgent(DEFAULT_UNIVERSE, noLog, { ...DEFAULT_SETTINGS.risk, stopLoss: 0.05, cooldownTicks: 10 });
  const p = pf();
  p.execute(1, 0, 'AAPL', 'buy', 10, 200, 't');
  const exits = risk.forcedExits(snap({ AAPL: 185 }, 2), p);
  assert.deepEqual(exits.map((e) => [e.symbol, e.side]), [['AAPL', 'sell']]);
  p.execute(2, 0, 'AAPL', 'sell', 10, 185, 't');
  const buy = { symbol: 'AAPL', side: 'buy' as const, quantity: 1, reason: 't' };
  assert.equal(risk.review(buy, snap({ AAPL: 185 }, 5), p).approved, false);
  assert.equal(risk.review(buy, snap({ AAPL: 185 }, 12), p).approved, true);

  const ks = new RiskManagerAgent(DEFAULT_UNIVERSE, noLog, { ...DEFAULT_SETTINGS.risk, maxDrawdown: 0.1, stopLoss: 1 });
  const q = pf();
  q.execute(1, 0, 'BTC', 'buy', 1.5, 60_000, 't');
  ks.forcedExits(snap({ BTC: 60_000 }, 1), q);
  assert.equal(ks.forcedExits(snap({ BTC: 50_000 }, 2), q)[0].side, 'sell');
  assert.equal(ks.halted, true);
  assert.equal(ks.review({ symbol: 'SPY', side: 'buy', quantity: 1, reason: 't' }, snap({ SPY: 500 }, 3), q).approved, false);
  assert.equal(ks.review({ symbol: 'BTC', side: 'sell', quantity: 1, reason: 't' }, snap({ BTC: 50_000 }, 3), q).approved, true);
});

test('simulated run respects limits and survives a save/restore', async () => {
  const sim = new Simulation(settings({ mode: 'sim' }), undefined, 3);
  for (let i = 0; i < 400; i++) {
    await sim.step();
    assert.ok(sim.portfolio.cash >= -1e-6);
    assert.ok(sim.exposureByClass().crypto / sim.equity() <= 0.25 * 1.15);
  }
  assert.ok(sim.portfolio.fills.length > 0);
  const restored = Simulation.fromState(JSON.parse(JSON.stringify(sim.toState())));
  assert.equal(restored.equity(), sim.equity());
  assert.equal(restored.market.tick, 400);
  await restored.step();
  assert.equal(restored.market.tick, 401);
});

test('manual orders go through the risk manager', async () => {
  const sim = new Simulation(settings({ mode: 'sim', autoTrade: false }), undefined, 1);
  assert.equal(sim.manualOrder('SPY', 'buy', 1).ok, false); // no price yet
  await sim.step();
  const big = sim.manualOrder('SPY', 'buy', 1000);
  assert.ok(big.ok);
  assert.ok(big.fill!.quantity < 1000);
  assert.match(big.message, /position cap/);
  assert.equal(sim.manualOrder('QQQ', 'sell', 1).ok, false);
  assert.ok(sim.manualOrder('SPY', 'sell', 5).ok);
  assert.ok(sim.log.some((l) => l.agent === 'you'));
});

test("the trader never sells a position you opened by hand", async () => {
  const sim = new Simulation(settings({ mode: 'sim', symbols: ['SPY'] }), undefined, 1);
  sim.trader.seedHistory({ SPY: Array.from({ length: 30 }, (_, i) => 700 - i) }); // strong downtrend
  await sim.step();
  assert.ok(sim.manualOrder('SPY', 'buy', 10).ok);
  for (let i = 0; i < 5; i++) await sim.step();
  assert.equal(sim.portfolio.positions.SPY?.quantity, 10);
  const restored = Simulation.fromState(JSON.parse(JSON.stringify(sim.toState())));
  assert.equal(restored.trader.managed.has('SPY'), false);
});

test('a trader position you trade by hand becomes yours', async () => {
  const sim = new Simulation(settings({ mode: 'sim', symbols: ['SPY'] }), undefined, 1);
  sim.trader.seedHistory({ SPY: Array.from({ length: 30 }, (_, i) => 400 + i * 3) }); // strong uptrend
  const r = await sim.step();
  assert.deepEqual(r.fills.map((f) => f.side), ['buy']);
  assert.ok(sim.trader.managed.has('SPY'));
  sim.manualOrder('SPY', 'sell', 1);
  assert.equal(sim.trader.managed.has('SPY'), false);
  assert.ok(sim.log.some((l) => l.agent === 'trader' && l.text.includes('leaving SPY to you')));
});

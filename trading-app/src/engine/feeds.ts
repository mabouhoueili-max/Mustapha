// Live quotes, no API keys needed.
//
// - Crypto: Coinbase's public spot price API, then Yahoo Finance as a fallback.
// - Stocks, ETFs, commodities: Yahoo Finance's chart endpoint (query1, then query2).
//
// The app calls these directly from the phone (native networking has no browser
// CORS limits). Yahoo's endpoint is unofficial; some quotes are delayed.

import { Asset } from './assets';

export type FetchText = (url: string, timeoutMs: number) => Promise<string>;

export const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const yahooChart = (host: string, symbol: string, range: string) =>
  `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1m`;
const coinbaseSpot = (symbol: string) => `https://api.coinbase.com/v2/prices/${symbol}/spot`;

export const httpGet: FetchText = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) tradesim' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
};

function positive(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

export function parseChart(body: string): number | null {
  try {
    return positive(JSON.parse(body).chart.result[0].meta.regularMarketPrice);
  } catch {
    return null;
  }
}

export function parseChartCloses(body: string): number[] {
  try {
    const closes: unknown[] = JSON.parse(body).chart.result[0].indicators.quote[0].close ?? [];
    return closes.map(positive).filter((p): p is number => p !== null);
  } catch {
    return [];
  }
}

export function parseCoinbase(body: string): number | null {
  try {
    return positive(JSON.parse(body).data.amount);
  } catch {
    return null;
  }
}

type Result<T> = { value: T | null; error: string | null };

export class LiveFeed {
  lastErrors: Record<string, string> = {};

  constructor(private fetchText: FetchText = httpGet, private timeoutMs = 8000) {}

  private async get<T>(url: string, parse: (body: string) => T | null): Promise<Result<T>> {
    try {
      const value = parse(await this.fetchText(url, this.timeoutMs));
      return { value, error: value === null ? 'no price in response' : null };
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async yahoo<T>(asset: Asset, range: string, parse: (body: string) => T | null,
                         usable: (v: T) => boolean): Promise<Result<T>> {
    let last: Result<T> = { value: null, error: 'no Yahoo host answered' };
    for (const host of YAHOO_HOSTS) {
      last = await this.get(yahooChart(host, asset.liveSymbol, range), parse);
      if (last.value !== null && usable(last.value)) return last;
    }
    return { value: null, error: last.error ?? 'no price in response' };
  }

  private async quote(asset: Asset): Promise<Result<number>> {
    if (asset.assetClass === 'crypto') {
      const cb = await this.get(coinbaseSpot(asset.liveSymbol), parseCoinbase);
      if (cb.value !== null) return cb;
    }
    return this.yahoo(asset, '1d', parseChart, () => true);
  }

  async quotes(assets: Asset[]): Promise<Record<string, number>> {
    const results = await Promise.all(assets.map((a) => this.quote(a)));
    const out: Record<string, number> = {};
    this.lastErrors = {};
    assets.forEach((a, i) => {
      const r = results[i];
      if (r.value !== null) out[a.symbol] = r.value;
      else this.lastErrors[a.symbol] = r.error ?? 'no price in response';
    });
    return out;
  }

  /** Most recent 1-minute closes (oldest first), used to warm up the trader. */
  async history(asset: Asset, bars: number): Promise<number[]> {
    const r = await this.yahoo(asset, '5d', parseChartCloses, (v) => v.length > 0);
    return (r.value ?? []).slice(-bars);
  }
}

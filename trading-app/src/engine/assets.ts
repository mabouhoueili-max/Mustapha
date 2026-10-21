// Tradable instruments and per-asset-class trading rules.

export type AssetClass = 'stock' | 'etf' | 'commodity' | 'crypto';

export const ASSET_CLASSES: AssetClass[] = ['stock', 'etf', 'commodity', 'crypto'];

export interface ClassRules {
  lotSize: number; // smallest tradable quantity
  slippageBps: number; // price impact applied to each fill
  feeBps: number; // commission as a fraction of notional
  annualVol: number; // volatility used by the simulated feed
}

export const CLASS_RULES: Record<AssetClass, ClassRules> = {
  stock: { lotSize: 1, slippageBps: 2, feeBps: 0.5, annualVol: 0.3 },
  etf: { lotSize: 1, slippageBps: 1, feeBps: 0.3, annualVol: 0.18 },
  commodity: { lotSize: 0.01, slippageBps: 5, feeBps: 2, annualVol: 0.25 },
  crypto: { lotSize: 0.0001, slippageBps: 10, feeBps: 10, annualVol: 0.7 },
};

export interface Asset {
  symbol: string; // internal symbol shown in the app
  name: string;
  assetClass: AssetClass;
  startPrice: number; // seed price for the simulated feed
  liveSymbol: string; // Yahoo Finance / Coinbase symbol
}

export const DEFAULT_UNIVERSE: Asset[] = [
  { symbol: 'AAPL', name: 'Apple', assetClass: 'stock', startPrice: 230, liveSymbol: 'AAPL' },
  { symbol: 'MSFT', name: 'Microsoft', assetClass: 'stock', startPrice: 430, liveSymbol: 'MSFT' },
  { symbol: 'NVDA', name: 'Nvidia', assetClass: 'stock', startPrice: 130, liveSymbol: 'NVDA' },
  { symbol: 'SPY', name: 'S&P 500 ETF', assetClass: 'etf', startPrice: 570, liveSymbol: 'SPY' },
  { symbol: 'QQQ', name: 'Nasdaq-100 ETF', assetClass: 'etf', startPrice: 490, liveSymbol: 'QQQ' },
  { symbol: 'GOLD', name: 'Gold (oz)', assetClass: 'commodity', startPrice: 2650, liveSymbol: 'GC=F' },
  { symbol: 'OIL', name: 'WTI crude (bbl)', assetClass: 'commodity', startPrice: 72, liveSymbol: 'CL=F' },
  { symbol: 'BTC', name: 'Bitcoin', assetClass: 'crypto', startPrice: 65000, liveSymbol: 'BTC-USD' },
  { symbol: 'ETH', name: 'Ether', assetClass: 'crypto', startPrice: 2600, liveSymbol: 'ETH-USD' },
];

export function rulesFor(asset: Asset): ClassRules {
  return CLASS_RULES[asset.assetClass];
}

/** Round a quantity down to a whole number of lots. */
export function roundLot(qty: number, lot: number): number {
  if (!(qty > 0)) return 0;
  const lots = Math.floor(qty / lot + 1e-9);
  return Number((lots * lot).toFixed(10));
}

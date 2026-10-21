import { AssetClass } from '../engine/assets';
import { AgentName, PriceSource } from '../engine/types';

export const colors = {
  bg: '#0B0E14',
  card: '#151A23',
  cardAlt: '#1C2330',
  border: '#262E3D',
  text: '#E8ECF3',
  muted: '#8A94A6',
  faint: '#5B6578',
  up: '#22C55E',
  down: '#EF4444',
  warn: '#F59E0B',
  accent: '#3B82F6',
};

export const classColors: Record<AssetClass, string> = {
  stock: '#3B82F6',
  etf: '#A855F7',
  commodity: '#F59E0B',
  crypto: '#14B8A6',
};

export const classLabels: Record<AssetClass, string> = {
  stock: 'Stocks',
  etf: 'ETFs',
  commodity: 'Commodities',
  crypto: 'Crypto',
};

export const agentColors: Record<AgentName, string> = {
  market: '#38BDF8',
  trader: '#A78BFA',
  risk: '#F87171',
  you: '#FBBF24',
};

export const sourceColors: Record<PriceSource, string> = {
  live: colors.up,
  sim: colors.faint,
  stale: colors.warn,
};

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function money(n: number, digits = 2): string {
  const sign = n < 0 ? '-' : '';
  const [int, frac] = Math.abs(n).toFixed(digits).split('.');
  return `${sign}$${group(int)}${frac ? `.${frac}` : ''}`;
}

export function price(n: number): string {
  const digits = n >= 1000 ? 2 : n >= 1 ? 2 : 4;
  const [int, frac] = n.toFixed(digits).split('.');
  return `${group(int)}.${frac}`;
}

export function signedPct(x: number, digits = 2): string {
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`;
}

export function qty(n: number): string {
  return Number(n.toFixed(4)).toString();
}

export function clock(ms: number): string {
  const d = new Date(ms);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const upDown = (x: number) => (x >= 0 ? colors.up : colors.down);

import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ASSET_CLASSES } from '../../engine/assets';
import { SimController } from '../useSimulation';
import { Card, Dot, Empty, SectionTitle, Stat } from '../components';
import { EquityChart } from '../EquityChart';
import { classColors, classLabels, clock, colors, money, qty, signedPct, upDown } from '../theme';

export function PortfolioScreen({ ctl }: { ctl: SimController }) {
  const sim = ctl.sim!;
  const equity = sim.equity();
  const pnl = equity - sim.startingEquity;
  const exposure = sim.exposureByClass();
  const prices = sim.last?.prices ?? {};
  const positions = Object.entries(sim.portfolio.positions);
  const fills = sim.portfolio.fills.slice(-8).reverse();
  const limits = sim.settings.risk.classLimits;

  return (
    <ScrollView contentContainerStyle={s.content}>
      <Card>
        <Text style={s.label}>Account value</Text>
        <Text style={s.equity}>{money(equity)}</Text>
        <Text style={[s.pnl, { color: upDown(pnl) }]}>
          {pnl >= 0 ? '+' : ''}{money(pnl)} ({signedPct(pnl / sim.startingEquity)}) since start
        </Text>
        <View style={{ marginTop: 12 }}>
          <EquityChart points={sim.equityCurve} baseline={sim.startingEquity} />
        </View>
        <View style={s.stats}>
          <Stat label="Cash" value={money(sim.portfolio.cash, 0)} />
          <Stat label="Max drawdown" value={signedPct(-sim.maxDrawdown(), 1)} color={sim.maxDrawdown() > 0 ? colors.down : undefined} />
          <Stat label="Fees" value={money(sim.portfolio.feesPaid)} />
        </View>
      </Card>

      <Card>
        <SectionTitle>Exposure by asset class</SectionTitle>
        {ASSET_CLASSES.map((c) => {
          const share = equity ? exposure[c] / equity : 0;
          return (
            <View key={c} style={s.expRow}>
              <View style={s.expHead}>
                <Text style={s.expLabel}>{classLabels[c]}</Text>
                <Text style={s.expValue}>{money(exposure[c], 0)} · {(share * 100).toFixed(1)}%</Text>
              </View>
              <View style={s.track}>
                <View style={[s.bar, { width: `${Math.min(share, 1) * 100}%`, backgroundColor: classColors[c] }]} />
                <View style={[s.limit, { left: `${limits[c] * 100}%` }]} />
              </View>
            </View>
          );
        })}
        <Text style={s.hint}>White marks are the risk manager's limits per class.</Text>
      </Card>

      <Card>
        <SectionTitle>Positions</SectionTitle>
        {positions.length === 0 && <Empty>No open positions.</Empty>}
        {positions.map(([sym, pos]) => {
          const p = prices[sym] ?? pos.avgCost;
          const change = p / pos.avgCost - 1;
          return (
            <View key={sym} style={s.row}>
              <Dot color={classColors[sim.portfolio.assets[sym].assetClass]} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={s.sym}>{sym}</Text>
                <Text style={s.sub}>{qty(pos.quantity)} @ {money(pos.avgCost)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.val}>{money(pos.quantity * p)}</Text>
                <Text style={[s.sub, { color: upDown(change) }]}>{signedPct(change, 1)}</Text>
              </View>
            </View>
          );
        })}
      </Card>

      <Card>
        <SectionTitle>Recent trades</SectionTitle>
        {fills.length === 0 && <Empty>No trades yet.</Empty>}
        {fills.map((f, i) => (
          <View key={`${f.tick}-${f.symbol}-${i}`} style={s.row}>
            <Text style={[s.side, { color: f.side === 'buy' ? colors.up : colors.down }]}>{f.side.toUpperCase()}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.sym}>{qty(f.quantity)} {f.symbol} @ {money(f.price)}</Text>
              <Text style={s.sub} numberOfLines={1}>{f.reason}</Text>
            </View>
            <Text style={s.sub}>{sim.settings.mode === 'live' ? clock(f.time) : `#${f.tick}`}</Text>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  content: { padding: 16, paddingBottom: 32 },
  label: { color: colors.muted, fontSize: 13 },
  equity: { color: colors.text, fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 2 },
  pnl: { fontSize: 15, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
  stats: { flexDirection: 'row', marginTop: 12, gap: 12 },
  expRow: { marginBottom: 10 },
  expHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  expLabel: { color: colors.text, fontSize: 14 },
  expValue: { color: colors.muted, fontSize: 13, fontVariant: ['tabular-nums'] },
  track: { height: 8, borderRadius: 4, backgroundColor: colors.cardAlt, overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4 },
  limit: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.text, opacity: 0.7 },
  hint: { color: colors.faint, fontSize: 12, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sym: { color: colors.text, fontSize: 15, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: 12, marginTop: 1, fontVariant: ['tabular-nums'] },
  val: { color: colors.text, fontSize: 15, fontVariant: ['tabular-nums'] },
  side: { width: 44, fontSize: 12, fontWeight: '700' },
});

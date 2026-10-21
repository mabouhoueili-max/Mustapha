import { ReactNode, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { MarketDataAgent, RiskManagerAgent, TraderAgent } from '../../engine/agents';
import { AgentName } from '../../engine/types';
import { SimController } from '../useSimulation';
import { Card, Chip, Dot, Empty, SectionTitle } from '../components';
import { agentColors, clock, colors } from '../theme';

const FILTERS: (AgentName | 'all')[] = ['all', 'market', 'trader', 'risk', 'you'];

export function AgentsScreen({ ctl }: { ctl: SimController }) {
  const sim = ctl.sim!;
  const [filter, setFilter] = useState<AgentName | 'all'>('all');
  const last = sim.last;
  const sources = Object.values(last?.source ?? {});
  const liveCount = sources.filter((x) => x === 'live').length;
  const staleCount = sources.filter((x) => x === 'stale').length;
  const missing = sim.assets.length - sources.length;
  const ready = sim.assets.filter((a) => sim.trader.averages(a.symbol)).length;
  const signals = sim.assets.map((a) => {
    const avg = sim.trader.averages(a.symbol);
    return avg ? (avg[0] > avg[1] ? 'up' : 'down') : null;
  });
  const dd = sim.risk.drawdown(sim.equity());
  const cooling = Object.entries(sim.risk.cooldownUntil).filter(([, until]) => (last?.tick ?? 0) < until).map(([s]) => s);
  const entries = sim.log.filter((l) => filter === 'all' || l.agent === filter).slice(-80).reverse();

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <AgentCard name="market" title="Market data agent" role={MarketDataAgent.role}>
        {!last ? 'Waiting to start.' : sim.settings.mode === 'live'
          ? `Last poll ${clock(last.timestamp)} · ${liveCount} live${staleCount ? `, ${staleCount} stale` : ''}${missing ? `, ${missing} no quote` : ''}`
          : `Simulated tick #${last.tick} (1 tick = 1 market hour)`}
      </AgentCard>

      <AgentCard
        name="trader"
        title="Trader agent"
        role={TraderAgent.role}
        right={<Switch value={sim.trader.enabled} onValueChange={ctl.setAutoTrade} trackColor={{ true: agentColors.trader }} />}
      >
        {sim.trader.enabled ? 'Auto-trading on. ' : 'Auto-trading off: only you trade. '}
        {ready < sim.assets.length
          ? `Learning trends: ${ready}/${sim.assets.length} assets have ${sim.trader.slow} prices.`
          : `Trend up on ${signals.filter((x) => x === 'up').length}, down on ${signals.filter((x) => x === 'down').length}. Managing ${sim.trader.managed.size} position${sim.trader.managed.size === 1 ? '' : 's'}.`}
      </AgentCard>

      <AgentCard name="risk" title="Risk manager agent" role={RiskManagerAgent.role}>
        {sim.risk.halted
          ? 'KILL SWITCH ON: all buys halted. Reset the account in Settings to trade again.'
          : `Drawdown ${(dd * 100).toFixed(1)}% of ${(sim.settings.risk.maxDrawdown * 100).toFixed(0)}% limit · stop-loss ${(sim.settings.risk.stopLoss * 100).toFixed(0)}%`}
        {cooling.length ? ` · cooling down: ${cooling.join(', ')}` : ''}
      </AgentCard>

      <Card>
        <SectionTitle>Activity</SectionTitle>
        <View style={s.filters}>
          {FILTERS.map((f) => (
            <Chip key={f} label={f === 'all' ? 'All' : f === 'you' ? 'You' : f[0].toUpperCase() + f.slice(1)}
              active={filter === f} onPress={() => setFilter(f)} color={f === 'all' ? undefined : agentColors[f]} />
          ))}
        </View>
        {entries.length === 0 && <Empty>Nothing yet.</Empty>}
        {entries.map((l, i) => (
          <View key={`${l.time}-${i}`} style={s.logRow}>
            <Dot color={agentColors[l.agent]} size={7} />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Text style={s.logText}>{l.text}</Text>
              <Text style={s.logMeta}>{l.agent} · {clock(l.time)}{l.tick ? ` · tick ${l.tick}` : ''}</Text>
            </View>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

function AgentCard({ name, title, role, right, children }: { name: AgentName; title: string; role: string; right?: ReactNode; children: ReactNode }) {
  return (
    <Card style={{ borderLeftWidth: 3, borderLeftColor: agentColors[name] }}>
      <View style={s.head}>
        <Text style={s.title}>{title}</Text>
        {right}
      </View>
      <Text style={s.role}>{role}</Text>
      <Text style={s.status}>{children}</Text>
    </Card>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  role: { color: colors.muted, fontSize: 13, marginTop: 4 },
  status: { color: colors.text, fontSize: 14, marginTop: 8 },
  filters: { flexDirection: 'row', flexWrap: 'wrap' },
  logRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  logText: { color: colors.text, fontSize: 13 },
  logMeta: { color: colors.faint, fontSize: 11, marginTop: 2 },
});

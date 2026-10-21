import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { AgentsScreen } from './src/ui/screens/AgentsScreen';
import { MarketsScreen } from './src/ui/screens/MarketsScreen';
import { PortfolioScreen } from './src/ui/screens/PortfolioScreen';
import { SettingsScreen } from './src/ui/screens/SettingsScreen';
import { clock, colors } from './src/ui/theme';
import { SimController, useSimulation } from './src/ui/useSimulation';

type Tab = 'portfolio' | 'markets' | 'agents' | 'settings';

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'portfolio', label: 'Portfolio', icon: 'pie-chart' },
  { key: 'markets', label: 'Markets', icon: 'trending-up' },
  { key: 'agents', label: 'Agents', icon: 'people' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
];

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Main />
    </SafeAreaProvider>
  );
}

function Main() {
  const ctl = useSimulation();
  const [tab, setTab] = useState<Tab>('portfolio');

  if (!ctl.sim) {
    return (
      <View style={[s.fill, s.center]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  return (
    <SafeAreaView style={s.fill} edges={['top']}>
      <Header ctl={ctl} />
      {ctl.error && <Text style={s.error}>{ctl.error}</Text>}
      <View style={s.fill}>
        {tab === 'portfolio' && <PortfolioScreen ctl={ctl} />}
        {tab === 'markets' && <MarketsScreen ctl={ctl} />}
        {tab === 'agents' && <AgentsScreen ctl={ctl} />}
        {tab === 'settings' && <SettingsScreen ctl={ctl} />}
      </View>
      <SafeAreaView edges={['bottom']} style={s.tabBar}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable key={t.key} style={s.tab} onPress={() => setTab(t.key)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
              <Ionicons name={active ? t.icon : (`${t.icon}-outline` as keyof typeof Ionicons.glyphMap)} size={22} color={active ? colors.accent : colors.muted} />
              <Text style={[s.tabLabel, active && { color: colors.accent }]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </SafeAreaView>
    </SafeAreaView>
  );
}

function Header({ ctl }: { ctl: SimController }) {
  const sim = ctl.sim!;
  const live = sim.settings.mode === 'live';
  const status = ctl.running
    ? sim.last ? `Updated ${live ? clock(sim.last.timestamp) : `tick ${sim.last.tick}`}` : 'Starting…'
    : 'Paused';
  return (
    <View style={s.header}>
      <View style={{ flex: 1 }}>
        <View style={s.titleRow}>
          <Text style={s.title}>TradeSim</Text>
          <View style={[s.badge, { backgroundColor: live ? 'rgba(34,197,94,0.15)' : 'rgba(138,148,166,0.15)' }]}>
            <View style={[s.badgeDot, { backgroundColor: live ? colors.up : colors.muted }]} />
            <Text style={[s.badgeText, { color: live ? colors.up : colors.muted }]}>{live ? 'LIVE' : 'SIM'}</Text>
          </View>
        </View>
        <Text style={s.status}>{status}{sim.risk.halted ? ' · kill switch on' : ''}</Text>
      </View>
      <Pressable
        onPress={ctl.running ? ctl.pause : ctl.start}
        style={[s.runBtn, { backgroundColor: ctl.running ? colors.cardAlt : colors.up }]}
        accessibilityRole="button"
      >
        <Ionicons name={ctl.running ? 'pause' : 'play'} size={16} color="#fff" />
        <Text style={s.runText}>{ctl.running ? 'Pause' : 'Start'}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  status: { color: colors.muted, fontSize: 12, marginTop: 2 },
  runBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  runText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  error: { color: colors.text, backgroundColor: 'rgba(239,68,68,0.2)', paddingHorizontal: 16, paddingVertical: 10, fontSize: 13 },
  tabBar: { flexDirection: 'row', backgroundColor: colors.card, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  tab: { flex: 1, alignItems: 'center', paddingTop: 8, paddingBottom: 6 },
  tabLabel: { color: colors.muted, fontSize: 11, marginTop: 2, fontWeight: '500' },
});

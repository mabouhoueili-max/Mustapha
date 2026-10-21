import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { ASSET_CLASSES, DEFAULT_UNIVERSE } from '../../engine/assets';
import { DEFAULT_SETTINGS, FeedMode, Settings } from '../../engine/simulation';
import { SimController } from '../useSimulation';
import { Card, Chip, SectionTitle } from '../components';
import { classLabels, colors, money } from '../theme';

const INTERVALS: Record<FeedMode, number[]> = { live: [10, 30, 60, 300], sim: [0.25, 0.5, 1, 2] };
const CASH = [10_000, 100_000, 1_000_000];
const pctChips = (values: number[]) => values.map((v) => ({ label: `${Math.round(v * 100)}%`, value: v }));

function Choice<T>({ title, hint, options, value, onChange }: {
  title: string; hint?: string; options: { label: string; value: T }[]; value: T; onChange: (v: T) => void;
}) {
  return (
    <View style={{ marginBottom: 10 }}>
      <Text style={s.label}>{title}</Text>
      {hint && <Text style={s.hint}>{hint}</Text>}
      <View style={s.chips}>
        {options.map((o) => <Chip key={o.label} label={o.label} active={o.value === value} onPress={() => onChange(o.value)} />)}
      </View>
    </View>
  );
}

export function SettingsScreen({ ctl }: { ctl: SimController }) {
  const sim = ctl.sim!;
  const [draft, setDraft] = useState<Settings>(sim.settings);
  useEffect(() => setDraft(sim.settings), [sim]);
  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));
  const setRisk = (patch: Partial<Settings['risk']>) => setDraft((d) => ({ ...d, risk: { ...d.risk, ...patch } }));
  const changed = JSON.stringify(draft) !== JSON.stringify(sim.settings);

  const apply = (settings: Settings) =>
    Alert.alert('Start a new account?', `This closes all positions and starts again with ${money(settings.cash, 0)}.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Start over', style: 'destructive', onPress: () => ctl.reset(settings) },
    ]);

  const toggleSymbol = (sym: string) => {
    const has = draft.symbols.includes(sym);
    if (has && draft.symbols.length === 1) return; // keep at least one asset
    set({ symbols: has ? draft.symbols.filter((x) => x !== sym) : [...draft.symbols, sym] });
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
      <Card>
        <SectionTitle>Prices</SectionTitle>
        <Choice
          title="Price feed"
          hint={draft.mode === 'live'
            ? 'Real quotes: Coinbase for crypto, Yahoo Finance for the rest. Some are delayed; stocks only move in market hours.'
            : 'Generated prices, fast-forwarded. Good for testing the agents at any time of day.'}
          options={[{ label: 'Live', value: 'live' as FeedMode }, { label: 'Simulated', value: 'sim' as FeedMode }]}
          value={draft.mode}
          onChange={(mode) => set({ mode, intervalSec: mode === 'live' ? 30 : 0.5 })}
        />
        <Choice
          title="Update every"
          options={INTERVALS[draft.mode].map((v) => ({ label: v < 1 ? `${v * 1000} ms` : v >= 60 ? `${v / 60} min` : `${v} s`, value: v }))}
          value={draft.intervalSec}
          onChange={(intervalSec) => set({ intervalSec })}
        />
      </Card>

      <Card>
        <SectionTitle>Account</SectionTitle>
        <Choice title="Starting cash" options={CASH.map((v) => ({ label: money(v, 0), value: v }))} value={draft.cash} onChange={(cash) => set({ cash })} />
        <Text style={s.label}>Assets</Text>
        {ASSET_CLASSES.map((cls) => (
          <View key={cls} style={{ marginTop: 6 }}>
            <Text style={s.hint}>{classLabels[cls]}</Text>
            <View style={s.chips}>
              {DEFAULT_UNIVERSE.filter((a) => a.assetClass === cls).map((a) => (
                <Chip key={a.symbol} label={a.symbol} active={draft.symbols.includes(a.symbol)} onPress={() => toggleSymbol(a.symbol)} />
              ))}
            </View>
          </View>
        ))}
      </Card>

      <Card>
        <SectionTitle>Trader agent</SectionTitle>
        <View style={s.switchRow}>
          <Text style={s.label}>Start with auto-trading on</Text>
          <Switch value={draft.autoTrade} onValueChange={(autoTrade) => set({ autoTrade })} />
        </View>
        <Choice title="Size of each buy" options={pctChips([0.05, 0.1, 0.15])} value={draft.targetWeight} onChange={(targetWeight) => set({ targetWeight })} />
        <Choice
          title="Trend speed"
          hint="Moving averages compared: fast vs slow, in ticks."
          options={[{ label: '5 / 20', value: 5 }, { label: '10 / 30', value: 10 }, { label: '20 / 60', value: 20 }]}
          value={draft.fast}
          onChange={(fast) => set({ fast, slow: fast === 5 ? 20 : fast === 10 ? 30 : 60 })}
        />
      </Card>

      <Card>
        <SectionTitle>Risk manager agent</SectionTitle>
        <Choice title="Max in one asset" options={pctChips([0.1, 0.2, 0.3])} value={draft.risk.maxPosition} onChange={(maxPosition) => setRisk({ maxPosition })} />
        <Choice title="Stop-loss" options={pctChips([0.05, 0.08, 0.12])} value={draft.risk.stopLoss} onChange={(stopLoss) => setRisk({ stopLoss })} />
        <Choice title="Kill switch at drawdown" options={pctChips([0.1, 0.2, 0.3])} value={draft.risk.maxDrawdown} onChange={(maxDrawdown) => setRisk({ maxDrawdown })} />
        <Choice title="Max in crypto" options={pctChips([0.1, 0.25, 0.4])} value={draft.risk.classLimits.crypto}
          onChange={(crypto) => setRisk({ classLimits: { ...draft.risk.classLimits, crypto } })} />
      </Card>

      <Pressable style={[s.primary, !changed && s.disabled]} disabled={!changed} onPress={() => apply(draft)}>
        <Text style={s.primaryText}>Apply and start new account</Text>
      </Pressable>
      <Pressable style={s.secondary} onPress={() => apply(sim.settings)}>
        <Text style={s.secondaryText}>Reset account (same settings)</Text>
      </Pressable>
      <Pressable style={s.secondary} onPress={() => { setDraft(DEFAULT_SETTINGS); }}>
        <Text style={s.secondaryText}>Restore default settings</Text>
      </Pressable>

      <Text style={s.disclaimer}>
        Paper trading only: no real money and no broker account. Not investment advice. The trader agent's
        strategy is a simple example and loses money to fees in sideways markets. The app trades only while
        it is open on screen; iPhone pauses it in the background.
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  label: { color: colors.text, fontSize: 15, fontWeight: '500', marginBottom: 4 },
  hint: { color: colors.muted, fontSize: 12, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap' },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  primary: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  secondary: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: colors.border },
  secondaryText: { color: colors.text, fontSize: 15 },
  disabled: { opacity: 0.4 },
  disclaimer: { color: colors.faint, fontSize: 12, marginTop: 20, lineHeight: 17 },
});

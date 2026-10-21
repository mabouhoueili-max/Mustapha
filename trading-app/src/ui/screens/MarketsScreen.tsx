import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Asset, ASSET_CLASSES, roundLot, rulesFor } from '../../engine/assets';
import { SimController } from '../useSimulation';
import { Card, Dot, Empty, SectionTitle } from '../components';
import { classColors, classLabels, colors, money, price, qty, signedPct, sourceColors, upDown } from '../theme';

export function MarketsScreen({ ctl }: { ctl: SimController }) {
  const sim = ctl.sim!;
  const [trading, setTrading] = useState<Asset | null>(null);
  const last = sim.last;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      {ASSET_CLASSES.map((cls) => {
        const assets = sim.assets.filter((a) => a.assetClass === cls);
        if (!assets.length) return null;
        return (
          <Card key={cls}>
            <SectionTitle right={<Dot color={classColors[cls]} />}>{classLabels[cls]}</SectionTitle>
            {assets.map((a) => {
              const p = last?.prices[a.symbol];
              const src = last?.source[a.symbol];
              const open = sim.openPrices[a.symbol];
              const change = p && open ? p / open - 1 : 0;
              const held = sim.portfolio.positions[a.symbol];
              return (
                <Pressable key={a.symbol} style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]} onPress={() => setTrading(a)}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.sym}>{a.symbol}</Text>
                    <Text style={s.sub}>{a.name}{held ? ` · holding ${qty(held.quantity)}` : ''}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <View style={s.priceRow}>
                      {src && <Dot color={sourceColors[src]} size={6} />}
                      <Text style={s.price}>{p !== undefined ? price(p) : '—'}</Text>
                    </View>
                    <Text style={[s.sub, { color: p ? upDown(change) : colors.faint }]}>
                      {p ? signedPct(change) : src === undefined && sim.settings.mode === 'live' && last ? 'no quote' : ' '}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </Card>
        );
      })}
      {!last && <Empty>Press Start to load prices.</Empty>}
      <View style={s.legend}>
        <Dot color={colors.up} size={6} /><Text style={s.legendText}>live</Text>
        <Dot color={colors.warn} size={6} /><Text style={s.legendText}>stale (last quote failed)</Text>
        <Dot color={colors.faint} size={6} /><Text style={s.legendText}>simulated</Text>
      </View>
      <Text style={s.legendText}>Change is since the first price this session. Tap an asset to trade.</Text>
      {trading && <TradeSheet ctl={ctl} asset={trading} onClose={() => setTrading(null)} />}
    </ScrollView>
  );
}

function TradeSheet({ ctl, asset, onClose }: { ctl: SimController; asset: Asset; onClose: () => void }) {
  const sim = ctl.sim!;
  const [amount, setAmount] = useState('1000');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const p = sim.last?.prices[asset.symbol];
  const held = sim.portfolio.positions[asset.symbol];
  const dollars = Number(amount.replace(/[^0-9.]/g, '')) || 0;
  const units = p ? roundLot(dollars / p, rulesFor(asset).lotSize) : 0;

  const order = (side: 'buy' | 'sell', quantity: number) => setResult(ctl.manualOrder(asset.symbol, side, quantity));

  return (
    <Modal animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <View style={s.sheet}>
          <View style={s.grabber} />
          <Text style={s.sheetTitle}>{asset.symbol} <Text style={s.sub}>{asset.name}</Text></Text>
          <Text style={s.sheetPrice}>{p !== undefined ? money(p) : 'No price yet'}</Text>
          <Text style={s.sub}>
            {held ? `You hold ${qty(held.quantity)} (${money(held.quantity * (p ?? held.avgCost))})` : 'You hold none'} · cash {money(sim.portfolio.cash, 0)}
          </Text>

          <Text style={[s.sub, { marginTop: 16 }]}>Amount in dollars</Text>
          <TextInput
            value={amount}
            onChangeText={(t) => { setAmount(t); setResult(null); }}
            keyboardType="decimal-pad"
            style={s.input}
            placeholder="1000"
            placeholderTextColor={colors.faint}
          />
          <Text style={s.sub}>≈ {qty(units)} {asset.assetClass === 'crypto' ? asset.symbol : 'units'} · fills include slippage and fees</Text>

          <View style={s.buttons}>
            <Pressable style={[s.btn, { backgroundColor: colors.up }, (!units) && s.disabled]} disabled={!units} onPress={() => order('buy', units)}>
              <Text style={s.btnText}>Buy</Text>
            </Pressable>
            <Pressable style={[s.btn, { backgroundColor: colors.down }, (!units || !held) && s.disabled]} disabled={!units || !held} onPress={() => order('sell', units)}>
              <Text style={s.btnText}>Sell</Text>
            </Pressable>
          </View>
          {held && (
            <Pressable style={[s.btn, s.outline]} onPress={() => order('sell', held.quantity)}>
              <Text style={[s.btnText, { color: colors.text }]}>Sell all</Text>
            </Pressable>
          )}
          {result && <Text style={[s.result, { color: result.ok ? colors.up : colors.down }]}>{result.message}</Text>}
          <Text style={[s.sub, { marginTop: 10 }]}>Every order is checked by the risk manager, which may shrink or refuse it. Once you trade an asset by hand, the trader agent leaves it to you; stop-losses still apply.</Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  sym: { color: colors.text, fontSize: 16, fontWeight: '600' },
  sub: { color: colors.muted, fontSize: 12, marginTop: 1, fontVariant: ['tabular-nums'] },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  price: { color: colors.text, fontSize: 16, fontVariant: ['tabular-nums'] },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 },
  legendText: { color: colors.faint, fontSize: 12, marginRight: 6 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  grabber: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginBottom: 12 },
  sheetTitle: { color: colors.text, fontSize: 22, fontWeight: '700' },
  sheetPrice: { color: colors.text, fontSize: 28, fontWeight: '600', marginVertical: 4, fontVariant: ['tabular-nums'] },
  input: { color: colors.text, fontSize: 24, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginVertical: 6, fontVariant: ['tabular-nums'] },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 14 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  outline: { borderWidth: 1, borderColor: colors.border, flex: 0 },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  disabled: { opacity: 0.35 },
  result: { marginTop: 12, fontSize: 14, fontWeight: '500' },
});

import { useState } from 'react';
import { LayoutChangeEvent, Text, View } from 'react-native';
import Svg, { Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

import { EquityPoint } from '../engine/simulation';
import { colors, upDown } from './theme';

export function EquityChart({ points, baseline, height = 160 }: { points: EquityPoint[]; baseline: number; height?: number }) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (points.length < 2) {
    return (
      <View style={{ height, justifyContent: 'center', alignItems: 'center' }} onLayout={onLayout}>
        <Text style={{ color: colors.faint }}>Press Start to begin trading</Text>
      </View>
    );
  }

  const values = points.map((p) => p.equity);
  const lo = Math.min(baseline, ...values);
  const hi = Math.max(baseline, ...values);
  const span = hi - lo || 1;
  const pad = 6;
  const x = (i: number) => (i / (points.length - 1)) * width;
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const color = upDown(values[values.length - 1] - baseline);

  return (
    <View onLayout={onLayout} style={{ height }}>
      {width > 0 && (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={color} stopOpacity={0.3} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Line x1={0} x2={width} y1={y(baseline)} y2={y(baseline)} stroke={colors.border} strokeDasharray="4 4" />
          <Path d={area} fill="url(#fill)" />
          <Path d={line} stroke={color} strokeWidth={2} fill="none" />
        </Svg>
      )}
    </View>
  );
}

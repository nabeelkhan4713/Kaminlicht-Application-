/**
 * FlameGraphic — a cluster of real flame shapes (SVG teardrops with a gradient),
 * gently flickering. Replaces the old rectangular "music bar" look.
 *
 * `tint` sets the flame colour (follows the chosen LED colour); the top of each
 * flame is a lighter shade of it for a glowing look.
 */
import { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';

const AnimatedView = Animated.View;

// A single flame path in a 40x90 viewBox: pointed top, bulbous bottom.
const FLAME_PATH = 'M20 3 C 25 25, 37 39, 30 61 C 28 83, 12 83, 10 61 C 3 39, 15 25, 20 3 Z';

function lighten(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.55);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  const to = (v: number) => v.toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function Flame({ tint, scale, delayFactor, flicker }: { tint: string; scale: number; delayFactor: number; flicker: Animated.Value }) {
  const scaleY = flicker.interpolate({
    inputRange: [0, 1],
    outputRange: [scale, scale * (delayFactor > 0.5 ? 1.14 : 0.82)],
  });
  const opacity = flicker.interpolate({ inputRange: [0, 1], outputRange: [0.95, 0.68] });
  const id = `fg-${tint.replace('#', '')}-${Math.round(delayFactor * 100)}`;
  return (
    <AnimatedView style={{ transform: [{ scaleY }], opacity, transformOrigin: 'bottom' }}>
      <Svg width={26} height={86} viewBox="0 0 40 90">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={lighten(tint)} />
            <Stop offset="1" stopColor={tint} />
          </LinearGradient>
        </Defs>
        <Path d={FLAME_PATH} fill={`url(#${id})`} />
      </Svg>
    </AnimatedView>
  );
}

export default function FlameGraphic({ on, tint, big }: { on: boolean; tint: string; big?: boolean }) {
  const flicker = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) {
      flicker.stopAnimation();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flicker, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(flicker, { toValue: 0, duration: 720, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [on, flicker]);

  if (!on) {
    return (
      <View style={{ height: big ? 170 : 96, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={44} height={70} viewBox="0 0 40 90" opacity={0.3}>
          <Path d={FLAME_PATH} fill="#4a3a33" />
        </Svg>
      </View>
    );
  }

  // Heights of the cluster, centre tallest.
  const flames = [0.5, 0.72, 0.92, 1, 0.9, 0.68, 0.46];
  const baseScale = big ? 1.6 : 1;
  return (
    <View
      style={{
        height: big ? 170 : 96,
        flexDirection: 'row',
        alignItems: 'flex-end',
        justifyContent: 'center',
      }}
    >
      {flames.map((h, i) => (
        <View key={i} style={{ marginHorizontal: big ? -1 : -2 }}>
          <Flame tint={tint} scale={h * baseScale} delayFactor={(i % 3) / 3 + 0.2} flicker={flicker} />
        </View>
      ))}
    </View>
  );
}

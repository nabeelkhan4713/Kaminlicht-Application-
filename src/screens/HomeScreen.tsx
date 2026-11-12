/**
 * HomeScreen — the "GF Cassette 01" dark flame screen (design v1).
 *
 * Faithful to the shared mockup: dark premium theme, glowing power button, an
 * animated flame, a Flame / Heat mode toggle, and a live colour wheel for the
 * flame LEDs. Everything is wired to the REAL firmware commands:
 *
 *   Power button   -> buildPowerCmd           (system/power)
 *   Flame toggle   -> buildVaporIntensityCmd  (vapor on = full) / buildVaporPowerCmd(false)
 *   Heat toggle    -> buildHeaterPowerCmd      (climate/power)
 *   Colour wheel   -> buildColorCmd('flame')  (lighting/set_color -> WS2805 strips)
 *   Swatches       -> buildColorCmd('flame')
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ColorPicker from 'react-native-wheel-color-picker';
import { useConnectionState, usePublish, usePublishWithAck } from '../contexts/DeviceContext';
import { useManifest } from '../contexts/DeviceContext';
import { useDeviceTelemetry, usePower, useVaporOn, useHeaterOn } from '../hooks/useDeviceTelemetry';
import {
  buildPowerCmd,
  buildVaporPowerCmd,
  buildVaporIntensityCmd,
  buildHeaterPowerCmd,
  buildColorCmd,
} from '../types/commands';

// ---- small colour helpers (hex <-> rgb) ----
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

const SWATCHES = ['#ff7a18', '#e85d13', '#ffd21e', '#e01e1e', '#3b82f6', '#a855f7', '#10b981'];

export default function HomeScreen() {
  const manifest = useManifest();
  const connectionState = useConnectionState();
  const connected = connectionState === 'connected';
  const power = usePower();
  const vaporOn = useVaporOn();
  const heaterOn = useHeaterOn();
  const flame = useDeviceTelemetry((t) => t?.lighting?.flame ?? null);
  const publish = usePublish();
  const publishWithAck = usePublishWithAck();

  const [mode, setMode] = useState<'flame' | 'heat'>('flame');
  // Local colour override while the wheel is being dragged (device telemetry catches up after).
  const [colorOverride, setColorOverride] = useState<string | null>(null);

  const deviceHex = flame ? rgbToHex(flame.r, flame.g, flame.b) : '#ff7a18';
  const currentHex = colorOverride ?? deviceHex;

  const anythingOn = power && (vaporOn || heaterOn);

  // ---- flame animation (pure RN Animated, no extra libs) ----
  const flicker = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!vaporOn) {
      flicker.stopAnimation();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flicker, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(flicker, { toValue: 0, duration: 750, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [vaporOn, flicker]);

  const sendColor = (hex: string) => {
    const { r, g, b } = hexToRgb(hex);
    publish(buildColorCmd('flame', { r, g, b }));
  };

  const toggleFlame = () => {
    if (vaporOn) void publishWithAck(buildVaporPowerCmd(false), 6000);
    else void publishWithAck(buildVaporIntensityCmd(6), 6000);
  };
  const toggleHeat = () => void publishWithAck(buildHeaterPowerCmd(!heaterOn), 6000);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{manifest?.serialNumber ? 'GF Cassette' : 'GF Cassette 01'}</Text>
        </View>
        {!connected && <Text style={styles.offline}>Reconnecting to fireplace…</Text>}

        {/* Power + flame hero */}
        <View style={styles.hero}>
          <PowerButton
            on={power}
            disabled={!connected}
            onPress={() => void publishWithAck(buildPowerCmd(!power), 6000)}
          />
          <FlameViz on={vaporOn} flicker={flicker} tint={currentHex} />
        </View>

        {/* Flame / Heat mode toggle */}
        <View style={styles.segment}>
          <SegmentTab
            label="Flame"
            active={mode === 'flame'}
            on={vaporOn}
            onSelect={() => setMode('flame')}
            onToggle={toggleFlame}
            disabled={!connected}
          />
          <SegmentTab
            label="Heat"
            active={mode === 'heat'}
            on={heaterOn}
            onSelect={() => setMode('heat')}
            onToggle={toggleHeat}
            disabled={!connected}
          />
        </View>

        {/* Mode content */}
        {mode === 'flame' ? (
          <View style={styles.panel}>
            <Text style={styles.sectionLabel}>FLAME COLOR</Text>
            <View style={styles.wheelRow}>
              <View style={styles.wheelWrap}>
                <ColorPicker
                  color={currentHex}
                  onColorChange={(c: string) => setColorOverride(c)}
                  onColorChangeComplete={(c: string) => {
                    setColorOverride(c);
                    sendColor(c);
                  }}
                  thumbSize={28}
                  sliderSize={0}
                  noSnap
                  row={false}
                  swatches={false}
                />
              </View>
              <View style={styles.swatchCol}>
                {SWATCHES.map((hex) => {
                  const selected = currentHex.toLowerCase() === hex.toLowerCase();
                  return (
                    <Pressable
                      key={hex}
                      disabled={!connected}
                      onPress={() => {
                        setColorOverride(hex);
                        sendColor(hex);
                      }}
                      style={[styles.swatch, { backgroundColor: hex }, selected && styles.swatchSelected]}
                    />
                  );
                })}
              </View>
            </View>
          </View>
        ) : (
          <View style={styles.panel}>
            <Text style={styles.sectionLabel}>HEAT</Text>
            <Text style={styles.heatHint}>
              {heaterOn ? 'Heater is running.' : 'Turn on Heat above to warm the room.'}
            </Text>
          </View>
        )}

        {!anythingOn && (
          <Text style={styles.emptyHint}>Enable flame or heat to begin</Text>
        )}
      </ScrollView>
    </View>
  );
}

// ---- Power button (glowing ring) ----
function PowerButton({ on, disabled, onPress }: { on: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [pressed && { opacity: 0.8 }]}>
      <View style={[styles.powerOuter, on && styles.powerOuterOn, disabled && styles.dim]}>
        <View style={[styles.powerInner, on && styles.powerInnerOn]}>
          <Text style={[styles.powerGlyph, on && styles.powerGlyphOn]}>⏻</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ---- Animated flame ----
function FlameViz({ on, flicker, tint }: { on: boolean; flicker: Animated.Value; tint: string }) {
  const bars = [0.55, 0.8, 1, 0.85, 0.6];
  return (
    <View style={styles.flameBox}>
      {on ? (
        <View style={styles.flameRow}>
          {bars.map((h, i) => {
            const scaleY = flicker.interpolate({
              inputRange: [0, 1],
              outputRange: [h, h * (i % 2 === 0 ? 0.78 : 1.12)],
            });
            const opacity = flicker.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0.6] });
            return (
              <Animated.View
                key={i}
                style={[
                  styles.flameBar,
                  { backgroundColor: tint, transform: [{ scaleY }], opacity, shadowColor: tint },
                ]}
              />
            );
          })}
        </View>
      ) : (
        <Text style={styles.flameOff}>🔥</Text>
      )}
    </View>
  );
}

// ---- Flame / Heat segment with its own power switch ----
function SegmentTab({
  label,
  active,
  on,
  onSelect,
  onToggle,
  disabled,
}: {
  label: string;
  active: boolean;
  on: boolean;
  onSelect: () => void;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable style={[styles.segTab, active && styles.segTabActive]} onPress={onSelect}>
      <Pressable
        disabled={disabled}
        onPress={onToggle}
        style={[styles.switch, on && styles.switchOn, disabled && styles.dim]}
      >
        <View style={[styles.knob, on && styles.knobOn]} />
      </Pressable>
      <Text style={[styles.segLabel, active && styles.segLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const BG = '#0b0806';
const CARD = '#161210';
const ACCENT = '#f97316';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  container: { padding: 20, paddingBottom: 40, gap: 18 },
  header: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', paddingTop: 4 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 0.5 },
  offline: { color: '#fca5a5', fontSize: 13, textAlign: 'center' },

  hero: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
  powerOuter: {
    width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#1c1714', borderWidth: 1, borderColor: '#2a2320',
  },
  powerOuterOn: {
    borderColor: ACCENT, shadowColor: ACCENT, shadowOpacity: 0.9, shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 }, elevation: 10,
  },
  powerInner: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#241d19' },
  powerInnerOn: { backgroundColor: '#3a2213' },
  powerGlyph: { color: '#8a7f78', fontSize: 24, fontWeight: '700' },
  powerGlyphOn: { color: ACCENT },

  flameBox: { flex: 1, height: 96, backgroundColor: '#120d0a', borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  flameRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 70 },
  flameBar: {
    width: 10, height: 60, borderRadius: 6,
    shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6,
  },
  flameOff: { fontSize: 30, opacity: 0.35 },

  segment: { flexDirection: 'row', gap: 10, backgroundColor: CARD, borderRadius: 16, padding: 8 },
  segTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 10, borderRadius: 12 },
  segTabActive: { backgroundColor: '#241d19' },
  segLabel: { color: '#8a7f78', fontSize: 15, fontWeight: '700' },
  segLabelActive: { color: '#fff' },
  switch: { width: 42, height: 24, borderRadius: 12, backgroundColor: '#3a322d', padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: ACCENT },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignSelf: 'flex-start' },
  knobOn: { alignSelf: 'flex-end' },

  panel: { backgroundColor: CARD, borderRadius: 18, padding: 16, gap: 14 },
  sectionLabel: { color: '#8a7f78', fontSize: 12, fontWeight: '800', letterSpacing: 1.5, textAlign: 'center' },
  wheelRow: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  wheelWrap: { flex: 1, aspectRatio: 1, maxWidth: 240 },
  swatchCol: { gap: 10, paddingVertical: 4 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: 'transparent' },
  swatchSelected: { borderColor: '#fff' },

  heatHint: { color: '#b8aca4', fontSize: 14, textAlign: 'center' },
  emptyHint: { color: '#6b6058', fontSize: 14, textAlign: 'center', marginTop: 8 },
  dim: { opacity: 0.4 },
});

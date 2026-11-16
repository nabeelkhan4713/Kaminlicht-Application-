/**
 * HomeScreen — the "Glow Fire" dark flame screen (design v2).
 *
 * Dark premium theme matching the mockup: glowing power button, animated flame,
 * a Flame / Heat mode toggle, and a bottom control row that swaps the panel above
 * it between Colour, Flame intensity, Brightness, Music and Sleep timer.
 *
 * Every control is wired to the REAL firmware commands:
 *   Power            -> buildPowerCmd            (system/power)
 *   Flame on/off     -> buildVaporPowerCmd       (vapor/power)
 *   Flame intensity  -> buildVaporIntensityCmd   (vapor/set_intensity 1-6)
 *   Heat on/off      -> buildHeaterPowerCmd      (climate/power)
 *   Colour wheel     -> buildColorCmd('flame')   (lighting/set_color -> WS2805)
 *   Brightness       -> buildBrightnessCmd       (lighting/set_brightness 0-100)
 *   Music            -> buildAudioPowerCmd / buildVolumeCmd / buildTrackCmd
 *   Sleep timer      -> buildSleepTimerCmd       (timer/set_sleep seconds)
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ColorPicker from 'react-native-wheel-color-picker';
import RNSlider from '@react-native-community/slider';
import Slider from '../components/Slider';
import { useConnectionState, useManifest, usePublish, usePublishWithAck } from '../contexts/DeviceContext';
import {
  useDeviceTelemetry,
  usePower,
  useVaporOn,
  useVaporIntensity,
  useHeaterOn,
  useHeaterStage,
  useAudioOn,
  useAudioVolume,
  useSleepRemaining,
} from '../hooks/useDeviceTelemetry';
import {
  buildPowerCmd,
  buildVaporPowerCmd,
  buildVaporIntensityCmd,
  buildHeaterPowerCmd,
  buildHeaterStageCmd,
  buildColorCmd,
  buildBrightnessCmd,
  buildAudioPowerCmd,
  buildVolumeCmd,
  buildTrackCmd,
  buildSleepTimerCmd,
} from '../types/commands';

// ---- colour helpers (hex <-> rgb) ----
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
type Panel = 'color' | 'intensity' | 'brightness' | 'music' | 'timer';
const PANELS: { key: Panel; icon: string; label: string }[] = [
  { key: 'color', icon: '🎨', label: 'Colour' },
  { key: 'intensity', icon: '🔥', label: 'Intensity' },
  { key: 'brightness', icon: '☀️', label: 'Brightness' },
  { key: 'music', icon: '🎵', label: 'Music' },
  { key: 'timer', icon: '⏱️', label: 'Timer' },
];

export default function HomeScreen() {
  const manifest = useManifest();
  const connected = useConnectionState() === 'connected';
  const power = usePower();
  const vaporOn = useVaporOn();
  const vaporIntensity = useVaporIntensity();
  const heaterOn = useHeaterOn();
  const heaterStage = useHeaterStage();
  const audioOn = useAudioOn();
  const audioVolume = useAudioVolume();
  const sleepRemaining = useSleepRemaining();
  const flame = useDeviceTelemetry((t) => t?.lighting?.flame ?? null);
  const publish = usePublish();
  const publishWithAck = usePublishWithAck();

  const [mode, setMode] = useState<'flame' | 'heat'>('flame');
  const [panel, setPanel] = useState<Panel>('color');
  const [colorOverride, setColorOverride] = useState<string | null>(null);
  const [intensityOverride, setIntensityOverride] = useState<number | null>(null);
  const [brightnessOverride, setBrightnessOverride] = useState<number | null>(null);

  const deviceHex = flame ? rgbToHex(flame.r, flame.g, flame.b) : '#ff7a18';
  const currentHex = colorOverride ?? deviceHex;
  const intensity = intensityOverride ?? (vaporIntensity || 3);
  const brightness = brightnessOverride ?? (flame?.brightness ?? 100);
  const anythingOn = power && (vaporOn || heaterOn);

  // ---- flame flicker animation ----
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
  const toggleFlame = () =>
    vaporOn
      ? void publishWithAck(buildVaporPowerCmd(false), 6000)
      : void publishWithAck(buildVaporIntensityCmd(intensity), 6000);
  const toggleHeat = () => void publishWithAck(buildHeaterPowerCmd(!heaterOn), 6000);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>{manifest?.serialNumber ? 'Glow Fire' : 'Glow Fire'}</Text>
        </View>
        {!connected && <Text style={styles.offline}>Reconnecting to fireplace…</Text>}

        {/* Power + flame hero */}
        <View style={styles.hero}>
          <PowerButton on={power} disabled={!connected} onPress={() => void publishWithAck(buildPowerCmd(!power), 6000)} />
          <FlameViz on={vaporOn} flicker={flicker} tint={currentHex} />
        </View>

        {/* Flame / Heat mode toggle */}
        <View style={styles.segment}>
          <SegmentTab label="Flame" active={mode === 'flame'} on={vaporOn} onSelect={() => setMode('flame')} onToggle={toggleFlame} disabled={!connected} />
          <SegmentTab label="Heat" active={mode === 'heat'} on={heaterOn} onSelect={() => setMode('heat')} onToggle={toggleHeat} disabled={!connected} />
        </View>

        {mode === 'heat' ? (
          <HeatPanel
            on={heaterOn}
            stage={heaterStage}
            stages={manifest?.capabilities.climate.stages ?? 0}
            disabled={!connected}
            onStage={(s) => void publishWithAck(buildHeaterStageCmd(s), 6000)}
          />
        ) : (
          <>
            {/* Selected control panel */}
            {panel === 'color' && (
              <View style={styles.panel}>
                <Text style={styles.sectionLabel}>FLAME COLOUR</Text>
                <View style={styles.wheelRow}>
                  <View style={styles.wheelWrap}>
                    <ColorPicker
                      color={currentHex}
                      onColorChange={(c: string) => setColorOverride(c)}
                      onColorChangeComplete={(c: string) => { setColorOverride(c); sendColor(c); }}
                      thumbSize={28}
                      sliderSize={0}
                      noSnap
                      row={false}
                      swatches={false}
                    />
                  </View>
                  <View style={styles.swatchCol}>
                    {SWATCHES.map((hex) => (
                      <Pressable
                        key={hex}
                        disabled={!connected}
                        onPress={() => { setColorOverride(hex); sendColor(hex); }}
                        style={[styles.swatch, { backgroundColor: hex }, currentHex.toLowerCase() === hex.toLowerCase() && styles.swatchSelected]}
                      />
                    ))}
                  </View>
                </View>
              </View>
            )}

            {panel === 'intensity' && (
              <View style={styles.panel}>
                <Text style={styles.sectionLabel}>FLAME INTENSITY</Text>
                <Text style={styles.bigValue}>{intensity}</Text>
                <View style={styles.intensityRow}>
                  <FlameViz on tint={currentHex} flicker={flicker} big />
                  <VerticalSlider
                    value={intensity}
                    min={1}
                    max={6}
                    step={1}
                    disabled={!connected}
                    onChange={(v) => setIntensityOverride(v)}
                    onCommit={(v) => { setIntensityOverride(v); void publishWithAck(buildVaporIntensityCmd(v), 6000); }}
                  />
                </View>
                <Text style={styles.hint}>Slide to set how strong the flame runs (1–6).</Text>
              </View>
            )}

            {panel === 'brightness' && (
              <View style={styles.panel}>
                <Text style={styles.sectionLabel}>BRIGHTNESS</Text>
                <Slider
                  value={brightness}
                  min={0}
                  max={100}
                  disabled={!connected}
                  formatValue={(v) => `${Math.round(v)}%`}
                  onChange={(v) => setBrightnessOverride(v)}
                  onCommit={(v) => { setBrightnessOverride(Math.round(v)); publish(buildBrightnessCmd('flame', Math.round(v))); }}
                />
                <Text style={styles.hint}>How bright the flame lights glow.</Text>
              </View>
            )}

            {panel === 'music' && (
              <View style={styles.panel}>
                <Text style={styles.sectionLabel}>MUSIC</Text>
                <View style={styles.musicRow}>
                  <RoundBtn glyph="⏮" disabled={!connected} onPress={() => void publishWithAck(buildTrackCmd('prev'), 6000)} />
                  <RoundBtn glyph={audioOn ? '⏸' : '▶'} big accent disabled={!connected} onPress={() => void publishWithAck(buildAudioPowerCmd(!audioOn), 6000)} />
                  <RoundBtn glyph="⏭" disabled={!connected} onPress={() => void publishWithAck(buildTrackCmd('next'), 6000)} />
                </View>
                <Slider
                  value={audioVolume}
                  min={0}
                  max={10}
                  label="Volume"
                  disabled={!connected}
                  formatValue={(v) => `${Math.round(v)}`}
                  onCommit={(v) => publish(buildVolumeCmd(Math.round(v), 10))}
                />
              </View>
            )}

            {panel === 'timer' && (
              <View style={styles.panel}>
                <Text style={styles.sectionLabel}>SLEEP TIMER</Text>
                {sleepRemaining && sleepRemaining > 0 ? (
                  <>
                    <Text style={styles.bigValue}>{formatRemaining(sleepRemaining)}</Text>
                    <Pressable style={styles.cancelBtn} disabled={!connected} onPress={() => void publishWithAck(buildSleepTimerCmd(0), 6000)}>
                      <Text style={styles.cancelText}>Cancel timer</Text>
                    </Pressable>
                  </>
                ) : (
                  <View style={styles.presetRow}>
                    {[
                      { label: '30 min', s: 1800 },
                      { label: '1 hour', s: 3600 },
                      { label: '2 hours', s: 7200 },
                    ].map((p) => (
                      <Pressable key={p.s} style={styles.preset} disabled={!connected} onPress={() => void publishWithAck(buildSleepTimerCmd(p.s), 6000)}>
                        <Text style={styles.presetText}>{p.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                <Text style={styles.hint}>Turn everything off automatically after a while.</Text>
              </View>
            )}

            {/* Bottom control row */}
            <View style={styles.dock}>
              {PANELS.map((p) => (
                <Pressable key={p.key} style={[styles.dockBtn, panel === p.key && styles.dockBtnActive]} onPress={() => setPanel(p.key)}>
                  <Text style={styles.dockIcon}>{p.icon}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {!anythingOn && <Text style={styles.emptyHint}>Enable flame or heat to begin</Text>}
      </ScrollView>
    </View>
  );
}

function formatRemaining(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

// ---- Vertical slider (native slider rotated, fills from the bottom) ----
function VerticalSlider({ value, min, max, step, disabled, onChange, onCommit }: {
  value: number; min: number; max: number; step: number; disabled: boolean;
  onChange: (v: number) => void; onCommit: (v: number) => void;
}) {
  const H = 200;
  return (
    <View style={{ height: H, width: 48, alignItems: 'center', justifyContent: 'center' }}>
      <RNSlider
        style={{ width: H, height: 48, transform: [{ rotate: '-90deg' }] }}
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        disabled={disabled}
        minimumTrackTintColor={ACCENT}
        maximumTrackTintColor="#3a322d"
        thumbTintColor={ACCENT}
        onValueChange={onChange}
        onSlidingComplete={onCommit}
      />
    </View>
  );
}

function RoundBtn({ glyph, big, accent, disabled, onPress }: { glyph: string; big?: boolean; accent?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.roundBtn, big && styles.roundBtnBig, accent && styles.roundBtnAccent, disabled && styles.dim]}>
      <Text style={[styles.roundGlyph, big && styles.roundGlyphBig]}>{glyph}</Text>
    </Pressable>
  );
}

function HeatPanel({ on, stage, stages, disabled, onStage }: { on: boolean; stage: number; stages: number; disabled: boolean; onStage: (s: 1 | 2) => void }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.sectionLabel}>HEAT</Text>
      <Text style={styles.hint}>{on ? 'Heater is running.' : 'Turn on Heat above to warm the room.'}</Text>
      {on && stages >= 2 && (
        <View style={styles.presetRow}>
          {[1, 2].map((s) => (
            <Pressable key={s} style={[styles.preset, stage === s && styles.presetActive]} disabled={disabled} onPress={() => onStage(s as 1 | 2)}>
              <Text style={[styles.presetText, stage === s && styles.presetTextActive]}>{s === 1 ? '1000 W' : '2000 W'}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

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

function FlameViz({ on, flicker, tint, big }: { on: boolean; flicker: Animated.Value; tint: string; big?: boolean }) {
  const bars = [0.55, 0.8, 1, 0.85, 0.6];
  return (
    <View style={[styles.flameBox, big && styles.flameBoxBig]}>
      {on ? (
        <View style={[styles.flameRow, big && { height: 150 }]}>
          {bars.map((h, i) => {
            const scaleY = flicker.interpolate({ inputRange: [0, 1], outputRange: [h, h * (i % 2 === 0 ? 0.78 : 1.12)] });
            const opacity = flicker.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0.6] });
            return (
              <Animated.View
                key={i}
                style={[styles.flameBar, big && { width: 16, height: 130 }, { backgroundColor: tint, transform: [{ scaleY }], opacity, shadowColor: tint }]}
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

function SegmentTab({ label, active, on, onSelect, onToggle, disabled }: {
  label: string; active: boolean; on: boolean; onSelect: () => void; onToggle: () => void; disabled: boolean;
}) {
  return (
    <Pressable style={[styles.segTab, active && styles.segTabActive]} onPress={onSelect}>
      <Pressable disabled={disabled} onPress={onToggle} style={[styles.switch, on && styles.switchOn, disabled && styles.dim]}>
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
  powerOuter: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1c1714', borderWidth: 1, borderColor: '#2a2320' },
  powerOuterOn: { borderColor: ACCENT, shadowColor: ACCENT, shadowOpacity: 0.9, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 10 },
  powerInner: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#241d19' },
  powerInnerOn: { backgroundColor: '#3a2213' },
  powerGlyph: { color: '#8a7f78', fontSize: 24, fontWeight: '700' },
  powerGlyphOn: { color: ACCENT },

  flameBox: { flex: 1, height: 96, backgroundColor: '#120d0a', borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  flameBoxBig: { flex: 1, height: 170 },
  flameRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 70 },
  flameBar: { width: 10, height: 60, borderRadius: 6, shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
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

  panel: { backgroundColor: CARD, borderRadius: 18, padding: 16, gap: 14, minHeight: 180 },
  sectionLabel: { color: '#8a7f78', fontSize: 12, fontWeight: '800', letterSpacing: 1.5, textAlign: 'center' },
  bigValue: { color: '#fff', fontSize: 40, fontWeight: '800', textAlign: 'center' },
  hint: { color: '#8a7f78', fontSize: 13, textAlign: 'center' },

  wheelRow: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  wheelWrap: { flex: 1, aspectRatio: 1, maxWidth: 240 },
  swatchCol: { gap: 10, paddingVertical: 4 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: 'transparent' },
  swatchSelected: { borderColor: '#fff' },

  intensityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },

  musicRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22, paddingVertical: 4 },
  roundBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#241d19', alignItems: 'center', justifyContent: 'center' },
  roundBtnBig: { width: 64, height: 64, borderRadius: 32 },
  roundBtnAccent: { backgroundColor: ACCENT },
  roundGlyph: { color: '#fff', fontSize: 18 },
  roundGlyphBig: { fontSize: 26 },

  presetRow: { flexDirection: 'row', gap: 10 },
  preset: { flex: 1, backgroundColor: '#241d19', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  presetActive: { backgroundColor: ACCENT },
  presetText: { color: '#e7d9cf', fontWeight: '700' },
  presetTextActive: { color: '#fff' },
  cancelBtn: { borderWidth: 1, borderColor: '#dc2626', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  cancelText: { color: '#f87171', fontWeight: '700' },

  dock: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: CARD, borderRadius: 18, padding: 10 },
  dockBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 14, marginHorizontal: 2 },
  dockBtnActive: { backgroundColor: ACCENT },
  dockIcon: { fontSize: 20 },

  emptyHint: { color: '#6b6058', fontSize: 14, textAlign: 'center', marginTop: 8 },
  dim: { opacity: 0.4 },
});

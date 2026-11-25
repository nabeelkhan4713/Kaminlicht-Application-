/**
 * HomeScreen — the "Glow Fire" dark flame screen (design v3).
 *
 * Dark premium theme matching the mockups. A Flame/Heat toggle, a glowing power
 * button and a real SVG flame. A bottom control dock swaps the panel above it:
 *   Colour · Intensity · Brightness · Music · Presets · Timer.
 *
 * Everything is wired to REAL firmware commands:
 *   Power            -> buildPowerCmd            (system/power)
 *   Flame on/off     -> buildVaporPowerCmd       (vapor/power)
 *   Flame intensity  -> buildVaporIntensityCmd   (vapor/set_intensity 1-6)
 *   Heat on/off      -> buildHeaterPowerCmd      (climate/power)
 *   Colour / presets -> buildColorCmd('flame')   (lighting/set_color)
 *   Brightness       -> buildBrightnessCmd       (lighting/set_brightness)
 *   Music            -> buildAudioPowerCmd / buildVolumeCmd / buildTrackCmd
 *   Timer            -> buildSleepTimerCmd        (timer/set_sleep)
 */
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import ColorPicker from 'react-native-wheel-color-picker';
import FlameGraphic from '../components/FlameGraphic';
import VerticalSlider from '../components/VerticalSlider';
import Slider from '../components/Slider';
import CircularDial from '../components/CircularDial';
import RotaryDial from '../components/RotaryDial';
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
  useAudioTrackIndex,
  useSleepRemaining,
  useBlower1On,
  useBlower1Speed,
  useBlower2On,
  useBlower2Speed,
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
  buildSetTrackCmd,
  buildSleepTimerCmd,
  buildBlowerPowerCmd,
  buildBlowerSpeedCmd,
} from '../types/commands';
import { ColorPresetStorage, type ColorPreset } from '../services/ColorPresetStorage';

// ---- colour helpers ----
function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r: number, g: number, b: number) {
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

const SWATCHES = ['#ff7a18', '#e85d13', '#ffd21e', '#e01e1e', '#3b82f6', '#a855f7', '#10b981'];
const FACTORY: { name: string; hex: string }[] = [
  { name: 'Classic Ember', hex: '#ff7a18' },
  { name: 'Inferno', hex: '#e01e1e' },
  { name: 'Blue Frost', hex: '#3b82f6' },
  { name: 'Aurora', hex: '#a855f7' },
];
const audioName = (index: number) => `Kamin Fire Audio ${index + 1}`;
const MAX_TIMER_MIN = 8 * 60;

type Panel = 'color' | 'intensity' | 'brightness' | 'music' | 'presets' | 'timer';
const DOCK: { key: Panel; icon: string }[] = [
  { key: 'color', icon: '🎨' },
  { key: 'intensity', icon: '🔥' },
  { key: 'brightness', icon: '☀️' },
  { key: 'music', icon: '🎵' },
  { key: 'presets', icon: '✨' },
  { key: 'timer', icon: '⏱️' },
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
  const audioTrackIndex = useAudioTrackIndex();
  const sleepRemaining = useSleepRemaining();
  const blower1On = useBlower1On();
  const blower1Speed = useBlower1Speed();
  const blower2On = useBlower2On();
  const blower2Speed = useBlower2Speed();
  const blowerCount = manifest?.capabilities.blowers.count ?? 0;
  const flame = useDeviceTelemetry((t) => t?.lighting?.flame ?? null);
  const publish = usePublish();
  const publishWithAck = usePublishWithAck();

  const serial = manifest?.serialNumber ?? 'default';
  const [mode, setMode] = useState<'flame' | 'heat'>('flame');
  const [panel, setPanel] = useState<Panel>('color');
  const [colorOverride, setColorOverride] = useState<string | null>(null);
  const [intensityOverride, setIntensityOverride] = useState<number | null>(null);
  const [brightnessOverride, setBrightnessOverride] = useState<number | null>(null);
  const [custom, setCustom] = useState<ColorPreset[]>([]);
  const [timerMin, setTimerMin] = useState(60);
  const [saveOpen, setSaveOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  // Which parts of the current mood to include when saving a preset.
  const [incBrightness, setIncBrightness] = useState(true);
  const [incFlame, setIncFlame] = useState(true);
  const [incSound, setIncSound] = useState(true);

  useEffect(() => {
    void ColorPresetStorage.load(serial).then(setCustom);
  }, [serial]);

  const deviceHex = flame ? rgbToHex(flame.r, flame.g, flame.b) : '#ff7a18';
  const currentHex = colorOverride ?? deviceHex;
  const intensity = intensityOverride ?? (vaporIntensity || 3);
  const brightness = brightnessOverride ?? (flame?.brightness ?? 100);
  const anythingOn = power && (vaporOn || heaterOn);

  // Live, throttled sends while a slider is dragged: ~8/sec so the fireplace
  // follows the finger without flooding the Wi-Fi link.
  const lastSent = useRef(0);
  const livePublish = (cmd: ReturnType<typeof buildColorCmd>, apply?: () => void) => {
    const now = Date.now();
    if (now - lastSent.current >= 100) {
      lastSent.current = now;
      publish(cmd);
      apply?.(); // throttle the state update too, so the screen doesn't re-render on every finger move
    }
  };

  const sendColor = (hex: string) => { const { r, g, b } = hexToRgb(hex); publish(buildColorCmd('flame', { r, g, b })); };
  const applyColor = (hex: string) => { setColorOverride(hex); sendColor(hex); };
  const toggleFlame = () =>
    vaporOn ? void publishWithAck(buildVaporPowerCmd(false), 6000) : void publishWithAck(buildVaporIntensityCmd(intensity), 6000);
  const toggleHeat = () => void publishWithAck(buildHeaterPowerCmd(!heaterOn), 6000);

  // Save the whole current mood: colour + brightness + flame intensity + the playing sound.
  const saveCurrent = async (name: string) => {
    const { r, g, b } = hexToRgb(currentHex);
    const label = name.trim() || `Custom ${custom.length + 1}`;
    const scene: ColorPreset = {
      id: `c-${Date.now()}`,
      name: label,
      color: { r, g, b },
      brightness: incBrightness ? Math.round(brightness) : undefined,
      intensity: incFlame ? intensity : undefined,
      track: incSound && audioOn ? (audioTrackIndex ?? 0) : undefined,
    };
    const next = [...custom, scene].slice(-8);
    setCustom(next);
    await ColorPresetStorage.save(serial, next);
  };

  // Apply a saved scene: colour, then brightness / flame intensity / sound if the preset has them.
  const applyScene = (p: ColorPreset) => {
    applyColor(rgbToHex(p.color.r, p.color.g, p.color.b));
    if (p.brightness != null) { setBrightnessOverride(p.brightness); publish(buildBrightnessCmd('flame', p.brightness)); }
    if (p.intensity != null) { setIntensityOverride(p.intensity); publish(buildVaporIntensityCmd(p.intensity)); }
    if (p.track != null) void publishWithAck(buildSetTrackCmd(p.track), 6000);
  };
  const deletePreset = async (id: string) => {
    const next = custom.filter((p) => p.id !== id);
    setCustom(next);
    await ColorPresetStorage.save(serial, next);
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.title}>Glow Fire</Text>
        </View>
        {!connected && <Text style={styles.offline}>Reconnecting to fireplace…</Text>}

        <View style={styles.hero}>
          <PowerButton on={power} disabled={!connected} onPress={() => void publishWithAck(buildPowerCmd(!power), 6000)} />
          <View style={styles.heroFlame}><FlameGraphic on={vaporOn} tint={currentHex} /></View>
        </View>

        <View style={styles.segment}>
          <SegmentTab label="Flame" active={mode === 'flame'} on={vaporOn} onSelect={() => setMode('flame')} onToggle={toggleFlame} disabled={!connected} />
          <SegmentTab label="Heat" active={mode === 'heat'} on={heaterOn} onSelect={() => setMode('heat')} onToggle={toggleHeat} disabled={!connected} />
        </View>

        {mode === 'heat' ? (
          <View style={styles.panel}>
            <Text style={styles.sectionLabel}>HEAT</Text>
            {/* Clear heater on/off (same as the Heat toggle up top, but obvious here) */}
            <View style={styles.rowBetween}>
              <Text style={styles.rowLabel}>Heater</Text>
              <TogglePill on={heaterOn} disabled={!connected} onPress={toggleHeat} />
            </View>
            <Text style={styles.hint}>{heaterOn ? 'Heater is running.' : 'Turn the heater on to warm the room.'}</Text>
            {heaterOn && (manifest?.capabilities.climate.stages ?? 0) >= 2 && (
              <>
                <Text style={styles.subLabel}>Power level</Text>
                <View style={styles.presetRow}>
                  {[1, 2].map((s) => (
                    <Pressable key={s} style={[styles.chip, heaterStage === s && styles.chipActive]} disabled={!connected} onPress={() => void publishWithAck(buildHeaterStageCmd(s as 1 | 2), 6000)}>
                      <Text style={[styles.chipText, heaterStage === s && styles.chipTextActive]}>{s === 1 ? '1000 W' : '2000 W'}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            {/* Vapour (mist maker): ON = full, OFF = off */}
            <View style={styles.divider} />
            <View style={styles.rowBetween}>
              <Text style={styles.rowLabel}>Vapour</Text>
              <TogglePill on={vaporOn} disabled={!connected} onPress={toggleFlame} />
            </View>
            <Text style={styles.hint}>On runs the mist at full; off stops it.</Text>

            {/* Blowers: on/off + speed slider */}
            {blowerCount > 0 && (
              <>
                <View style={styles.divider} />
                <BlowerControl id={1} on={blower1On} speed={blower1Speed} disabled={!connected}
                  onToggle={(v) => void publishWithAck(buildBlowerPowerCmd(1, v), 6000)}
                  onLiveSpeed={(p) => livePublish(buildBlowerSpeedCmd(1, p))}
                  onSpeed={(p) => publish(buildBlowerSpeedCmd(1, p))} />
                {blowerCount > 1 && (
                  <BlowerControl id={2} on={blower2On} speed={blower2Speed} disabled={!connected}
                    onToggle={(v) => void publishWithAck(buildBlowerPowerCmd(2, v), 6000)}
                    onLiveSpeed={(p) => livePublish(buildBlowerSpeedCmd(2, p))}
                    onSpeed={(p) => publish(buildBlowerSpeedCmd(2, p))} />
                )}
              </>
            )}
          </View>
        ) : (
          <>
            {panel === 'color' && (
              <View style={styles.panel}>
                <Text style={styles.sectionLabel}>FLAME COLOUR</Text>
                <View style={styles.wheelRow}>
                  <View style={styles.wheelWrap}>
                    <ColorPicker color={currentHex} onColorChange={(c) => { const { r, g, b } = hexToRgb(c); livePublish(buildColorCmd('flame', { r, g, b }), () => setColorOverride(c)); }} onColorChangeComplete={applyColor} thumbSize={28} sliderSize={0} noSnap row={false} swatches={false} />
                  </View>
                  <View style={styles.swatchCol}>
                    {SWATCHES.map((hex) => (
                      <Pressable key={hex} disabled={!connected} onPress={() => applyColor(hex)} style={[styles.swatch, { backgroundColor: hex }, currentHex.toLowerCase() === hex.toLowerCase() && styles.swatchSelected]} />
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
                  <View style={styles.intensityFlame}><FlameGraphic on tint={currentHex} big /></View>
                  <VerticalSlider value={intensity} min={1} max={6} step={1} height={200} disabled={!connected}
                    onChange={(v) => livePublish(buildVaporIntensityCmd(v), () => setIntensityOverride(v))}
                    onCommit={(v) => { setIntensityOverride(v); publish(buildVaporIntensityCmd(v)); }} />
                </View>
                <Text style={styles.hint}>Slide to set how strong the flame runs (1–6).</Text>
              </View>
            )}

            {panel === 'brightness' && (
              <View style={styles.panel}>
                <Text style={styles.sectionLabel}>BRIGHTNESS</Text>
                <Text style={styles.bigValue}>{Math.round(brightness)}%</Text>
                <View style={styles.centerRow}>
                  <VerticalSlider value={brightness} min={0} max={100} step={1} height={200} disabled={!connected}
                    onChange={(v) => livePublish(buildBrightnessCmd('flame', Math.round(v)), () => setBrightnessOverride(Math.round(v)))}
                    onCommit={(v) => { setBrightnessOverride(Math.round(v)); publish(buildBrightnessCmd('flame', Math.round(v))); }} />
                </View>
                <Text style={styles.hint}>How bright the flame lights glow.</Text>
              </View>
            )}

            {panel === 'music' && (
              <View style={styles.panel}>
                <Text style={styles.sectionLabel}>SOUNDS</Text>
                <View style={styles.nowPlaying}>
                  <View style={styles.albumArt}><Text style={{ fontSize: 30 }}>🔥</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.npName}>{audioName(audioTrackIndex ?? 0)}</Text>
                    <Text style={styles.npState}>{audioOn ? 'Playing' : 'Paused'}</Text>
                  </View>
                </View>
                <View style={styles.musicRow}>
                  <RoundBtn glyph="⏮" disabled={!connected} onPress={() => void publishWithAck(buildTrackCmd('prev'), 6000)} />
                  <RoundBtn glyph={audioOn ? '⏸' : '▶'} big accent disabled={!connected} onPress={() => void publishWithAck(buildAudioPowerCmd(!audioOn), 6000)} />
                  <RoundBtn glyph="⏭" disabled={!connected} onPress={() => void publishWithAck(buildTrackCmd('next'), 6000)} />
                </View>
                <Slider value={audioVolume} min={0} max={10} label="Volume" disabled={!connected} formatValue={(v) => `${Math.round(v)}`} onChange={(v) => livePublish(buildVolumeCmd(Math.round(v), 10))} onCommit={(v) => publish(buildVolumeCmd(Math.round(v), 10))} />
                <Text style={styles.hint}>Use ⏭ / ⏮ to change sound. Names follow the track number on the controller.</Text>
              </View>
            )}

            {panel === 'presets' && (
              <View style={styles.panel}>
                <Text style={styles.sectionLabel}>PRESETS</Text>
                <Text style={styles.subLabel}>Factory</Text>
                <View style={styles.presetWrap}>
                  {FACTORY.map((p) => (
                    <Pressable key={p.name} disabled={!connected} style={styles.presetPill} onPress={() => applyColor(p.hex)}>
                      <View style={[styles.presetDot, { backgroundColor: p.hex }]} />
                      <Text style={styles.presetName}>{p.name}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.subLabel}>Custom</Text>
                <View style={styles.presetWrap}>
                  {custom.map((p) => (
                    <Pressable key={p.id} disabled={!connected} style={styles.presetPill}
                      onPress={() => applyScene(p)}
                      onLongPress={() => void deletePreset(p.id)}>
                      <View style={[styles.presetDot, { backgroundColor: rgbToHex(p.color.r, p.color.g, p.color.b) }]} />
                      <Text style={styles.presetName}>{p.name}</Text>
                    </Pressable>
                  ))}
                  {custom.length < 8 && (
                    <Pressable style={styles.saveSlot} onPress={() => { setPresetName(''); setIncBrightness(true); setIncFlame(true); setIncSound(true); setSaveOpen(true); }}>
                      <Text style={styles.saveText}>＋ Save current colour</Text>
                    </Pressable>
                  )}
                </View>
                <Text style={styles.hint}>Saves the current mood — colour, brightness, flame & sound. Long-press a custom preset to delete.</Text>
              </View>
            )}

            {panel === 'timer' && (
              <View style={styles.panel}>
                <Text style={styles.sectionLabel}>TIMER · FLAME</Text>
                {sleepRemaining && sleepRemaining > 0 ? (
                  <>
                    <CircularDial progress={sleepRemaining / (MAX_TIMER_MIN * 60)}>
                      <Text style={styles.dialValue}>{formatHM(sleepRemaining)}</Text>
                      <Text style={styles.dialLabel}>REMAINING</Text>
                    </CircularDial>
                    <Pressable style={styles.cancelBtn} disabled={!connected} onPress={() => void publishWithAck(buildSleepTimerCmd(0), 6000)}>
                      <Text style={styles.cancelText}>Cancel timer</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <View style={styles.centerRow}>
                      <RotaryDial value={timerMin} min={30} max={MAX_TIMER_MIN} step={15} disabled={!connected}
                        onChange={setTimerMin} onCommit={setTimerMin}>
                        <Text style={styles.dialValue}>{formatMinLabel(timerMin)}</Text>
                        <Text style={styles.dialLabel}>DURATION</Text>
                      </RotaryDial>
                    </View>
                    <Text style={styles.hint}>Drag the ring to set the time.</Text>
                    <View style={styles.timerCtrls}>
                      <Pressable style={styles.stepBtn} onPress={() => setTimerMin((m) => Math.max(30, m - 30))}>
                        <Text style={styles.stepText}>−30m</Text>
                      </Pressable>
                      <Pressable style={[styles.startBtn, !connected && styles.dim]} disabled={!connected} onPress={() => void publishWithAck(buildSleepTimerCmd(timerMin * 60), 6000)}>
                        <Text style={styles.startText}>Start</Text>
                      </Pressable>
                      <Pressable style={styles.stepBtn} onPress={() => setTimerMin((m) => Math.min(MAX_TIMER_MIN, m + 30))}>
                        <Text style={styles.stepText}>+30m</Text>
                      </Pressable>
                    </View>
                  </>
                )}
              </View>
            )}

          </>
        )}

        {!anythingOn && <Text style={styles.emptyHint}>Enable flame or heat to begin</Text>}
      </ScrollView>

      {/* Fixed control dock — outside the ScrollView so a single tap always registers. */}
      {mode === 'flame' && (
        <View style={styles.dock}>
          {DOCK.map((d) => (
            <Pressable key={d.key} style={[styles.dockBtn, panel === d.key && styles.dockBtnActive]} onPress={() => setPanel(d.key)}>
              <Text style={styles.dockIcon}>{d.icon}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Modal visible={saveOpen} transparent animationType="fade" onRequestClose={() => setSaveOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Save this scene</Text>

            {/* Colour — always included */}
            <View style={styles.sceneRow}>
              <View style={[styles.presetDot, { width: 26, height: 26, borderRadius: 13, backgroundColor: currentHex }]} />
              <Text style={styles.sceneLabel}>Colour</Text>
              <Text style={styles.sceneValue}>always</Text>
            </View>
            {/* Brightness */}
            <View style={styles.sceneRow}>
              <Text style={{ fontSize: 18 }}>☀️</Text>
              <Text style={styles.sceneLabel}>Brightness <Text style={styles.sceneValue}>{Math.round(brightness)}%</Text></Text>
              <TogglePill on={incBrightness} disabled={false} onPress={() => setIncBrightness((v) => !v)} />
            </View>
            {/* Flame intensity */}
            <View style={styles.sceneRow}>
              <Text style={{ fontSize: 18 }}>🔥</Text>
              <Text style={styles.sceneLabel}>Flame <Text style={styles.sceneValue}>level {intensity}</Text></Text>
              <TogglePill on={incFlame} disabled={false} onPress={() => setIncFlame((v) => !v)} />
            </View>
            {/* Sound — only if something is playing */}
            <View style={styles.sceneRow}>
              <Text style={{ fontSize: 18 }}>🎵</Text>
              <Text style={styles.sceneLabel}>Sound <Text style={styles.sceneValue}>{audioOn ? audioName(audioTrackIndex ?? 0) : 'nothing playing'}</Text></Text>
              <TogglePill on={incSound && audioOn} disabled={!audioOn} onPress={() => setIncSound((v) => !v)} />
            </View>

            <TextInput
              value={presetName}
              onChangeText={setPresetName}
              placeholder="e.g. Cozy Evening"
              placeholderTextColor="#6b6058"
              style={styles.modalInput}
              autoFocus
            />
            <View style={styles.modalBtns}>
              <Pressable style={styles.modalCancel} onPress={() => setSaveOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSave} onPress={() => { void saveCurrent(presetName); setSaveOpen(false); }}>
                <Text style={styles.modalSaveText}>Save preset</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function formatHM(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function formatMinLabel(min: number) {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
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

function RoundBtn({ glyph, big, accent, disabled, onPress }: { glyph: string; big?: boolean; accent?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[styles.roundBtn, big && styles.roundBtnBig, accent && styles.roundBtnAccent, disabled && styles.dim]}>
      <Text style={[styles.roundGlyph, big && styles.roundGlyphBig]}>{glyph}</Text>
    </Pressable>
  );
}

function TogglePill({ on, disabled, onPress }: { on: boolean; disabled: boolean; onPress: () => void }) {
  return (
    
    <Pressable disabled={disabled} onPress={onPress} style={[styles.pill, on && styles.pillOn, disabled && styles.dim]}>
      <Text style={styles.pillText}>{on ? 'ON' : 'OFF'}</Text>
    </Pressable>
  );
}

function BlowerControl({ id, on, speed, disabled, onToggle, onLiveSpeed, onSpeed }: {
  id: number; on: boolean; speed: number; disabled: boolean; onToggle: (v: boolean) => void; onLiveSpeed: (p: number) => void; onSpeed: (p: number) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.rowBetween}>
        <Text style={styles.rowLabel}>Blower {id}</Text>
        <TogglePill on={on} disabled={disabled} onPress={() => onToggle(!on)} />
      </View>
      <Slider value={speed} min={0} max={100} disabled={disabled || !on} formatValue={(v) => `${Math.round(v)}%`} onChange={onLiveSpeed} onCommit={onSpeed} />
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
  heroFlame: { flex: 1, height: 96, backgroundColor: '#120d0a', borderRadius: 16, overflow: 'hidden', justifyContent: 'center' },
  powerOuter: { width: 66, height: 66, borderRadius: 33, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1c1714', borderWidth: 1, borderColor: '#2a2320' },
  powerOuterOn: { borderColor: ACCENT, shadowColor: ACCENT, shadowOpacity: 0.9, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 10 },
  powerInner: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#241d19' },
  powerInnerOn: { backgroundColor: '#3a2213' },
  powerGlyph: { color: '#8a7f78', fontSize: 24, fontWeight: '700' },
  powerGlyphOn: { color: ACCENT },

  segment: { flexDirection: 'row', gap: 10, backgroundColor: CARD, borderRadius: 16, padding: 8 },
  segTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 10, borderRadius: 12 },
  segTabActive: { backgroundColor: '#241d19' },
  segLabel: { color: '#8a7f78', fontSize: 15, fontWeight: '700' },
  segLabelActive: { color: '#fff' },
  switch: { width: 42, height: 24, borderRadius: 12, backgroundColor: '#3a322d', padding: 3, justifyContent: 'center' },
  switchOn: { backgroundColor: ACCENT },
  knob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff', alignSelf: 'flex-start' },
  knobOn: { alignSelf: 'flex-end' },

  panel: { backgroundColor: CARD, borderRadius: 18, padding: 16, gap: 12, minHeight: 200, alignItems: 'stretch' },
  sectionLabel: { color: '#8a7f78', fontSize: 12, fontWeight: '800', letterSpacing: 1.5, textAlign: 'center' },
  subLabel: { color: '#6b6058', fontSize: 11, fontWeight: '800', letterSpacing: 1, marginTop: 4 },
  bigValue: { color: '#fff', fontSize: 38, fontWeight: '800', textAlign: 'center' },
  hint: { color: '#8a7f78', fontSize: 12.5, textAlign: 'center' },

  wheelRow: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  wheelWrap: { flex: 1, aspectRatio: 1, maxWidth: 240 },
  swatchCol: { gap: 10, paddingVertical: 4 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: 'transparent' },
  swatchSelected: { borderColor: '#fff' },

  intensityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24 },
  intensityFlame: { width: 150, alignItems: 'center' },
  centerRow: { alignItems: 'center' },

  musicRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22, paddingVertical: 2 },
  roundBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#241d19', alignItems: 'center', justifyContent: 'center' },
  roundBtnBig: { width: 64, height: 64, borderRadius: 32 },
  roundBtnAccent: { backgroundColor: '#fff' },
  roundGlyph: { color: '#fff', fontSize: 18 },
  roundGlyphBig: { fontSize: 26, color: '#111' },
  nowPlaying: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#1c1512', borderRadius: 14, padding: 12 },
  albumArt: { width: 56, height: 56, borderRadius: 12, backgroundColor: '#3a2213', alignItems: 'center', justifyContent: 'center' },
  npName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  npState: { color: '#8a7f78', fontSize: 13, marginTop: 2 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', backgroundColor: '#1b1613', borderRadius: 18, padding: 20, gap: 14 },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '800' },
  modalColorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modalColorLabel: { color: '#8a7f78', fontSize: 13 },
  sceneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  sceneLabel: { color: '#fff', fontSize: 15, flex: 1 },
  sceneValue: { color: '#8a7f78', fontSize: 14, fontWeight: '400' },
  modalInput: { backgroundColor: '#241d19', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 15 },
  modalBtns: { flexDirection: 'row', gap: 12 },
  modalCancel: { flex: 1, backgroundColor: '#241d19', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  modalCancelText: { color: '#e7d9cf', fontWeight: '700' },
  modalSave: { flex: 1, backgroundColor: ACCENT, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  modalSaveText: { color: '#fff', fontWeight: '800' },

  presetWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  presetPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#241d19', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 14 },
  presetDot: { width: 18, height: 18, borderRadius: 9 },
  presetName: { color: '#fff', fontWeight: '700', fontSize: 13 },
  saveSlot: { borderWidth: 1, borderColor: '#3a322d', borderStyle: 'dashed', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16, justifyContent: 'center' },
  saveText: { color: '#8a7f78', fontWeight: '700', fontSize: 13 },

  divider: { height: 1, backgroundColor: '#241d19', marginVertical: 2 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowLabel: { color: '#fff', fontSize: 15, fontWeight: '600' },
  pill: { paddingVertical: 7, paddingHorizontal: 20, borderRadius: 999, backgroundColor: '#3a322d' },
  pillOn: { backgroundColor: ACCENT },
  pillText: { color: '#fff', fontWeight: '800' },

  presetRow: { flexDirection: 'row', gap: 10 },
  chip: { flex: 1, backgroundColor: '#241d19', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  chipActive: { backgroundColor: ACCENT },
  chipText: { color: '#e7d9cf', fontWeight: '700' },
  chipTextActive: { color: '#fff' },

  dialValue: { color: '#fff', fontSize: 26, fontWeight: '800' },
  dialLabel: { color: '#8a7f78', fontSize: 11, fontWeight: '700', letterSpacing: 1, marginTop: 2 },
  timerCtrls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 6 },
  stepBtn: { backgroundColor: '#241d19', borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 },
  stepText: { color: '#e7d9cf', fontWeight: '700' },
  startBtn: { backgroundColor: ACCENT, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 28 },
  startText: { color: '#fff', fontWeight: '800' },
  cancelBtn: { borderWidth: 1, borderColor: '#dc2626', borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  cancelText: { color: '#f87171', fontWeight: '700' },

  dock: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: CARD, borderRadius: 18, padding: 8, marginHorizontal: 20, marginTop: 8, marginBottom: 10 },
  dockBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 14, marginHorizontal: 2 },
  dockBtnActive: { backgroundColor: ACCENT },
  dockIcon: { fontSize: 19 },

  emptyHint: { color: '#6b6058', fontSize: 14, textAlign: 'center', marginTop: 8 },
  dim: { opacity: 0.4 },
});


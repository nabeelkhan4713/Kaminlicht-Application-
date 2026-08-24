/**
 * Ambience screen - Flame RGB controls, FR-LGT.
 * Implements a wheel picker with saved color presets for Sprint 2.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  GestureResponderEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useCapabilities } from '../contexts/CapabilitiesContext';
import { useConnectionState, useManifest, usePublish, usePublishWithAck } from '../contexts/DeviceContext';
import { useDeviceTelemetry } from '../hooks/useDeviceTelemetry';
import { buildBrightnessCmd, buildColorCmd, buildZonePowerCmd, type MQTTCommand } from '../types/commands';
import { ColorPreset, ColorPresetStorage } from '../services/ColorPresetStorage';
import ColorWheel from '../components/ColorWheel';
import { hsvToRgb, rgbToHex, rgbToHue, type RgbColor } from '../utils/colors';
import type { LightZone } from '../schemas/manifest.schema';

const DEFAULT_PRESETS: ColorPreset[] = [
  { id: 'preset-1', name: 'Warm Glow', color: { r: 255, g: 131, b: 52 } },
  { id: 'preset-2', name: 'Ocean Blue', color: { r: 69, g: 142, b: 255 } },
  { id: 'preset-3', name: 'Lavender', color: { r: 189, g: 104, b: 255 } },
];
const MAX_PRESETS = 20;
const BRIGHTNESS_LEVELS = 6;

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function LevelSlider({
  level,
  onChange,
  onDragStart,
  onDragEnd,
}: {
  level: number;
  onChange: (level: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const [trackWidth, setTrackWidth] = useState(1);
  const [dragPercent, setDragPercent] = useState<number | null>(null);
  const trackRef = useRef<View | null>(null);
  const trackLeftRef = useRef(0);
  const dragLevelRef = useRef(level);
  const frameRef = useRef<number | null>(null);

  const percentToLevel = (percent: number) => Math.round((percent / 100) * BRIGHTNESS_LEVELS);

  const setFromPageX = (pageX: number) => {
    const clampedX = Math.max(0, Math.min(trackWidth, pageX - trackLeftRef.current));
    const rawPercent = (clampedX / trackWidth) * 100;
    const nextLevel = percentToLevel(rawPercent);

    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => setDragPercent(rawPercent));
    dragLevelRef.current = nextLevel;
  };

  const beginDrag = (event: GestureResponderEvent) => {
    onDragStart();
    trackRef.current?.measure((_x, _y, _width, _height, pageX) => {
      trackLeftRef.current = pageX;
      setFromPageX(event.nativeEvent.pageX);
    });
  };

  const finishDrag = () => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    const nextLevel = dragLevelRef.current;
    setDragPercent(null);
    onChange(nextLevel);
    onDragEnd();
  };

  const percent = dragPercent ?? (level / BRIGHTNESS_LEVELS) * 100;
  const displayLevel = dragPercent == null ? level : percentToLevel(dragPercent);

  return (
    <View style={styles.sliderWrap}>
      <View style={styles.brightnessHeader}>
        <Text style={styles.brightnessValue}>Brightness</Text>
        <Text style={styles.brightnessLevel}>Level {displayLevel}/6</Text>
      </View>
      <View
        ref={trackRef}
        style={styles.sliderTrack}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={beginDrag}
        onResponderMove={(event) => setFromPageX(event.nativeEvent.pageX)}
        onResponderRelease={finishDrag}
        onResponderTerminate={finishDrag}
      >
        <View style={styles.sliderRail}>
          <View style={[styles.sliderFill, { width: `${percent}%` }]} />
        </View>
        <View pointerEvents="none" style={[styles.sliderThumb, { left: `${percent}%` }]}>
          <View style={styles.sliderThumbCore} />
        </View>
      </View>
      <View style={styles.sliderScale}>
        {[0, 1, 2, 3, 4, 5, 6].map((tick) => (
          <TouchableOpacity key={tick} style={styles.sliderTickButton} onPress={() => onChange(tick)}>
            <Text style={[styles.sliderTick, displayLevel === tick && styles.sliderTickActive]}>{tick}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

export default function AmbienceScreen() {
  const caps = useCapabilities();
  const manifest = useManifest();
  const publish = usePublish();
  const publishWithAck = usePublishWithAck();
  const connectionState = useConnectionState();
  const zones = caps?.lighting.zones ?? [];
  const initialZone = zones[0] ?? 'flame';
  const [selectedZone, setSelectedZone] = useState<LightZone>(initialZone);
  const [hue, setHue] = useState(30);
  const [presets, setPresets] = useState<ColorPreset[]>([]);
  const [loadingPresets, setLoadingPresets] = useState(true);
  const [presetName, setPresetName] = useState('My preset');
  const [brightnessOverride, setBrightnessOverride] = useState<number | null>(null);
  const [sliderDragging, setSliderDragging] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);

  const selectedColor = useMemo(() => hsvToRgb(hue, 1, 1), [hue]);
  const selectedHex = useMemo(() => rgbToHex(selectedColor), [selectedColor]);


  const deviceColor = useDeviceTelemetry((telemetry) => {
    const lighting = telemetry?.lighting;
    if (!lighting) return null;
    return lighting[selectedZone] ? { ...lighting[selectedZone] } : null;
  });
  const deviceBrightness = deviceColor?.brightness ?? 85;
  const deviceLightOn = deviceColor?.on ?? false;
  const telemetryBrightnessLevel = Math.round((deviceBrightness / 100) * BRIGHTNESS_LEVELS);
  const brightnessLevel = brightnessOverride ?? telemetryBrightnessLevel;

  useEffect(() => {
    if (zones.length === 0) return;
    if (!zones.includes(selectedZone)) {
      setSelectedZone(zones[0]);
    }
  }, [zones, selectedZone]);

  useEffect(() => {
    if (!deviceColor) return;
    setHue(rgbToHue(deviceColor));
  }, [deviceColor?.r, deviceColor?.g, deviceColor?.b]);

  useEffect(() => {
    if (brightnessOverride !== null && telemetryBrightnessLevel === brightnessOverride) {
      setBrightnessOverride(null);
    }
  }, [brightnessOverride, telemetryBrightnessLevel]);

  useEffect(() => {
    const key = manifest?.serialNumber ?? 'default';
    let isMounted = true;

    const loadPresets = async () => {
      setLoadingPresets(true);
      const stored = await ColorPresetStorage.load(key);
      if (!isMounted) return;
      if (stored.length > 0) {
        setPresets(stored);
      } else {
        setPresets(DEFAULT_PRESETS);
        await ColorPresetStorage.save(key, DEFAULT_PRESETS);
      }
      setLoadingPresets(false);
    };

    void loadPresets();
    return () => {
      isMounted = false;
    };
  }, [manifest?.serialNumber]);

  const savePresets = async (nextPresets: ColorPreset[]) => {
    const key = manifest?.serialNumber ?? 'default';
    setPresets(nextPresets);
    await ColorPresetStorage.save(key, nextPresets);
  };

  const applyColor = () => {
    publish(buildColorCmd(selectedZone, selectedColor));
  };

  const applyBrightnessLevel = (level: number) => {
    const nextLevel = Math.max(0, Math.min(BRIGHTNESS_LEVELS, level));
    setBrightnessOverride(nextLevel);
    const brightness = Math.round((nextLevel / BRIGHTNESS_LEVELS) * 100);
    publish(buildBrightnessCmd(selectedZone, brightness));
  };

  const toggleLightPower = () => {
    publish(buildZonePowerCmd(selectedZone, !deviceLightOn));
  };

  const savePreset = async () => {
    if (presets.length >= MAX_PRESETS) {
      Alert.alert('Preset limit reached', `You can save up to ${MAX_PRESETS} presets.`);
      return;
    }
    const nextPreset: ColorPreset = {
      id: `preset-${generateId()}`,
      name: presetName.trim() || `Preset ${presets.length + 1}`,
      color: selectedColor,
    };
    await savePresets([...presets, nextPreset]);
    setPresetName('My preset');
  };

  const applyPreset = (preset: ColorPreset) => {
    setHue(rgbToHue(preset.color));
    publish(buildColorCmd(selectedZone, preset.color));
  };

  const deletePreset = async (presetId: string) => {
    const next = presets.filter((preset) => preset.id !== presetId);
    await savePresets(next);
  };

  if (zones.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.title}>Ambience</Text>
        <Text style={styles.message}>No lighting zones are available for this fireplace.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container} scrollEnabled={!sliderDragging}>
      <Text style={styles.title}>Ambience</Text>
      {connectionState !== 'connected' && (
        <Text style={styles.offline}>
          {connectionState === 'reconnecting' ? 'Reconnecting to fireplace...' : 'Fireplace offline. Waiting for Wi-Fi connection...'}
        </Text>
      )}
      {pendingCommand && <Text style={styles.notice}>Sending {pendingCommand}...</Text>}

      <View style={styles.lightPowerRow}>
        <View>
          <Text style={styles.sectionTitle}>Flame lights</Text>
          <Text style={styles.helpText}>{deviceLightOn ? 'Lights are on' : 'Lights are off'}</Text>
        </View>
        <TouchableOpacity
          style={[styles.lightPowerButton, deviceLightOn && styles.lightPowerButtonOn]}
          onPress={toggleLightPower}
        >
          <Text style={styles.lightPowerButtonText}>{deviceLightOn ? 'Turn off' : 'Turn on'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Pick a colour</Text>
      <ColorWheel hue={hue} onChangeHue={setHue} />
      <View style={styles.colorPreviewRow}>
        <View style={[styles.colorPreview, { backgroundColor: selectedHex }]} />
        <Text style={styles.colorHex}>{selectedHex}</Text>
      </View>
      <TouchableOpacity
        disabled={connectionState !== 'connected' || pendingCommand !== null}
        style={[styles.applyButton, (connectionState !== 'connected' || pendingCommand !== null) && styles.disabled]}
        onPress={applyColor}
      >
        <Text style={styles.applyButtonText}>Apply to flame</Text>
      </TouchableOpacity>

      <Text style={styles.sectionTitle}>Brightness</Text>
      <LevelSlider
        level={brightnessLevel}
        onChange={applyBrightnessLevel}
        onDragStart={() => setSliderDragging(true)}
        onDragEnd={() => setSliderDragging(false)}
      />

      <Text style={styles.sectionTitle}>Save preset</Text>
      <View style={styles.presetForm}>
        <TextInput
          style={styles.presetInput}
          value={presetName}
          onChangeText={setPresetName}
          placeholder="Preset name"
          placeholderTextColor="#9ca3af"
        />
        <TouchableOpacity style={styles.saveButton} onPress={savePreset}>
          <Text style={styles.saveButtonText}>Save</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.helpText}>{presets.length}/{MAX_PRESETS} saved</Text>

      <Text style={styles.sectionTitle}>Presets</Text>
      {loadingPresets ? (
        <ActivityIndicator color="#ea580c" />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetsRow}>
          {presets.map((preset) => (
            <TouchableOpacity
              key={preset.id}
              style={styles.presetCard}
              onPress={() => applyPreset(preset)}
              onLongPress={() =>
                Alert.alert('Delete preset', `Delete "${preset.name}"?`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => void deletePreset(preset.id) },
                ])
              }
            >
              <View style={[styles.presetSwatch, { backgroundColor: rgbToHex(preset.color) }]} />
              <Text style={styles.presetName}>{preset.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    gap: 16,
    backgroundColor: '#fff',
  },
  emptyContainer: {
    flex: 1,
    padding: 16,
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 4,
  },
  message: {
    color: '#6b7280',
    fontSize: 15,
  },
  offline: {
    backgroundColor: '#fee2e2',
    color: '#991b1b',
    padding: 10,
    borderRadius: 8,
    textAlign: 'center',
  },
  notice: {
    backgroundColor: '#eff6ff',
    color: '#1d4ed8',
    padding: 10,
    borderRadius: 8,
    textAlign: 'center',
  },
  zoneRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  zoneButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 999,
    backgroundColor: '#f8fafc',
  },
  zoneButtonActive: {
    borderColor: '#ea580c',
    backgroundColor: '#ffedd5',
  },
  zoneLabel: {
    color: '#374151',
    fontWeight: '600',
  },
  zoneLabelActive: {
    color: '#b45309',
  },
  lightPowerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  lightPowerButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#71717a',
  },
  lightPowerButtonOn: {
    backgroundColor: '#ea580c',
  },
  lightPowerButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.45,
  },
  colorPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  colorPreview: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  colorHex: {
    fontSize: 16,
    fontWeight: '600',
  },
  applyButton: {
    backgroundColor: '#ea580c',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  applyButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  brightnessHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brightnessValue: {
    color: '#374151',
    fontWeight: '700',
  },
  brightnessLevel: {
    color: '#ea580c',
    fontWeight: '800',
  },
  sliderWrap: {
    gap: 10,
  },
  sliderTrack: {
    height: 54,
    justifyContent: 'center',
  },
  sliderRail: {
    height: 12,
    borderRadius: 999,
    backgroundColor: '#e5e7eb',
    overflow: 'hidden',
  },
  sliderFill: {
    height: 12,
    borderRadius: 999,
    backgroundColor: '#ea580c',
  },
  sliderThumb: {
    position: 'absolute',
    top: 9,
    width: 36,
    height: 36,
    marginLeft: -18,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#ea580c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliderThumbCore: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#ea580c',
  },
  sliderScale: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -2,
  },
  sliderTickButton: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliderTick: {
    color: '#6b7280',
    fontSize: 13,
    fontWeight: '700',
  },
  sliderTickActive: {
    color: '#ea580c',
  },
  presetForm: {
    flexDirection: 'row',
    gap: 10,
  },
  presetInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: 12,
    color: '#111827',
    backgroundColor: '#f9fafb',
  },
  saveButton: {
    backgroundColor: '#ea580c',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  saveButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  helpText: {
    color: '#6b7280',
    fontSize: 13,
  },
  presetsRow: {
    flexDirection: 'row',
    paddingTop: 4,
    gap: 12,
  },
  presetCard: {
    width: 96,
    borderRadius: 16,
    backgroundColor: '#f8fafc',
    padding: 12,
    alignItems: 'center',
    gap: 8,
  },
  presetSwatch: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  presetName: {
    color: '#374151',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});














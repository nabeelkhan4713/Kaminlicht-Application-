/**
 * Slider — thin wrapper around the native OS slider (@react-native-community/slider),
 * the same control phones use for volume / brightness. It drags smoothly and reliably
 * on real hardware (no manual touch math).
 *
 * We keep the UI live while dragging (onValueChange) but only send to the device on
 * release (onSlidingComplete) so we don't flood MQTT mid-drag.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import RNSlider from '@react-native-community/slider';

interface SliderProps {
  value: number;                       // current value (min..max)
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  label?: string;                      // left caption, e.g. "Brightness"
  formatValue?: (v: number) => string; // right caption, e.g. (v) => `${v}%`
  onChange?: (v: number) => void;      // fires continuously while dragging (UI only)
  onCommit: (v: number) => void;       // fires once on release (send to device)
}

const ACCENT = '#ea580c';

export default function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  label,
  formatValue,
  onChange,
  onCommit,
}: SliderProps) {
  // While the user drags, show the live finger value instead of the device value.
  const [dragValue, setDragValue] = useState<number | null>(null);
  const shown = dragValue ?? value;
  const clampedShown = Math.max(min, Math.min(max, shown));

  return (
    <View style={styles.wrap}>
      {(label != null || formatValue != null) && (
        <View style={styles.header}>
          {label != null && <Text style={styles.label}>{label}</Text>}
          {formatValue != null && <Text style={styles.value}>{formatValue(clampedShown)}</Text>}
        </View>
      )}
      <RNSlider
        style={styles.slider}
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={clampedShown}
        disabled={disabled}
        minimumTrackTintColor={disabled ? '#d4d4d8' : ACCENT}
        maximumTrackTintColor="#e4e4e7"
        thumbTintColor={disabled ? '#d4d4d8' : ACCENT}
        onValueChange={(v) => {
          setDragValue(v);
          onChange?.(v);
        }}
        onSlidingComplete={(v) => {
          setDragValue(null);
          onCommit(v);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, paddingVertical: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { fontSize: 15, color: '#444', fontWeight: '600' },
  value: { fontSize: 15, color: ACCENT, fontWeight: '800', fontVariant: ['tabular-nums'] },
  // Native slider gets a tall touch area on Android automatically; give it room.
  slider: { width: '100%', height: 40 },
});

/**
 * Slider — a smooth, draggable slider (premium feel: thin track, accent fill, a raised thumb).
 * Drag updates the UI live; the value is committed (sent to the device) on release so we
 * don't flood MQTT mid-drag. Built on PanResponder — no native slider dependency.
 */
import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';

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
  const trackRef = useRef<View | null>(null);
  const widthRef = useRef(1);
  const leftRef = useRef(0);
  const [dragValue, setDragValue] = useState<number | null>(null);

  const shown = dragValue ?? value;
  const clampedShown = Math.max(min, Math.min(max, shown));
  const percent = ((clampedShown - min) / (max - min)) * 100;

  const valueFromPageX = (pageX: number) => {
    const ratio = (pageX - leftRef.current) / Math.max(1, widthRef.current);
    const raw = min + ratio * (max - min);
    const stepped = Math.round(raw / step) * step;
    return Math.max(min, Math.min(max, stepped));
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (e) => {
        trackRef.current?.measure((_x, _y, _w, _h, pageX) => {
          leftRef.current = pageX;
          const v = valueFromPageX(e.nativeEvent.pageX);
          setDragValue(v);
          onChange?.(v);
        });
      },
      onPanResponderMove: (e) => {
        const v = valueFromPageX(e.nativeEvent.pageX);
        setDragValue(v);
        onChange?.(v);
      },
      onPanResponderRelease: () =>
        setDragValue((current) => {
          if (current != null) onCommit(current);
          return null;
        }),
      onPanResponderTerminate: () =>
        setDragValue((current) => {
          if (current != null) onCommit(current);
          return null;
        }),
    }),
  ).current;

  return (
    <View style={styles.wrap}>
      {(label != null || formatValue != null) && (
        <View style={styles.header}>
          {label != null && <Text style={styles.label}>{label}</Text>}
          {formatValue != null && <Text style={styles.value}>{formatValue(clampedShown)}</Text>}
        </View>
      )}
      <View
        ref={trackRef}
        style={styles.touch}
        onLayout={(ev) => (widthRef.current = ev.nativeEvent.layout.width)}
        {...responder.panHandlers}
      >
        <View style={[styles.track, disabled && styles.disabled]}>
          <View style={[styles.fill, { width: `${percent}%` }, disabled && styles.fillDisabled]} />
        </View>
        <View
          pointerEvents="none"
          style={[styles.thumb, { left: `${percent}%` }, dragValue != null && styles.thumbActive, disabled && styles.disabled]}
        />
      </View>
    </View>
  );
}

const ACCENT = '#ea580c';

const styles = StyleSheet.create({
  wrap: { gap: 8, paddingVertical: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { fontSize: 15, color: '#444', fontWeight: '600' },
  value: { fontSize: 15, color: ACCENT, fontWeight: '800', fontVariant: ['tabular-nums'] },
  // Taller touch row than the visible track, so it's easy to grab.
  touch: { height: 40, justifyContent: 'center' },
  track: { height: 8, borderRadius: 4, backgroundColor: '#e4e4e7', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: ACCENT },
  fillDisabled: { backgroundColor: '#d4d4d8' },
  thumb: {
    position: 'absolute',
    width: 26,
    height: 26,
    borderRadius: 13,
    marginLeft: -13,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: ACCENT,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  thumbActive: { transform: [{ scale: 1.15 }], borderColor: '#c2410c' },
  disabled: { opacity: 0.4 },
});

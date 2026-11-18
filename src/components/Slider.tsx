/**
 * Slider — responsive horizontal slider (PanResponder, captures the gesture before
 * the parent ScrollView so it tracks your finger instantly). Drag updates live;
 * the value is committed on release so MQTT isn't flooded mid-drag.
 */
import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';

interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  label?: string;
  formatValue?: (v: number) => string;
  onChange?: (v: number) => void;
  onCommit: (v: number) => void;
}

const ACCENT = '#f97316';

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
  const ref = useRef<View | null>(null);
  const leftRef = useRef(0);
  const widthRef = useRef(1);
  const [drag, setDrag] = useState<number | null>(null);

  const shown = drag ?? value;
  const clamped = Math.max(min, Math.min(max, shown));
  const pct = ((clamped - min) / (max - min)) * 100;

  // Keep the latest props in a ref so the (once-created) PanResponder never acts on a
  // stale `disabled`/callback. Without this, a slider that started disabled (e.g. the
  // blower slider while the blower is off) would stay unresponsive after being enabled.
  const latest = useRef({ disabled, min, max, step, onChange, onCommit });
  latest.current = { disabled, min, max, step, onChange, onCommit };

  const valueFromPageX = (pageX: number) => {
    const p = latest.current;
    const ratio = (pageX - leftRef.current) / Math.max(1, widthRef.current);
    const raw = p.min + ratio * (p.max - p.min);
    const stepped = Math.round(raw / p.step) * p.step;
    return Math.max(p.min, Math.min(p.max, stepped));
  };
  const measure = (after?: () => void) =>
    ref.current?.measureInWindow((x, _y, w) => {
      leftRef.current = x;
      if (w) widthRef.current = w;
      after?.();
    });

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !latest.current.disabled,
      onStartShouldSetPanResponderCapture: () => !latest.current.disabled,
      onMoveShouldSetPanResponder: () => !latest.current.disabled,
      onMoveShouldSetPanResponderCapture: () => !latest.current.disabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const px = e.nativeEvent.pageX;
        measure(() => {
          const v = valueFromPageX(px);
          setDrag(v);
          latest.current.onChange?.(v);
        });
      },
      onPanResponderMove: (e) => {
        const v = valueFromPageX(e.nativeEvent.pageX);
        setDrag(v);
        latest.current.onChange?.(v);
      },
      onPanResponderRelease: () =>
        setDrag((cur) => {
          if (cur != null) latest.current.onCommit(cur);
          return null;
        }),
      onPanResponderTerminate: () =>
        setDrag((cur) => {
          if (cur != null) latest.current.onCommit(cur);
          return null;
        }),
    }),
  ).current;

  return (
    <View style={styles.wrap}>
      {(label != null || formatValue != null) && (
        <View style={styles.header}>
          {label != null && <Text style={styles.label}>{label}</Text>}
          {formatValue != null && <Text style={styles.value}>{formatValue(clamped)}</Text>}
        </View>
      )}
      <View
        ref={ref}
        onLayout={() => measure()}
        style={[styles.touch, disabled && styles.disabled]}
        {...responder.panHandlers}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${pct}%` }]} />
        </View>
        <View style={[styles.thumb, { left: `${pct}%` }]} pointerEvents="none" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, paddingVertical: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  label: { fontSize: 15, color: '#c9bcb3', fontWeight: '600' },
  value: { fontSize: 15, color: ACCENT, fontWeight: '800', fontVariant: ['tabular-nums'] },
  touch: { height: 44, justifyContent: 'center' },
  track: { height: 10, borderRadius: 5, backgroundColor: '#3a322d', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5, backgroundColor: ACCENT },
  thumb: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    marginLeft: -14,
    backgroundColor: '#fff',
    borderWidth: 3,
    borderColor: ACCENT,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  disabled: { opacity: 0.4 },
});

/**
 * VerticalSlider — a tall, finger-friendly slider that fills from the bottom.
 *
 * Built on PanResponder with a wide (64px) touch column, so it's easy to grab
 * anywhere — unlike a rotated native slider, whose hit area is cramped. Drag
 * updates the UI live (onChange); the value is sent on release (onCommit).
 */
import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  height?: number;
  trackColor?: string;
  fillColor?: string;
  onChange?: (v: number) => void;
  onCommit: (v: number) => void;
}

export default function VerticalSlider({
  value,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  height = 220,
  trackColor = '#3a322d',
  fillColor = '#f97316',
  onChange,
  onCommit,
}: Props) {
  const ref = useRef<View | null>(null);
  const topRef = useRef(0);
  const hRef = useRef(height);
  const [drag, setDrag] = useState<number | null>(null);

  const shown = drag ?? value;
  const clamped = Math.max(min, Math.min(max, shown));
  const pct = (clamped - min) / (max - min);

  const valueFromPageY = (pageY: number) => {
    const ratio = 1 - (pageY - topRef.current) / Math.max(1, hRef.current);
    const raw = min + ratio * (max - min);
    const stepped = Math.round(raw / step) * step;
    return Math.max(min, Math.min(max, stepped));
  };

  const measure = (after?: () => void) =>
    ref.current?.measureInWindow((_x, y, _w, h) => {
      topRef.current = y;
      if (h) hRef.current = h;
      after?.();
    });

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (e) => {
        const py = e.nativeEvent.pageY;
        measure(() => {
          const v = valueFromPageY(py);
          setDrag(v);
          onChange?.(v);
        });
      },
      onPanResponderMove: (e) => {
        const v = valueFromPageY(e.nativeEvent.pageY);
        setDrag(v);
        onChange?.(v);
      },
      onPanResponderRelease: () =>
        setDrag((cur) => {
          if (cur != null) onCommit(cur);
          return null;
        }),
      onPanResponderTerminate: () =>
        setDrag((cur) => {
          if (cur != null) onCommit(cur);
          return null;
        }),
    }),
  ).current;

  return (
    <View
      ref={ref}
      onLayout={() => measure()}
      style={[styles.wrap, { height, opacity: disabled ? 0.4 : 1 }]}
      {...responder.panHandlers}
    >
      <View style={[styles.track, { backgroundColor: trackColor }]}>
        <View style={[styles.fill, { height: `${pct * 100}%`, backgroundColor: fillColor }]} />
      </View>
      <View style={[styles.thumb, { bottom: `${pct * 100}%` }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 64, alignItems: 'center', justifyContent: 'center' },
  track: { width: 14, flex: 1, borderRadius: 8, overflow: 'hidden', justifyContent: 'flex-end' },
  fill: { width: '100%', borderRadius: 8 },
  thumb: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    marginBottom: -15,
    backgroundColor: '#fff',
    borderWidth: 3,
    borderColor: '#f97316',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});

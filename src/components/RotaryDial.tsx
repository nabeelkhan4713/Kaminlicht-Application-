/**
 * RotaryDial — a circular knob you drag clockwise to set a value (used by the
 * sleep timer). Drag anywhere on the ring; the handle follows your finger.
 * Live value via onChange, committed on release via onCommit.
 */
import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  disabled?: boolean;
  onChange?: (v: number) => void;
  onCommit: (v: number) => void;
  children?: React.ReactNode;
}

export default function RotaryDial({
  value,
  min = 0,
  max = 480,
  step = 15,
  size = 200,
  stroke = 14,
  color = '#f97316',
  track = '#241d19',
  disabled = false,
  onChange,
  onCommit,
  children,
}: Props) {
  const ref = useRef<View | null>(null);
  const centre = useRef({ x: 0, y: 0 });
  const [drag, setDrag] = useState<number | null>(null);

  const shown = drag ?? value;
  const clamped = Math.max(min, Math.min(max, shown));
  const p = (clamped - min) / (max - min);

  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const theta = p * 2 * Math.PI; // from top, clockwise
  const handleX = size / 2 + r * Math.sin(theta);
  const handleY = size / 2 - r * Math.cos(theta);

  const measure = (after?: () => void) =>
    ref.current?.measureInWindow((x, y, w, h) => {
      centre.current = { x: x + w / 2, y: y + h / 2 };
      after?.();
    });

  const valueFromTouch = (pageX: number, pageY: number) => {
    const dx = pageX - centre.current.x;
    const dy = pageY - centre.current.y;
    let angle = Math.atan2(dx, -dy); // 0 at top, clockwise, range -PI..PI
    if (angle < 0) angle += 2 * Math.PI;
    const raw = min + (angle / (2 * Math.PI)) * (max - min);
    const stepped = Math.round(raw / step) * step;
    const next = Math.max(min, Math.min(max, stepped));
    // Guard against a wild min<->max flip when crossing the bottom gap.
    if (drag != null && Math.abs(next - drag) > (max - min) / 2) return drag;
    return next;
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onStartShouldSetPanResponderCapture: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponderCapture: () => !disabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { pageX, pageY } = e.nativeEvent;
        measure(() => {
          const v = valueFromTouch(pageX, pageY);
          setDrag(v);
          onChange?.(v);
        });
      },
      onPanResponderMove: (e) => {
        const v = valueFromTouch(e.nativeEvent.pageX, e.nativeEvent.pageY);
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
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}
      {...responder.panHandlers}
    >
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} />
      </Svg>
      <View pointerEvents="none" style={[styles.handle, { left: handleX - 15, top: handleY - 15, borderColor: color }]} />
      <View pointerEvents="none" style={{ alignItems: 'center', justifyContent: 'center' }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  handle: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#fff',
    borderWidth: 4,
  },
});

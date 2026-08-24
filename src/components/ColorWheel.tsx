import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { hsvToRgb, rgbToHex } from '../utils/colors';

const SEGMENT_COUNT = 24;
const DOT_SIZE = 30;
const WHEEL_SIZE = 280;

interface ColorWheelProps {
  hue: number;
  onChangeHue: (hue: number) => void;
}

export default function ColorWheel({ hue, onChangeHue }: ColorWheelProps) {
  const segments = Array.from({ length: SEGMENT_COUNT }, (_, index) => {
    const angle = (360 / SEGMENT_COUNT) * index;
    const rad = (angle * Math.PI) / 180;
    const radius = (WHEEL_SIZE - DOT_SIZE) / 2;
    const x = radius + radius * Math.cos(rad);
    const y = radius + radius * Math.sin(rad);
    const color = hsvToRgb(angle, 1, 1);
    return { angle, x, y, color };
  });

  const selectedColor = hsvToRgb(hue, 1, 1);
  const selectedHex = rgbToHex(selectedColor);

  return (
    <View style={styles.container}>
      <View style={styles.wheel}>
        {segments.map((segment) => (
          <TouchableOpacity
            key={segment.angle}
            activeOpacity={0.8}
            style={[
              styles.dot,
              {
                left: segment.x,
                top: segment.y,
                backgroundColor: rgbToHex(segment.color),
                borderWidth: segment.angle === Math.round(hue / (360 / SEGMENT_COUNT)) * (360 / SEGMENT_COUNT) ? 3 : 0,
                borderColor: '#fff',
              },
            ]}
            onPress={() => onChangeHue(segment.angle)}
          />
        ))}
        <View style={[styles.center, { backgroundColor: selectedHex }]}> 
          <Text style={styles.centerText}>{selectedHex}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheel: {
    width: WHEEL_SIZE,
    height: WHEEL_SIZE,
    borderRadius: WHEEL_SIZE / 2,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7f7f7',
  },
  dot: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
  },
  center: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  centerText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
});

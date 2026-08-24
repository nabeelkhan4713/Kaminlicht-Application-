/**
 * Climate screen — heater (stage 1/2, thermostat 16–26 °C) + exhaust fan, FR-CLI / FR-FAN.
 * Only mounted when the manifest reports a heater or fan (see AppNavigator gating).
 * Scaffold: full controls land in Sprint 3C/3D.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useHasHeater, useHasExhaustFan } from '../contexts/CapabilitiesContext';
import { useCurrentTemp, useHumidity } from '../hooks/useDeviceTelemetry';

export default function ClimateScreen() {
  const hasHeater = useHasHeater();
  const hasFan = useHasExhaustFan();
  const tempC = useCurrentTemp();
  const humidity = useHumidity();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Climate</Text>
      <Text style={styles.reading}>{tempC != null ? `${tempC} °C` : '—'} · {humidity != null ? `${humidity} %` : '—'}</Text>
      <Text style={styles.dim}>Heater: {hasHeater ? 'fitted (stage + thermostat — Sprint 3C)' : 'not fitted'}</Text>
      <Text style={styles.dim}>Exhaust fan: {hasFan ? 'fitted (speed — Sprint 3D)' : 'not fitted'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8, backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: '700' },
  reading: { fontSize: 28, fontWeight: '700', color: '#ea580c' },
  dim: { color: '#888' },
});

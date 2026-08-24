/**
 * Climate screen — heater power, stage (1000W / 2000W) and optional thermostat, plus
 * live temperature/humidity (FR-CLI). Only mounted when the manifest reports a heater or
 * fan (see AppNavigator gating).
 *
 * Controls are shown per capability: the stage selector appears only when the manifest
 * reports >=2 stages; the thermostat appears only when the heater supports one (the
 * production board's two 1000W heaters are on/off + stage, with no thermostat).
 */
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useConnectionState, usePublishWithAck, useStableOffline } from '../contexts/DeviceContext';
import { useHasThermostat, useHeaterStages } from '../contexts/CapabilitiesContext';
import {
  useClimateReporting,
  useCurrentTemp,
  useHeaterOn,
  useHeaterStage,
  useHumidity,
  useTargetTemp,
} from '../hooks/useDeviceTelemetry';
import {
  buildHeaterPowerCmd,
  buildHeaterStageCmd,
  buildThermostatCmd,
  type MQTTCommand,
} from '../types/commands';

const THERMOSTAT_MIN = 16;
const THERMOSTAT_MAX = 26;

export default function ClimateScreen() {
  const offline = useStableOffline();
  const connectionState = useConnectionState();
  const publishWithAck = usePublishWithAck();
  const stages = useHeaterStages();
  const hasThermostat = useHasThermostat();

  const heaterOn = useHeaterOn();
  const stage = useHeaterStage();
  const tempC = useCurrentTemp();
  const humidity = useHumidity();
  const deviceTarget = useTargetTemp();
  const climateReporting = useClimateReporting();

  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [targetOverride, setTargetOverride] = useState<number | null>(null);

  const target = targetOverride ?? deviceTarget ?? 21;
  const controlsDisabled = offline || pendingCommand !== null;

  useEffect(() => {
    if (targetOverride !== null && deviceTarget === targetOverride) setTargetOverride(null);
  }, [targetOverride, deviceTarget]);

  const sendCommand = async (command: MQTTCommand, label: string) => {
    setPendingCommand(label);
    try {
      await publishWithAck(command, 6000);
    } catch (error) {
      setTargetOverride(null);
      Alert.alert(
        'Command not confirmed',
        error instanceof Error ? error.message : 'The fireplace did not confirm the command.',
      );
    } finally {
      setPendingCommand(null);
    }
  };

  const setTarget = (next: number) => {
    const clamped = Math.max(THERMOSTAT_MIN, Math.min(THERMOSTAT_MAX, next));
    if (clamped === target) return;
    setTargetOverride(clamped);
    void sendCommand(buildThermostatCmd(clamped), `thermostat ${clamped}°C`);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {connectionState !== 'connected' && (
        <Text style={styles.offline}>
          {connectionState === 'reconnecting'
            ? 'Reconnecting to fireplace...'
            : 'Fireplace offline. Waiting for Wi-Fi connection...'}
        </Text>
      )}
      {pendingCommand && <Text style={styles.notice}>Sending {pendingCommand}...</Text>}

      <View style={styles.readingCard}>
        <View style={styles.reading}>
          <Text style={styles.readingValue}>{tempC != null ? `${Math.round(tempC)}°` : '—'}</Text>
          <Text style={styles.readingLabel}>Temperature</Text>
        </View>
        <View style={styles.readingDivider} />
        <View style={styles.reading}>
          <Text style={styles.readingValue}>{humidity != null ? `${Math.round(humidity)}%` : '—'}</Text>
          <Text style={styles.readingLabel}>Humidity</Text>
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <View>
            <Text style={styles.cardTitle}>Heater</Text>
            <Text style={styles.helperText}>{heaterOn ? 'Heating on' : 'Heating off'}</Text>
          </View>
          <TouchableOpacity
            disabled={controlsDisabled}
            style={[styles.toggle, heaterOn && styles.toggleOn, controlsDisabled && styles.disabled]}
            onPress={() => void sendCommand(buildHeaterPowerCmd(!heaterOn), heaterOn ? 'heater off' : 'heater on')}
          >
            <Text style={styles.toggleText}>{heaterOn ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {stages >= 2 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Heat level</Text>
          <Text style={styles.helperText}>Stage 1 = 1000 W · Stage 2 = 2000 W</Text>
          <View style={styles.stageRow}>
            {[1, 2].map((s) => (
              <TouchableOpacity
                key={s}
                disabled={controlsDisabled}
                style={[styles.stageBtn, stage === s && styles.stageBtnActive, controlsDisabled && styles.disabled]}
                onPress={() => void sendCommand(buildHeaterStageCmd(s as 1 | 2), `heat stage ${s}`)}
              >
                <Text style={[styles.stageBtnText, stage === s && styles.stageBtnTextActive]}>
                  Stage {s}
                </Text>
                <Text style={[styles.stageWatts, stage === s && styles.stageBtnTextActive]}>
                  {s === 1 ? '1000 W' : '2000 W'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {hasThermostat && (
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Thermostat</Text>
            <Text style={styles.targetValue}>{target}°C</Text>
          </View>
          <View style={styles.thermostatRow}>
            <TouchableOpacity
              disabled={controlsDisabled || target <= THERMOSTAT_MIN}
              style={[styles.stepBtn, (controlsDisabled || target <= THERMOSTAT_MIN) && styles.disabled]}
              onPress={() => setTarget(target - 1)}
            >
              <Text style={styles.stepBtnText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.thermostatBig}>{target}°C</Text>
            <TouchableOpacity
              disabled={controlsDisabled || target >= THERMOSTAT_MAX}
              style={[styles.stepBtn, (controlsDisabled || target >= THERMOSTAT_MAX) && styles.disabled]}
              onPress={() => setTarget(target + 1)}
            >
              <Text style={styles.stepBtnText}>+</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.helperText}>Target between {THERMOSTAT_MIN}°C and {THERMOSTAT_MAX}°C.</Text>
        </View>
      )}

      {!climateReporting && connectionState === 'connected' && (
        <Text style={styles.warn}>The fireplace has not reported the heater yet.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 14, backgroundColor: '#fff', flexGrow: 1 },
  offline: { backgroundColor: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 8, textAlign: 'center' },
  notice: { backgroundColor: '#eff6ff', color: '#1d4ed8', padding: 10, borderRadius: 8, textAlign: 'center' },
  warn: { color: '#b45309', fontSize: 13 },
  helperText: { color: '#666', fontSize: 13, lineHeight: 18 },
  readingCard: { flexDirection: 'row', backgroundColor: '#f4f4f5', borderRadius: 14, padding: 20, alignItems: 'center' },
  reading: { flex: 1, alignItems: 'center', gap: 4 },
  readingDivider: { width: 1, alignSelf: 'stretch', backgroundColor: '#d4d4d8' },
  readingValue: { fontSize: 34, fontWeight: '800', color: '#ea580c' },
  readingLabel: { fontSize: 13, color: '#71717a', fontWeight: '600' },
  card: { backgroundColor: '#f4f4f5', borderRadius: 14, padding: 16, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  toggle: { paddingVertical: 6, paddingHorizontal: 18, borderRadius: 20, backgroundColor: '#d4d4d8' },
  toggleOn: { backgroundColor: '#ea580c' },
  toggleText: { color: '#fff', fontWeight: '700' },
  stageRow: { flexDirection: 'row', gap: 10 },
  stageBtn: { flex: 1, backgroundColor: '#e4e4e7', paddingVertical: 16, borderRadius: 12, alignItems: 'center', gap: 2 },
  stageBtnActive: { backgroundColor: '#ea580c' },
  stageBtnText: { fontWeight: '700', color: '#3f3f46', fontSize: 15 },
  stageWatts: { fontSize: 12, color: '#71717a' },
  stageBtnTextActive: { color: '#fff' },
  targetValue: { fontSize: 15, fontWeight: '700', color: '#ea580c' },
  thermostatRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  thermostatBig: { fontSize: 40, fontWeight: '800', color: '#111827' },
  stepBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#ffedd5', alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { color: '#ea580c', fontSize: 28, fontWeight: '800', lineHeight: 30 },
  disabled: { opacity: 0.4 },
});

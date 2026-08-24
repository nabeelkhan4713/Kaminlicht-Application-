/**
 * Audio screen — sound module power, volume and track control (FR-AUD).
 * Only mounted when the Capabilities Manifest reports audio.present (see AppNavigator).
 *
 * Backed by a DFPlayer-style module on the device: it plays numbered tracks from an SD
 * card, so the app sends play/stop, a volume step and next/previous — never a file path.
 * Volume steps come from the manifest (volumeSteps), NOT hardcoded, because the device
 * maps them onto its own hardware range.
 */
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useConnectionState, usePublishWithAck, useStableOffline } from '../contexts/DeviceContext';
import { useAudioVolumeSteps, useHasTrackControl } from '../contexts/CapabilitiesContext';
import {
  useAudioOn,
  useAudioReporting,
  useAudioTrackIndex,
  useAudioTrackName,
  useAudioVolume,
} from '../hooks/useDeviceTelemetry';
import { buildAudioPowerCmd, buildTrackCmd, buildVolumeCmd, type MQTTCommand } from '../types/commands';

export default function AudioScreen() {
  const offline = useStableOffline();
  const connectionState = useConnectionState();
  const publishWithAck = usePublishWithAck();
  const volumeSteps = useAudioVolumeSteps();
  const hasTrackControl = useHasTrackControl();

  const audioOn = useAudioOn();
  const deviceVolume = useAudioVolume();
  const trackIndex = useAudioTrackIndex();
  const trackName = useAudioTrackName();
  const audioReporting = useAudioReporting();

  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  // Optimistic volume so the row highlights immediately; cleared once telemetry agrees.
  const [volumeOverride, setVolumeOverride] = useState<number | null>(null);

  useEffect(() => {
    if (volumeOverride !== null && deviceVolume === volumeOverride) setVolumeOverride(null);
  }, [volumeOverride, deviceVolume]);

  const volume = volumeOverride ?? deviceVolume;
  const controlsDisabled = offline || pendingCommand !== null;

  const sendCommand = async (command: MQTTCommand, label: string) => {
    setPendingCommand(label);
    try {
      await publishWithAck(command, 6000);
    } catch (error) {
      setVolumeOverride(null); // drop the optimistic value if the device never confirmed
      Alert.alert(
        'Command not confirmed',
        error instanceof Error ? error.message : 'The fireplace did not confirm the command.',
      );
    } finally {
      setPendingCommand(null);
    }
  };

  const setVolume = (next: number) => {
    const clamped = Math.max(0, Math.min(volumeSteps, next));
    if (clamped === volume) return;
    setVolumeOverride(clamped);
    void sendCommand(buildVolumeCmd(clamped, volumeSteps), `volume ${clamped}`);
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
      {!audioReporting && connectionState === 'connected' && (
        <Text style={styles.warn}>The fireplace has not reported the sound module yet.</Text>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Sound</Text>
        <View style={styles.rowBetween}>
          <View style={styles.trackInfo}>
            <Text style={styles.trackName}>{trackName ?? 'No track playing'}</Text>
            {trackIndex != null && <Text style={styles.trackMeta}>Track {trackIndex + 1}</Text>}
          </View>
          <TouchableOpacity
            disabled={controlsDisabled}
            style={[styles.toggle, audioOn && styles.toggleOn, controlsDisabled && styles.disabled]}
            onPress={() => void sendCommand(buildAudioPowerCmd(!audioOn), audioOn ? 'sound off' : 'sound on')}
          >
            <Text style={styles.toggleText}>{audioOn ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {hasTrackControl && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Track</Text>
          <View style={styles.trackRow}>
            <TouchableOpacity
              disabled={controlsDisabled}
              style={[styles.trackBtn, controlsDisabled && styles.disabled]}
              onPress={() => void sendCommand(buildTrackCmd('prev'), 'previous track')}
            >
              <Text style={styles.trackBtnText}>Previous</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={controlsDisabled}
              style={[styles.trackBtn, controlsDisabled && styles.disabled]}
              onPress={() => void sendCommand(buildTrackCmd('next'), 'next track')}
            >
              <Text style={styles.trackBtnText}>Next</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Volume</Text>
          <Text style={styles.volumeValue}>
            {volume}/{volumeSteps}
          </Text>
        </View>

        <View style={styles.volumeRow}>
          <TouchableOpacity
            disabled={controlsDisabled || volume <= 0}
            style={[styles.stepBtn, (controlsDisabled || volume <= 0) && styles.disabled]}
            onPress={() => setVolume(volume - 1)}
          >
            <Text style={styles.stepBtnText}>-</Text>
          </TouchableOpacity>

          <View style={styles.bars}>
            {Array.from({ length: volumeSteps }, (_, i) => i + 1).map((step) => (
              <TouchableOpacity
                key={step}
                disabled={controlsDisabled}
                style={[styles.bar, volume >= step && styles.barActive, controlsDisabled && styles.disabled]}
                onPress={() => setVolume(step)}
                accessibilityRole="button"
                accessibilityLabel={`Set volume to ${step}`}
              />
            ))}
          </View>

          <TouchableOpacity
            disabled={controlsDisabled || volume >= volumeSteps}
            style={[styles.stepBtn, (controlsDisabled || volume >= volumeSteps) && styles.disabled]}
            onPress={() => setVolume(volume + 1)}
          >
            <Text style={styles.stepBtnText}>+</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          disabled={controlsDisabled || volume === 0}
          style={[styles.muteBtn, (controlsDisabled || volume === 0) && styles.disabled]}
          onPress={() => setVolume(0)}
        >
          <Text style={styles.muteText}>Mute</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 14, backgroundColor: '#fff', flexGrow: 1 },
  offline: { backgroundColor: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 8, textAlign: 'center' },
  notice: { backgroundColor: '#eff6ff', color: '#1d4ed8', padding: 10, borderRadius: 8, textAlign: 'center' },
  warn: { color: '#b45309', fontSize: 13 },
  card: { backgroundColor: '#f4f4f5', borderRadius: 14, padding: 16, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  trackInfo: { flex: 1, gap: 2 },
  trackName: { fontSize: 15, fontWeight: '600', color: '#18181b' },
  trackMeta: { fontSize: 13, color: '#71717a' },
  toggle: { paddingVertical: 6, paddingHorizontal: 18, borderRadius: 20, backgroundColor: '#d4d4d8' },
  toggleOn: { backgroundColor: '#ea580c' },
  toggleText: { color: '#fff', fontWeight: '700' },
  trackRow: { flexDirection: 'row', gap: 10 },
  trackBtn: { flex: 1, backgroundColor: '#e4e4e7', paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  trackBtnText: { fontWeight: '700', color: '#3f3f46' },
  volumeValue: { fontSize: 15, fontWeight: '700', color: '#ea580c' },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#ffedd5', alignItems: 'center', justifyContent: 'center' },
  stepBtnText: { color: '#ea580c', fontSize: 24, fontWeight: '800', lineHeight: 26 },
  bars: { flex: 1, flexDirection: 'row', gap: 4, alignItems: 'center' },
  bar: { flex: 1, height: 28, borderRadius: 4, backgroundColor: '#e4e4e7' },
  barActive: { backgroundColor: '#ea580c' },
  muteBtn: { borderWidth: 1, borderColor: '#a1a1aa', paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  muteText: { color: '#52525b', fontWeight: '700' },
  disabled: { opacity: 0.4 },
});

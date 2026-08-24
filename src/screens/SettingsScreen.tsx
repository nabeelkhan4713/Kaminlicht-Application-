/**
 * Settings screen — device info + "Set up device (Bluetooth)" entry to provisioning.
 * Hotelschaltung, schedules land in Sprint 3E.
 */
import { useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useConnection, useManifest, usePublishWithAck } from '../contexts/DeviceContext';
import { buildFactoryResetCmd } from '../types/commands';
import ProvisioningScreen from './ProvisioningScreen';

export default function SettingsScreen() {
  const manifest = useManifest();
  const online = useConnection();
  const publishWithAck = usePublishWithAck();
  const [setupOpen, setSetupOpen] = useState(false);
  const [resetInProgress, setResetInProgress] = useState(false);

  const confirmFactoryReset = () => {
    if (!online) {
      Alert.alert(
        'Fireplace offline',
        'Factory reset can only be sent while the fireplace is connected over Wi-Fi. Turn it on and wait for the app to reconnect, then try again.',
      );
      return;
    }

    Alert.alert(
      'Reset Wi-Fi setup?',
      'The fireplace will forget the saved Wi-Fi, reboot, and return to Bluetooth setup mode.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setResetInProgress(true);
            try {
              await publishWithAck(buildFactoryResetCmd(), 6000);
              setTimeout(() => setSetupOpen(true), 2500);
            } catch (error) {
              setResetInProgress(false);
              Alert.alert(
                'Reset not confirmed',
                error instanceof Error ? error.message : 'The fireplace did not confirm the reset command.',
              );
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.dim}>Serial: {manifest?.serialNumber ?? '—'}</Text>
      <Text style={styles.dim}>Firmware: {manifest?.firmwareVersion ?? '—'}</Text>
      <Text style={styles.dim}>Variant: {manifest?.skuHint ?? '—'}</Text>

      <TouchableOpacity style={styles.btn} onPress={() => setSetupOpen(true)}>
        <Text style={styles.btnText}>Set up device (Bluetooth)</Text>
      </TouchableOpacity>
      <Text style={styles.dim}>Use this on a real phone to send Wi-Fi to a new fireplace.</Text>
      {resetInProgress && (
        <View style={styles.resetNotice}>
          <Text style={styles.resetNoticeTitle}>Reset sent</Text>
          <Text style={styles.resetNoticeText}>The fireplace is rebooting into Bluetooth setup. The scanner opens automatically.</Text>
        </View>
      )}

      <TouchableOpacity style={styles.dangerBtn} onPress={confirmFactoryReset}>
        <Text style={styles.dangerText}>Factory reset Wi-Fi setup</Text>
      </TouchableOpacity>
      <Text style={styles.dim}>Use this before moving the fireplace to another Wi-Fi network.</Text>
      <Modal
        visible={setupOpen}
        animationType="slide"
        onRequestClose={() => {
          setSetupOpen(false);
          setResetInProgress(false);
        }}
      >
        <SafeAreaView style={{ flex: 1 }}>
          <ProvisioningScreen
            onClose={() => {
              setSetupOpen(false);
              setResetInProgress(false);
            }}
            initialLog={
              resetInProgress
                ? ['Factory reset sent.', 'Waiting for fireplace to reboot into Bluetooth setup.']
                : []
            }
            autoScanDelayMs={resetInProgress ? 2500 : undefined}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 8, backgroundColor: '#fff' },
  title: { fontSize: 20, fontWeight: '700' },
  dim: { color: '#888' },
  btn: { backgroundColor: '#ea580c', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  btnText: { color: '#fff', fontWeight: '700' },
  resetNotice: { backgroundColor: '#fff7ed', borderRadius: 10, padding: 12, marginTop: 14, gap: 4 },
  resetNoticeTitle: { color: '#9a3412', fontWeight: '700' },
  resetNoticeText: { color: '#9a3412', fontSize: 13 },
  dangerBtn: {
    borderWidth: 1,
    borderColor: '#dc2626',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 16,
  },
  dangerText: { color: '#dc2626', fontWeight: '700' },
});






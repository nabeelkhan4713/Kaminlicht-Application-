/**
 * App root — providers + navigation.
 *
 * SafeAreaProvider → DeviceSessionProvider (which fireplace are we paired with?)
 *   → DeviceProvider (owns the MQTT session) → NavigationContainer → RootNavigator.
 *
 * The paired device from DeviceSessionProvider decides the MQTT target: its host is
 * tried first, with src/config.ts entries kept as fallbacks (mDNS name, known LAN IPs,
 * the PC simulator). Before any device is paired we connect to the config defaults so
 * the simulator and the provisioning confirmation still work.
 */
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { DeviceProvider } from './src/contexts/DeviceContext';
import { DeviceSessionProvider, useDeviceSession } from './src/contexts/DeviceSessionContext';
import { bleService } from './src/services/BLEService';
import RootNavigator from './src/navigation/RootNavigator';
import { DEVICE } from './src/config';

// Initialise the BLE native module once at startup (Roadmap Task 1.2 → "BleManager created").
bleService.init();

function ConnectedApp() {
  const { device } = useDeviceSession();

  // Paired mDNS name first, then its last known IP (for networks where .local does not
  // resolve — common on Android), then the config fallbacks. Deduped, order preserved.
  const hosts = device
    ? Array.from(new Set([device.host, ...(device.ip ? [device.ip] : []), ...DEVICE.hosts]))
    : DEVICE.hosts;
  const serialNumber = device?.serialNumber ?? DEVICE.serialNumber;

  return (
    // Remount the MQTT session when the paired serial changes: topics are kl/{sn}/*,
    // so a new device means a new subscription set.
    <DeviceProvider key={serialNumber} connection={{ hosts, serialNumber, wsPort: DEVICE.wsPort }}>
      <NavigationContainer>
        <StatusBar style="light" />
        <RootNavigator />
      </NavigationContainer>
    </DeviceProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <DeviceSessionProvider>
        <ConnectedApp />
      </DeviceSessionProvider>
    </SafeAreaProvider>
  );
}

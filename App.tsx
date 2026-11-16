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

  // Last known IP first (resolves instantly), then the config IP fallbacks, then the
  // mDNS '.local' name LAST. Android often cannot resolve a '.local' name and the MQTT
  // client can stall on it, so an mDNS name must never be ahead of a reachable IP.
  const hosts = device
    ? Array.from(new Set([...(device.ip ? [device.ip] : []), ...DEVICE.hosts, device.host]))
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

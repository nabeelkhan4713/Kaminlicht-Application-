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
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { DeviceProvider, useManifest } from './src/contexts/DeviceContext';
import { DeviceSessionProvider, useDeviceSession } from './src/contexts/DeviceSessionContext';
import { bleService } from './src/services/BLEService';
import RootNavigator from './src/navigation/RootNavigator';
import { DEVICE } from './src/config';

// Initialise the BLE native module once at startup (Roadmap Task 1.2 → "BleManager created").
bleService.init();

/**
 * Keeps the saved device's IP fresh. Whenever the board reports its current LAN IP
 * in the manifest, we persist it — so after a DHCP change the app dials the new IP
 * first next time instead of a stale one. Lives inside DeviceProvider.
 */
function DeviceIpSync() {
  const manifest = useManifest();
  const { device, saveDevice } = useDeviceSession();
  const ip = manifest?.network?.ip;
  useEffect(() => {
    if (device && ip && ip !== device.ip) void saveDevice({ ...device, ip });
  }, [ip, device, saveDevice]);
  return null;
}

function ConnectedApp() {
  const { device } = useDeviceSession();
  const serialNumber = device?.serialNumber ?? DEVICE.serialNumber;

  // Saved IP first (resolves instantly), then the config IP fallbacks, then the mDNS
  // '.local' name LAST — Android often can't resolve '.local' and the MQTT client can
  // stall on it. This is the connection path proven to work on the tablet.
  const hosts = device
    ? Array.from(new Set([...(device.ip ? [device.ip] : []), ...DEVICE.hosts, device.host]))
    : DEVICE.hosts;

  return (
    // Keep the MQTT session stable across renders (remount only when the paired serial
    // changes). mqtt.js cycles through `hosts` itself to find a reachable one.
    <DeviceProvider key={serialNumber} connection={{ hosts, serialNumber, wsPort: DEVICE.wsPort }}>
      <DeviceIpSync />
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

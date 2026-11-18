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
import { useDiscoveredHost } from './src/hooks/useDiscoveredHost';
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

  // Auto-discover the fireplace on the LAN by its mDNS service — its CURRENT IP, found
  // live, so a DHCP change can't strand the app on a stale address.
  const discoveredIp = useDiscoveredHost(serialNumber);

  // Order: discovered IP (freshest) → saved IP → config IP fallbacks → mDNS name LAST
  // (Android often can't resolve '.local' and the MQTT client can stall on it).
  const hosts = Array.from(
    new Set(
      [discoveredIp, device?.ip, ...DEVICE.hosts, device?.host].filter((h): h is string => !!h),
    ),
  );

  return (
    // Remount (reconnect) when the paired serial OR the primary host changes — so a
    // freshly discovered IP is picked up by the live MQTT session.
    <DeviceProvider key={`${serialNumber}@${hosts[0] ?? ''}`} connection={{ hosts, serialNumber, wsPort: DEVICE.wsPort }}>
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

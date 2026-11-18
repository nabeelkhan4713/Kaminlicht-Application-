/**
 * useDiscoveredHost — finds the fireplace on the local Wi-Fi by its mDNS service
 * (_glowfire._tcp), so the app connects by discovery instead of a hardcoded IP.
 * Returns the board's current LAN IP, or null until it is found.
 *
 * The firmware advertises the service with a TXT 'serial'; when we know which unit
 * we want, we match on it so two fireplaces on one network don't get mixed up.
 *
 * Defensive: if the native zeroconf module isn't present (e.g. a build that hasn't
 * been rebuilt yet), this simply returns null instead of throwing.
 */
import { useEffect, useState } from 'react';

interface ResolvedService {
  addresses?: string[];
  host?: string;
  port?: number;
  txt?: Record<string, string>;
}

const isIpv4 = (a: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a);

export function useDiscoveredHost(serialNumber?: string): string | null {
  const [ip, setIp] = useState<string | null>(null);

  useEffect(() => {
    let zc: { on: Function; scan: Function; stop: Function; removeDeviceListeners: Function } | null = null;
    try {
      // Lazy require so a build without the native module doesn't crash at import time.
      const Zeroconf = require('react-native-zeroconf').default;
      zc = new Zeroconf();
      zc!.on('resolved', (service: ResolvedService) => {
        const addr = (service?.addresses ?? []).find(isIpv4);
        if (!addr) return;
        const txtSerial = service?.txt?.serial;
        if (serialNumber && txtSerial && txtSerial !== serialNumber) return; // different unit
        setIp((cur) => (cur === addr ? cur : addr));
      });
      zc!.on('error', () => {});
      zc!.scan('glowfire', 'tcp', 'local.');
    } catch {
      zc = null;
    }
    return () => {
      try {
        zc?.stop();
        zc?.removeDeviceListeners();
      } catch {
        /* ignore */
      }
    };
  }, [serialNumber]);

  return ip;
}

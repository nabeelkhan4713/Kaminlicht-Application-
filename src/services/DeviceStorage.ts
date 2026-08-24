/**
 * DeviceStorage — persists ONLY the paired device's serial + reachable host
 * (SRS §1.3 Storage rule). Wi-Fi credentials are NEVER written here (NFR-S-001):
 * they live solely in the fireplace's own flash after BLE provisioning.
 *
 * `host` is an mDNS name (e.g. "kl-glowfire.local") when the firmware advertises one,
 * otherwise a LAN IP. It is tried first, ahead of the fallbacks in src/config.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'glowfire.device';

export interface StoredDevice {
  serialNumber: string;
  host: string;
  /** Last known LAN IP, tried after `host`. Present once the unit has reported it. */
  ip?: string;
}

export const DeviceStorage = {
  async saveDevice(device: StoredDevice): Promise<void> {
    await AsyncStorage.setItem(KEY, JSON.stringify(device));
  },

  async getDevice(): Promise<StoredDevice | null> {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredDevice>;
      // Ignore malformed/partial records rather than connecting to a bad target.
      if (!parsed.serialNumber || !parsed.host) return null;
      return { serialNumber: parsed.serialNumber, host: parsed.host, ip: parsed.ip };
    } catch {
      return null;
    }
  },

  async hasDevice(): Promise<boolean> {
    return (await DeviceStorage.getDevice()) !== null;
  },

  async clear(): Promise<void> {
    await AsyncStorage.removeItem(KEY);
  },
};

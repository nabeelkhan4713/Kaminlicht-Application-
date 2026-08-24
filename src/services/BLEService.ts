/**
 * BLEService — Phase 2 Wi-Fi provisioning over BLE (Nordic UART Service).
 * Used ONLY for first-time setup: scan → connect → send "WIFI:ssid,password" → read replies.
 * UUIDs MUST match the firmware. NOTE: BLE needs a real phone — it cannot run on the emulator.
 */
import { BleManager, type Device } from 'react-native-ble-plx';
import { PermissionsAndroid, Platform } from 'react-native';

// Nordic UART Service — must match the ESP32 firmware
export const NUS = {
  service: '6E400001-B5A3-F393-E0A9-E50E24DCCA9E',
  rx: '6E400002-B5A3-F393-E0A9-E50E24DCCA9E', // app → device (write)
  tx: '6E400003-B5A3-F393-E0A9-E50E24DCCA9E', // device → app (notify)
};

// Minimal base64 (BLE-plx reads/writes base64) — avoids extra dependencies.
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function encodeBase64(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 3) {
    const a = input.charCodeAt(i);
    const b = i + 1 < input.length ? input.charCodeAt(i + 1) : NaN;
    const c = i + 2 < input.length ? input.charCodeAt(i + 2) : NaN;
    const n = (a << 16) | ((isNaN(b) ? 0 : b) << 8) | (isNaN(c) ? 0 : c);
    out += CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63];
    out += isNaN(b) ? '=' : CHARS[(n >> 6) & 63];
    out += isNaN(c) ? '=' : CHARS[n & 63];
  }
  return out;
}
function decodeBase64(input: string): string {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  let out = '';
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (CHARS.indexOf(clean[i]) << 18) |
      (CHARS.indexOf(clean[i + 1]) << 12) |
      ((clean[i + 2] ? CHARS.indexOf(clean[i + 2]) : 0) << 6) |
      (clean[i + 3] ? CHARS.indexOf(clean[i + 3]) : 0);
    out += String.fromCharCode((n >> 16) & 255);
    if (clean[i + 2]) out += String.fromCharCode((n >> 8) & 255);
    if (clean[i + 3]) out += String.fromCharCode(n & 255);
  }
  return out;
}

export interface WifiNetwork {
  ssid: string;
  rssi: number;
  secure: boolean;
}
export class BLEService {
  private manager: BleManager | null = null;
  private device: Device | null = null;

  init(): BleManager {
    if (!this.manager) {
      this.manager = new BleManager();
      console.log('BleManager created');
    }
    return this.manager;
  }

  /** Android 12+ needs BLUETOOTH_SCAN/CONNECT; older needs location. */
  async requestPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    const sdk = Platform.Version as number;
    const perms =
      sdk >= 31
        ? [
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
            PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
            PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          ]
        : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    const res = await PermissionsAndroid.requestMultiple(perms);
    return Object.values(res).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
  }

  /** Scan broadly, then keep the setup device by name or advertised service. */
  async scan(onFound: (device: Device) => void, onError?: (message: string) => void): Promise<void> {
    const manager = this.init();
    const setupService = NUS.service.toLowerCase();
    manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
      if (error) {
        console.log('[BLE] scan error', error.message);
        onError?.(error.message);
        return;
      }
      if (!device) return;

      const name = device.name ?? device.localName ?? '';
      const services = (device.serviceUUIDs ?? []).map((uuid) => uuid.toLowerCase());
      const isGlowFire = name.includes('KL-GlowFire-Setup') || services.includes(setupService);
      if (isGlowFire) onFound(device);
    });
  }

  stopScan(): void {
    this.manager?.stopDeviceScan();
  }

  private async sendSetupCommand(
    device: Device,
    command: string,
    onReply: (line: string) => void,
    isDone: (line: string) => boolean,
    timeoutMs = 10000,
  ): Promise<void> {
    this.stopScan();
    const connected = await device.connect();
    await connected.discoverAllServicesAndCharacteristics();
    this.device = connected;

    await new Promise<void>((resolve, reject) => {
      let completed = false;
      let writeAcked = false;
      const timeout = setTimeout(() => {
        if (!completed) {
          completed = true;
          reject(new Error('Timed out waiting for device reply.'));
        }
      }, timeoutMs);

      const finish = () => {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        resolve();
      };

      const fail = (message: string) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        reject(new Error(message));
      };

      connected.monitorCharacteristicForService(NUS.service, NUS.tx, (error, ch) => {
        if (error) {
          console.log('[BLE] monitor error', error.message);
          if (writeAcked && command.startsWith('WIFI:')) finish();
          else fail(error.message);
          return;
        }
        if (!ch?.value) return;
        const line = decodeBase64(ch.value).trim();
        onReply(line);
        if (isDone(line)) finish();
        else if (line.startsWith('ERR:')) fail(line);
      });

      const payload = encodeBase64(command);
      connected
        .writeCharacteristicWithResponseForService(NUS.service, NUS.rx, payload)
        .then(() => {
          writeAcked = true;
          if (command.startsWith('WIFI:')) {
            setTimeout(() => {
              if (!completed) {
                onReply('SAVED: Wi-Fi details saved - restarting to connect');
                finish();
              }
            }, 1500);
          }
        })
        .catch((e) => {
          fail(e?.message ?? String(e));
        });
    });
  }

  async scanWifiNetworks(device: Device, onReply: (line: string) => void): Promise<WifiNetwork[]> {
    const networks: WifiNetwork[] = [];
    try {
      await this.sendSetupCommand(
        device,
        'SCAN_WIFI',
        (line) => {
          onReply(line);
          if (!line.startsWith('AP:')) return;
          const parts = line.substring(3).split('|');
          const ssid = parts[0]?.trim();
          const rssi = Number(parts[1]);
          const secure = parts[2] !== '0';
          if (ssid && !networks.some((network) => network.ssid === ssid)) {
            networks.push({ ssid, rssi: Number.isFinite(rssi) ? rssi : -100, secure });
          }
        },
        (line) => line.startsWith('SCAN_DONE'),
        12000,
      );
    } finally {
      await this.disconnect();
    }
    return networks.sort((a, b) => b.rssi - a.rssi);
  }

  /** Send the Wi-Fi credentials and wait until the ESP confirms they were saved. */
  async provision(
    device: Device,
    ssid: string,
    password: string,
    onReply: (line: string) => void,
  ): Promise<void> {
    await this.sendSetupCommand(
      device,
      `WIFI:${ssid},${password}`,
      onReply,
      (line) => line.startsWith('SAVED:'),
      8000,
    );
  }

  async disconnect(): Promise<void> {
    if (this.device) {
      try {
        await this.device.cancelConnection();
      } catch {
        /* ignore */
      }
      this.device = null;
    }
  }
}

export const bleService = new BLEService();







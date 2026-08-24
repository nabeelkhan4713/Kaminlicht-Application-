/**
 * DeviceSessionContext — owns "which fireplace is this app paired with".
 *
 * This sits ABOVE DeviceProvider: the stored device decides which MQTT host/serial
 * the app connects to, and whether the first-run provisioning gate is shown
 * (SRS §5.1). Screens never read AsyncStorage directly — they go through this hook.
 *
 * Wi-Fi credentials are NEVER stored here (NFR-S-001); they live only in the
 * fireplace's own flash after BLE provisioning.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DeviceStorage, type StoredDevice } from '../services/DeviceStorage';

export interface DeviceSession {
  /** The paired fireplace, or null when the app has never been provisioned. */
  device: StoredDevice | null;
  /** True once a fireplace has been paired — drives the provisioning gate. */
  provisioned: boolean;
  /** Persist a newly provisioned fireplace and switch the app over to it. */
  saveDevice: (device: StoredDevice) => Promise<void>;
  /** Forget the paired fireplace (factory reset / unpair). */
  clearDevice: () => Promise<void>;
}

const DeviceSessionContext = createContext<DeviceSession | null>(null);

export function DeviceSessionProvider({ children }: { children: React.ReactNode }) {
  const [device, setDevice] = useState<StoredDevice | null>(null);
  const [ready, setReady] = useState(false);

  // Load the paired device once at startup, before anything connects.
  useEffect(() => {
    let active = true;
    void (async () => {
      const stored = await DeviceStorage.getDevice();
      if (!active) return;
      setDevice(stored);
      setReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  const saveDevice = useCallback(async (next: StoredDevice) => {
    await DeviceStorage.saveDevice(next);
    setDevice(next);
  }, []);

  const clearDevice = useCallback(async () => {
    await DeviceStorage.clear();
    setDevice(null);
  }, []);

  const value = useMemo<DeviceSession>(
    () => ({ device, provisioned: device !== null, saveDevice, clearDevice }),
    [device, saveDevice, clearDevice],
  );

  // Nothing renders until storage has been read, so the app never connects to the
  // wrong device or flashes the setup screen at a already-paired user.
  if (!ready) return null;

  return <DeviceSessionContext.Provider value={value}>{children}</DeviceSessionContext.Provider>;
}

export function useDeviceSession(): DeviceSession {
  const session = useContext(DeviceSessionContext);
  if (!session) throw new Error('useDeviceSession must be used within <DeviceSessionProvider>');
  return session;
}

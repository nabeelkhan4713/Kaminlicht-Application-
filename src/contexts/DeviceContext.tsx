/**
 * DeviceContext — the ONLY bridge between the IoT services and the UI (SRS §1.3.1).
 * Screens/components never import from src/services; they read device state through
 * these hooks.
 *
 * Implemented as an external store consumed via useSyncExternalStore so that selector
 * hooks re-render ONLY when their selected slice changes (Object.is). The 2-second
 * telemetry tick therefore does not re-render components that don't depend on the
 * field that actually changed.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { mqttService, type MQTTConnectOptions, type MQTTConnectionState } from '../services/MQTTService';
import type { Telemetry } from '../schemas/telemetry.schema';
import type { Manifest } from '../schemas/manifest.schema';
import type { MQTTCommand } from '../types/commands';

export interface DeviceSnapshot {
  online: boolean;
  connectionState: MQTTConnectionState;
  telemetry: Telemetry | null;
  lastTelemetryAt: number | null;
  manifest: Manifest | null;
}

export interface DeviceStore {
  getSnapshot: () => DeviceSnapshot;
  subscribe: (listener: () => void) => () => void;
  set: (patch: Partial<DeviceSnapshot>) => void;
}

function createDeviceStore(): DeviceStore {
  let state: DeviceSnapshot = { online: false, connectionState: 'connecting', telemetry: null, lastTelemetryAt: null, manifest: null };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(patch) {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
  };
}

const DeviceStoreContext = createContext<DeviceStore | null>(null);

export function DeviceProvider({
  connection,
  children,
}: {
  connection: MQTTConnectOptions;
  children: React.ReactNode;
}) {
  const storeRef = useRef<DeviceStore | null>(null);
  if (storeRef.current === null) storeRef.current = createDeviceStore();
  const store = storeRef.current;

  useEffect(() => {
    mqttService.onStatus((connectionState) =>
      store.set({
        connectionState,
        online: connectionState === 'connected',
        // Drop the last payload when the link is fully down, so screens never present
        // stale readings (e.g. after a factory reset) as if the device were still live.
        ...(connectionState === 'offline' ? { telemetry: null, lastTelemetryAt: null } : {}),
      }),
    );
    mqttService.onManifest((manifest) => store.set({ manifest }));
    mqttService.onTelemetry((telemetry) => store.set({ telemetry, lastTelemetryAt: Date.now(), online: true, connectionState: 'connected' }));
    mqttService.connect(connection);
    return () => mqttService.disconnect();
    // The connection target is fixed for a device session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <DeviceStoreContext.Provider value={store}>{children}</DeviceStoreContext.Provider>;
}

export function useDeviceStore(): DeviceStore {
  const store = useContext(DeviceStoreContext);
  if (!store) throw new Error('Device hooks must be used within <DeviceProvider>');
  return store;
}

/** Connection status. Re-renders only when `online` flips. */
export function useConnection(): boolean {
  const store = useDeviceStore();
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().online);
}

export function useConnectionState(): MQTTConnectionState {
  const store = useDeviceStore();
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().connectionState);
}

export function useLastTelemetryAt(): number | null {
  const store = useDeviceStore();
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().lastTelemetryAt);
}

/**
 * Debounced offline flag for UI banners. Returns true only after the connection
 * has been down for `delayMs` continuously — so brief blips that auto-recover
 * never flash the "offline" banner. Reconnection clears it immediately.
 */
export function useStableOffline(delayMs = 3000): boolean {
  const online = useConnection();
  const [showOffline, setShowOffline] = useState(false);

  useEffect(() => {
    if (online) {
      setShowOffline(false); // recovered → hide at once
      return;
    }
    const timer = setTimeout(() => setShowOffline(true), delayMs);
    return () => clearTimeout(timer); // reconnected before delay → never shows
  }, [online, delayMs]);

  return showOffline;
}

/** Capabilities Manifest (tab gating, volume steps…). Re-renders only on manifest change. */
export function useManifest(): Manifest | null {
  const store = useDeviceStore();
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().manifest);
}

/**
 * Command dispatch. Screens build a command with the pure builders in types/commands
 * and publish it through this hook — they never touch the MQTT service directly (SRS §1.3.1).
 * The returned function is stable, so it is safe in deps arrays.
 */
export function usePublish(): (command: MQTTCommand) => void {
  // Asserts we are inside a provider.
  useDeviceStore();
  return useCallback((command: MQTTCommand) => mqttService.publishCommand(command), []);
}

export function usePublishWithAck(): (command: MQTTCommand, timeoutMs?: number) => Promise<boolean> {
  // Asserts we are inside a provider.
  useDeviceStore();
  return useCallback(
    (command: MQTTCommand, timeoutMs?: number) => mqttService.publishCommandWithAck(command, timeoutMs),
    [],
  );
}





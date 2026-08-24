/**
 * Telemetry selector hooks (SRS §3.2.4 fields).
 *
 * Each hook subscribes to the DeviceStore and recomputes ONE derived value;
 * useSyncExternalStore re-renders the caller only when that value changes by
 * Object.is. Selectors must return primitives (or memoised references) to stay
 * re-render-safe — the 2-second telemetry broadcast will not churn the UI.
 */
import { useRef, useSyncExternalStore } from 'react';
import { useDeviceStore } from '../contexts/DeviceContext';
import type { Telemetry } from '../schemas/telemetry.schema';

/** Generic selector over the latest telemetry payload. */
export function useDeviceTelemetry<T>(selector: (t: Telemetry | null) => T): T {
  const store = useDeviceStore();
  const lastTelemetryRef = useRef<Telemetry | null | undefined>(undefined);
  const lastSnapshotRef = useRef<T | undefined>(undefined);
  const lastSelectorRef = useRef<((t: Telemetry | null) => T) | undefined>(undefined);

  return useSyncExternalStore(
    store.subscribe,
    () => {
      const telemetry = store.getSnapshot().telemetry;
      const selectorChanged = selector !== lastSelectorRef.current;

      if (!selectorChanged && telemetry === lastTelemetryRef.current && lastSnapshotRef.current !== undefined) {
        return lastSnapshotRef.current as T;
      }

      const nextSnapshot = selector(telemetry);
      lastTelemetryRef.current = telemetry;
      lastSelectorRef.current = selector;
      lastSnapshotRef.current = nextSnapshot;
      return nextSnapshot;
    },
  );
}

// ---- Field selectors (primitive returns = re-render-safe) ----

/** waterLevelStatus — 'full' | 'medium' | 'low' | 'empty' | null. App blocks vapour when 'empty'. */
export const useWaterLevel = () => useDeviceTelemetry((t) => t?.vapor.waterLevel ?? null);

/** currentTemperatureC — °C from the DHT sensor, or null when no climate module. */
export const useCurrentTemp = () => useDeviceTelemetry((t) => t?.climate?.currentTemp ?? null);

export const useHumidity = () => useDeviceTelemetry((t) => t?.climate?.humidity ?? null);
export const useTargetTemp = () => useDeviceTelemetry((t) => t?.climate?.targetTemp ?? null);
export const useHeaterOn = () => useDeviceTelemetry((t) => t?.climate?.heaterOn ?? false);
export const useHeaterStage = () => useDeviceTelemetry((t) => t?.climate?.stage ?? 1);
/** True once the device has actually reported a climate section. */
export const useClimateReporting = () => useDeviceTelemetry((t) => t?.climate != null);
export const usePower = () => useDeviceTelemetry((t) => t?.power ?? false);
export const useVaporOn = () => useDeviceTelemetry((t) => t?.vapor.on ?? false);
export const useVaporIntensity = () => useDeviceTelemetry((t) => t?.vapor.intensity ?? 0);
export const useWifiRssi = () => useDeviceTelemetry((t) => t?.wifiRssi ?? null);

/** Sleep-timer countdown seconds (Home screen source, FR-TMR). */
export const useSleepRemaining = () =>
  useDeviceTelemetry((t) => (t?.timer?.sleepActive ? t.timer.sleepRemaining : null));

// ---- Audio (FR-AUD) ----
export const useAudioOn = () => useDeviceTelemetry((t) => t?.audio?.on ?? false);
export const useAudioVolume = () => useDeviceTelemetry((t) => t?.audio?.volume ?? 0);
export const useAudioTrackIndex = () => useDeviceTelemetry((t) => t?.audio?.trackIndex ?? null);
export const useAudioTrackName = () => useDeviceTelemetry((t) => t?.audio?.trackName ?? null);
/** True once the device has actually reported an audio section (vs. an audio-less SKU). */
export const useAudioReporting = () => useDeviceTelemetry((t) => t?.audio != null);

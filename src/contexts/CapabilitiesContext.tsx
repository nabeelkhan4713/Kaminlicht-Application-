/**
 * CapabilitiesContext — derives UI composition rules from the Capabilities Manifest
 * (SRS §3.3, §2.5). Tab visibility is driven by hardware capabilities, NEVER by the
 * skuHint string. Values come from the DeviceStore via useManifest(), so these hooks
 * re-render only when the manifest changes.
 */
import { useManifest } from './DeviceContext';
import type { Manifest } from '../schemas/manifest.schema';

export type Capabilities = Manifest['capabilities'];

export function useCapabilities(): Capabilities | null {
  return useManifest()?.capabilities ?? null;
}

/** Climate tab is present when a heater OR an exhaust fan is fitted (KL-HEAT/CASE/PRO). */
export function useHasClimateTab(): boolean {
  const c = useCapabilities();
  return !!c && (c.climate.heater || c.exhaustFan.present);
}

export function useHasHeater(): boolean {
  return !!useCapabilities()?.climate.heater;
}

export function useHasExhaustFan(): boolean {
  return !!useCapabilities()?.exhaustFan.present;
}

/** Number of heater power stages (0 = none, 2 = the two 1000W units). */
export function useHeaterStages(): number {
  return useCapabilities()?.climate.stages ?? 0;
}

/** True only when the heater supports a target-temperature thermostat. */
export function useHasThermostat(): boolean {
  return !!useCapabilities()?.climate.thermostat;
}

export function useAudioVolumeSteps(): number {
  return useCapabilities()?.audio.volumeSteps ?? 10;
}

/** Audio tab is present only when the SKU actually ships the sound module (FR-AUD). */
export function useHasAudio(): boolean {
  return !!useCapabilities()?.audio.present;
}

/** Next/previous track buttons are shown only when the module supports them. */
export function useHasTrackControl(): boolean {
  return !!useCapabilities()?.audio.trackControl;
}

/**
 * MQTT command type system + typed, range-validated builders — SRS §3.2.3.
 * Envelope: { module, action, value, [zone], msgId }.
 *
 * Architecture rules (SRS §1.3.1):
 *  - No React imports, no state, no side effects in this file.
 *  - Every builder is pure and range-validates its input.
 *  - A unique msgId (UUID v4 form) is appended to every command for ack correlation (kl/{sn}/ack).
 */
import type { LightZone, FanSpeed } from '../schemas/manifest.schema';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface MQTTCommand {
  module: 'system' | 'vapor' | 'lighting' | 'climate' | 'audio' | 'exhaustFan' | 'blower' | 'timer';
  action: string;
  value: unknown;
  zone?: LightZone;
  msgId: string;
}

/** The two flame/vapour blowers (same job; controlled independently). */
export type BlowerId = 1 | 2;

/**
 * RFC4122-style v4 id. Pure JS so it needs no native crypto module and no rebuild.
 * TODO(production): swap for a crypto-backed UUID (uuid + react-native-get-random-values).
 */
function genMsgId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const cmd = (c: Omit<MQTTCommand, 'msgId'>): MQTTCommand => ({ ...c, msgId: genMsgId() });

const assertRange = (label: string, v: number, lo: number, hi: number) => {
  if (!Number.isFinite(v) || v < lo || v > hi) {
    throw new RangeError(`${label} must be ${lo}–${hi}, got ${v}`);
  }
};

// ---- System & Power (FR-SYS / FR-HOT) ----
export const buildPowerCmd = (on: boolean) => cmd({ module: 'system', action: 'power', value: on });
export const buildHotelschaltungCmd = (on: boolean) =>
  cmd({ module: 'system', action: 'hotelschaltung', value: on });
export const buildFactoryResetCmd = () => cmd({ module: 'system', action: 'factory_reset', value: null });
export const buildAddWifiCmd = (ssid: string, password: string) =>
  cmd({ module: 'system', action: 'add_wifi', value: { ssid, password } });

// ---- Vapour (FR-VAP) ----
export const buildVaporPowerCmd = (on: boolean) => cmd({ module: 'vapor', action: 'power', value: on });
export const buildVaporIntensityCmd = (level: number) => {
  assertRange('vapor intensity', level, 1, 6);
  return cmd({ module: 'vapor', action: 'set_intensity', value: level });
};

// ---- Lighting (FR-LGT) — zones fully independent ----
export const buildColorCmd = (zone: LightZone, color: Rgb) => {
  assertRange('r', color.r, 0, 255);
  assertRange('g', color.g, 0, 255);
  assertRange('b', color.b, 0, 255);
  return cmd({ module: 'lighting', zone, action: 'set_color', value: color });
};
export const buildBrightnessCmd = (zone: LightZone, brightness: number) => {
  assertRange('brightness', brightness, 0, 100);
  return cmd({ module: 'lighting', zone, action: 'set_brightness', value: brightness });
};
export const buildZonePowerCmd = (zone: LightZone, on: boolean) =>
  cmd({ module: 'lighting', zone, action: 'power', value: on });

// ---- Climate (FR-CLI) — thermostat 16–26 °C, stage 1=1000W 2=2000W ----
export const buildHeaterPowerCmd = (on: boolean) => cmd({ module: 'climate', action: 'power', value: on });
export const buildThermostatCmd = (celsius: number) => {
  assertRange('thermostat', celsius, 16, 26);
  return cmd({ module: 'climate', action: 'set_thermostat', value: celsius });
};
export const buildHeaterStageCmd = (stage: 1 | 2) =>
  cmd({ module: 'climate', action: 'set_stage', value: stage });

// ---- Audio (FR-AUD) ----
export const buildAudioPowerCmd = (on: boolean) => cmd({ module: 'audio', action: 'power', value: on });
export const buildVolumeCmd = (volume: number, maxSteps = 10) => {
  assertRange('volume', volume, 0, maxSteps);
  return cmd({ module: 'audio', action: 'set_volume', value: volume });
};
export const buildTrackCmd = (direction: 'next' | 'prev') =>
  cmd({ module: 'audio', action: 'track', value: direction });

// ---- Exhaust Fan (FR-FAN) ----
export const buildFanSpeedCmd = (speed: FanSpeed) =>
  cmd({ module: 'exhaustFan', action: 'set_speed', value: speed });

// ---- Blowers (FR-BLW) — two blowers, same job, controlled independently ----
export const buildBlowerPowerCmd = (id: BlowerId, on: boolean) =>
  cmd({ module: 'blower', action: 'power', value: { id, on } });
export const buildBlowerSpeedCmd = (id: BlowerId, speed: number) => {
  assertRange('blower speed', speed, 0, 100);
  return cmd({ module: 'blower', action: 'set_speed', value: { id, speed } });
};

// ---- Timer (FR-TMR) — sleep in seconds, 0–28800 ----
export const buildSleepTimerCmd = (seconds: number) => {
  assertRange('sleep timer', seconds, 0, 28800);
  return cmd({ module: 'timer', action: 'set_sleep', value: seconds });
};

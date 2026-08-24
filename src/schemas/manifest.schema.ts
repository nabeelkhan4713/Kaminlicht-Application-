/**
 * Capabilities Manifest schema — SRS §3.3.
 * All inbound manifest payloads MUST be parsed through this schema before any
 * field is consumed (SRS §1.3.1, §3.3 Manifest Validation Rule).
 * Unknown extra fields are stripped silently (forward-compatibility).
 */
import { z } from 'zod';

const LightZoneEnum = z.enum(['flame']);
const FanSpeedEnum = z.enum(['off', 'low', 'medium', 'high']);

export const ManifestSchema = z.object({
  serialNumber: z.string(),
  firmwareVersion: z.string(),
  // skuHint is informational only — UI composition is NEVER based on SKU strings (SRS §3.3).
  skuHint: z.string().optional(),
  capabilities: z.object({
    vapor: z.boolean().default(false),
    lighting: z
      .object({
        zones: z.array(LightZoneEnum).default([]),
        relays: z.number().int().min(0).default(0),
      })
      .default({ zones: [], relays: 0 }),
    climate: z
      .object({
        heater: z.boolean().default(false),
        thermostat: z.boolean().default(false),
        stages: z.number().int().min(0).default(0),
      })
      .default({ heater: false, thermostat: false, stages: 0 }),
    audio: z
      .object({
        present: z.boolean().default(false),
        volumeSteps: z.number().int().min(0).default(0),
        trackControl: z.boolean().default(false),
      })
      .default({ present: false, volumeSteps: 0, trackControl: false }),
    exhaustFan: z
      .object({
        present: z.boolean().default(false),
        speeds: z.array(FanSpeedEnum).default([]),
      })
      .default({ present: false, speeds: [] }),
    remoteControl: z
      .object({
        present: z.boolean().default(false),
        gpio: z.number().int().optional(),
      })
      .default({ present: false }),
    hotelschaltung: z.boolean().default(false),
  }),
  network: z
    .object({
      mdnsHostname: z.string().optional(),
      /** The unit's current LAN IP — fallback for networks where .local does not resolve. */
      ip: z.string().optional(),
      mqttPort: z.number().int().default(1883),
      wsPort: z.number().int().default(9001),
    })
    .default({ mqttPort: 1883, wsPort: 9001 }),
});

export type Manifest = z.infer<typeof ManifestSchema>;
export type LightZone = z.infer<typeof LightZoneEnum>;
export type FanSpeed = z.infer<typeof FanSpeedEnum>;


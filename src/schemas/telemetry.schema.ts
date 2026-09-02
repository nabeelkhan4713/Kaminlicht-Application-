/**
 * Complete Telemetry Payload schema — SRS §3.2.4.
 * Published by the device every 2 s on kl/{sn}/telemetry (QoS 0).
 * All inbound telemetry MUST be parsed through this schema before any field is
 * consumed (SRS §1.3.1). Module sections are optional: they are omitted on SKUs
 * that lack the corresponding hardware (e.g. climate/exhaustFan on KL-BASE).
 */
import { z } from 'zod';

const RgbZoneSchema = z.object({
  on: z.boolean(),
  r: z.number().int().min(0).max(255),
  g: z.number().int().min(0).max(255),
  b: z.number().int().min(0).max(255),
  brightness: z.number().int().min(0).max(100),
});

export const TelemetrySchema = z.object({
  ts: z.number().int(), // Unix seconds. Identical ts on 3 consecutive payloads = frozen firmware (FR-SYS-005).
  online: z.boolean(),
  uptime: z.number().int().optional(),
  firmwareVersion: z.string().optional(),
  wifiRssi: z.number().int().min(-100).max(0), // Warning banner when < -70 (FR-SYS-003).
  power: z.boolean(),
  hotelschaltung: z.boolean().optional(),

  vapor: z.object({
    on: z.boolean(),
    intensity: z.number().int().min(0).max(6),
    // Only reported when a water-level sensor is fitted. Absent = unknown (app shows "—",
    // does not block vapour). Never send a placeholder. (FR-VAP-005)
    waterLevel: z.enum(['full', 'medium', 'low', 'empty']).optional(),
  }),

  lighting: z
    .object({
      flame: RgbZoneSchema.optional(),
    })
    .optional(),

  climate: z
    .object({
      heaterOn: z.boolean(),
      stage: z.number().int().min(1).max(2).optional(), // omitted when heater absent
      // The next three are reported ONLY when the matching sensor/thermostat is fitted.
      // Absent = unknown (app shows "—"). The firmware must never send a placeholder.
      targetTemp: z.number().optional(),
      currentTemp: z.number().min(-10).max(50).optional(),
      humidity: z.number().min(0).max(100).optional(),
    })
    .optional(),

  audio: z
    .object({
      on: z.boolean(),
      volume: z.number().int().min(0),
      trackIndex: z.number().int().min(0),
      trackName: z.string(),
    })
    .optional(),

  exhaustFan: z
    .object({
      on: z.boolean(),
      speed: z.enum(['off', 'low', 'medium', 'high']),
    })
    .optional(),

  timer: z
    .object({
      sleepActive: z.boolean(),
      sleepRemaining: z.number().int().min(0).max(28800),
      scheduleActive: z.boolean(),
      scheduleNext: z.number().int().nullable(),
    })
    .optional(),
});

export type Telemetry = z.infer<typeof TelemetrySchema>;


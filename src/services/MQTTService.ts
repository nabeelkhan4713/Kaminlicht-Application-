/**
 * MQTTService — Phase 2 operational transport (SRS §3.2).
 * Architecture rules (SRS §1.3.1):
 *  - No MQTT topic string may be hardcoded outside this file.
 *  - All inbound payloads are Zod-parsed before any field is exposed.
 *  - This is the ONLY file permitted to call the mqtt library.
 *
 * Transport note: React Native cannot open raw TCP, so we connect over the
 * WebSocket port (SRS §3.2.1 fallback port 9001). On the Android emulator the
 * host PC is reachable at 10.0.2.2.
 */
import mqtt, { type MqttClient } from 'mqtt';
import { TelemetrySchema, type Telemetry } from '../schemas/telemetry.schema';
import { ManifestSchema, type Manifest } from '../schemas/manifest.schema';
import type { MQTTCommand } from '../types/commands';

// Topic schema — SRS §3.2.2. Constructed ONLY here.
const buildTopics = (sn: string) => ({
  cmd: `kl/${sn}/cmd`,
  telemetry: `kl/${sn}/telemetry`,
  manifest: `kl/${sn}/manifest`,
  status: `kl/${sn}/status`,
  ack: `kl/${sn}/ack`,
});

export interface MQTTConnectOptions {
  hosts: string[]; // tried in order; mqtt.js round-robins on each reconnect
  serialNumber: string;
  wsPort?: number;
}

type TelemetryHandler = (t: Telemetry) => void;
type ManifestHandler = (m: Manifest) => void;
export type MQTTConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';
type StatusHandler = (state: MQTTConnectionState) => void;
type AckHandler = (msgId: string, ok: boolean) => void;
type PendingAck = { resolve: (ok: boolean) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

export class MQTTService {
  private client: MqttClient | null = null;
  private topics = buildTopics('');
  private telemetryCb?: TelemetryHandler;
  private manifestCb?: ManifestHandler;
  private statusCb?: StatusHandler;
  private ackCb?: AckHandler;
  private pendingAcks = new Map<string, PendingAck>();

  connect({ hosts, serialNumber, wsPort = 9001 }: MQTTConnectOptions): void {
    this.topics = buildTopics(serialNumber);
    this.statusCb?.('connecting');

    // mqtt.js cycles through `servers` on each reconnect, so it auto-finds whichever
    // host is reachable on the current network — no single hardcoded IP.
    this.client = mqtt.connect({
      servers: hosts.map((host) => ({ host, port: wsPort, protocol: 'ws' as const })),
      keepalive: 60, // higher = fewer pings, more tolerant of a laggy/weak link
      reconnectPeriod: 2000, // back-off floor (SRS §3.2.1)
      connectTimeout: 30000, // wait longer for CONNACK on a weak Wi-Fi signal
      clean: true,
    });

    this.client.on('connect', () => {
      console.log('[MQTT] connected');
      this.client!.subscribe(
        [this.topics.telemetry, this.topics.manifest, this.topics.status, this.topics.ack],
        { qos: 1 },
      );
      this.statusCb?.('connected');
      this.requestManifest();
    });

    this.client.on('message', (topic, payload) => this.route(topic, payload));
    this.client.on('reconnect', () => {
      console.log('[MQTT] reconnecting...');
      this.statusCb?.('reconnecting');
    });
    this.client.on('error', (e) => console.log('[MQTT] error:', e.message));
    this.client.on('close', () => this.statusCb?.('offline'));
  }

  private route(topic: string, payload: Buffer): void {
    let data: unknown;
    try {
      data = JSON.parse(payload.toString());
    } catch {
      console.log('[MQTT] non-JSON payload on', topic);
      return;
    }

    if (topic === this.topics.telemetry) {
      const r = TelemetrySchema.safeParse(data);
      if (r.success) this.telemetryCb?.(r.data);
      else console.log('[MQTT] invalid telemetry:', r.error.message);
    } else if (topic === this.topics.manifest) {
      const r = ManifestSchema.safeParse(data);
      if (r.success) this.manifestCb?.(r.data);
      else console.log('[MQTT] invalid manifest:', r.error.message);
    } else if (topic === this.topics.status) {
      this.statusCb?.((data as { online?: boolean })?.online === true ? 'connected' : 'offline');
    } else if (topic === this.topics.ack) {
      const ack = data as { msgId?: string; ok?: boolean };
      if (ack?.msgId) this.handleAck(ack.msgId, ack.ok !== false);
    }
  }

  /** Publish a typed control command. QoS 0 - the on-device PicoMQTT broker is QoS-0 only. */
  publishCommand(command: MQTTCommand): void {
    this.client?.publish(this.topics.cmd, JSON.stringify(command), { qos: 0 });
  }

  publishCommandWithAck(command: MQTTCommand, timeoutMs = 5000): Promise<boolean> {
    if (!this.client?.connected) {
      return Promise.reject(new Error('Fireplace is not connected over Wi-Fi.'));
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingAcks.delete(command.msgId);
        reject(new Error('No confirmation from fireplace.'));
      }, timeoutMs);
      this.pendingAcks.set(command.msgId, { resolve, reject, timer });
      this.publishCommand(command);
    });
  }

  private handleAck(msgId: string, ok: boolean): void {
    this.ackCb?.(msgId, ok);
    const pending = this.pendingAcks.get(msgId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingAcks.delete(msgId);
    pending.resolve(ok);
  }

  /** Ask the device to (re)publish its Capabilities Manifest (SRS §3.1.3 step 10). */
  requestManifest(): void {
    this.client?.publish(
      this.topics.cmd,
      JSON.stringify({ module: 'system', action: 'request_manifest', value: null, msgId: 'manifest-req' }),
      { qos: 0 },
    );
  }

  onTelemetry(cb: TelemetryHandler): void {
    this.telemetryCb = cb;
  }
  onManifest(cb: ManifestHandler): void {
    this.manifestCb = cb;
  }
  onStatus(cb: StatusHandler): void {
    this.statusCb = cb;
  }
  onAck(cb: AckHandler): void {
    this.ackCb = cb;
  }

  disconnect(): void {
    for (const pending of this.pendingAcks.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('MQTT disconnected before confirmation.'));
    }
    this.pendingAcks.clear();
    this.client?.end(true);
    this.client = null;
    this.statusCb?.('offline');
  }
}

export const mqttService = new MQTTService();




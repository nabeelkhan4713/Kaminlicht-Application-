/*
 * Mock ESP32-S3 WD Cassette firmware (Roadmap Task 1.5).
 * Stands in for real hardware during Phase 1 so the app can be developed before
 * the firmware/dev board arrive. Implements the SRS §3.2 MQTT contract:
 *   - aedes broker on TCP 1883 (MQTT Explorer) AND WebSocket 9001 (the RN app)
 *   - publishes the Capabilities Manifest (§3.3) on subscribe
 *   - publishes full telemetry (§3.2.4) every 2 s
 *   - accepts commands on kl/{sn}/cmd (§3.2.3), mutates state, echoes acks
 *
 * Usage:  node simulator.js --sku KL-PRO            (KL-BASE | KL-HEAT | KL-CASE | KL-PRO)
 *         node simulator.js --sku KL-BASE --serial KL-2026-A3F92C
 */
const aedes = require('aedes')();
const net = require('net');
const http = require('http');
const ws = require('websocket-stream');

const TCP_PORT = 1883;
const WS_PORT = 9001;

// ---- CLI args ----
const argv = process.argv.slice(2);
const argOf = (flag, def) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const SKU = argOf('--sku', 'KL-PRO').toUpperCase();
const SERIAL = argOf('--serial', 'KL-2026-A3F92C');
const SN = SERIAL; // {sn} in the topic schema
const T = {
  cmd: `kl/${SN}/cmd`,
  telemetry: `kl/${SN}/telemetry`,
  manifest: `kl/${SN}/manifest`,
  status: `kl/${SN}/status`,
  ack: `kl/${SN}/ack`,
};

// ---- Per-SKU capability matrix (SRS §2.5) ----
const HAS = {
  'KL-BASE': { heater: false, fan: false, relays: 0 },
  'KL-HEAT': { heater: true, fan: false, relays: 0 },
  'KL-CASE': { heater: false, fan: true, relays: 3 },
  'KL-PRO': { heater: true, fan: true, relays: 3 },
}[SKU] || { heater: true, fan: true, relays: 3 };

function buildManifest() {
  return {
    serialNumber: SERIAL,
    firmwareVersion: '1.0.0-mock',
    skuHint: SKU,
    capabilities: {
      vapor: true,
      lighting: { zones: ['flame', 'ambient', 'glow'], relays: HAS.relays },
      climate: { heater: HAS.heater, thermostat: HAS.heater, stages: HAS.heater ? 2 : 0 },
      audio: { present: true, volumeSteps: 10, trackControl: true },
      exhaustFan: { present: HAS.fan, speeds: HAS.fan ? ['off', 'low', 'medium', 'high'] : [] },
      remoteControl: { present: true, gpio: 6 },
      hotelschaltung: true,
    },
    network: {
      mdnsHostname: `kl-${SERIAL.split('-').pop().toLowerCase()}.local`,
      mqttPort: TCP_PORT,
      wsPort: WS_PORT,
    },
  };
}

// ---- Mutable device state (seeds the telemetry payload, §3.2.4) ----
const bootedAt = Date.now();
const state = {
  power: true,
  hotelschaltung: false,
  vapor: { on: true, intensity: 3, waterLevel: 'medium' },
  lighting: {
    flame: { on: true, r: 255, g: 80, b: 0, brightness: 85 },
    ambient: { on: true, r: 200, g: 50, b: 0, brightness: 70 },
    glow: { on: true, r: 180, g: 30, b: 0, brightness: 60 },
    relays: { R1: false, R2: false, R3: false },
  },
  climate: { heaterOn: false, stage: 1, targetTemp: 21, currentTemp: 19.5, humidity: 48.2 },
  audio: { on: false, volume: 7, trackIndex: 2, trackName: 'Fireplace Crackling' },
  exhaustFan: { on: false, speed: 'off' },
  timer: { sleepActive: false, sleepRemaining: 0, scheduleActive: false, scheduleNext: null },
};

function buildTelemetry() {
  const t = {
    ts: Math.floor(Date.now() / 1000),
    online: true,
    uptime: Math.floor((Date.now() - bootedAt) / 1000),
    firmwareVersion: '1.0.0-mock',
    wifiRssi: -55 - Math.floor(Math.random() * 12), // jitter -55..-66
    power: state.power,
    hotelschaltung: state.hotelschaltung,
    vapor: state.vapor,
    lighting: { ...state.lighting },
    audio: state.audio,
  };
  if (!HAS.relays) delete t.lighting.relays;
  if (HAS.heater) t.climate = state.climate; // stage included only when heater present
  if (HAS.fan) t.exhaustFan = state.exhaustFan;
  t.timer = state.timer;
  return t;
}

// ---- Command handling (§3.2.3) ----
function applyCommand(c) {
  switch (c.module) {
    case 'system':
      if (c.action === 'power') state.power = !!c.value;
      else if (c.action === 'hotelschaltung') state.hotelschaltung = !!c.value;
      break;
    case 'vapor':
      if (c.action === 'power') state.vapor.on = !!c.value;
      else if (c.action === 'set_intensity') state.vapor.intensity = c.value;
      break;
    case 'lighting': {
      const zone = state.lighting[c.zone];
      if (!zone) break;
      if (c.action === 'set_color') Object.assign(zone, c.value);
      else if (c.action === 'set_brightness') zone.brightness = c.value;
      else if (c.action === 'power') zone.on = !!c.value;
      break;
    }
    case 'climate':
      if (!HAS.heater) break;
      if (c.action === 'power') state.climate.heaterOn = !!c.value;
      else if (c.action === 'set_thermostat') state.climate.targetTemp = c.value;
      else if (c.action === 'set_stage') state.climate.stage = c.value;
      break;
    case 'audio':
      if (c.action === 'power') state.audio.on = !!c.value;
      else if (c.action === 'set_volume') state.audio.volume = c.value;
      else if (c.action === 'track') state.audio.trackIndex += c.value === 'next' ? 1 : -1;
      break;
    case 'exhaustFan':
      if (!HAS.fan) break;
      if (c.action === 'set_speed') {
        state.exhaustFan.speed = c.value;
        state.exhaustFan.on = c.value !== 'off';
      }
      break;
    case 'timer':
      if (c.action === 'set_sleep') {
        state.timer.sleepActive = c.value > 0;
        state.timer.sleepRemaining = c.value;
      }
      break;
  }
}

aedes.on('client', (client) => console.log(`[sim] client connected: ${client.id}`));

aedes.on('subscribe', (subs, client) => {
  // Publish the manifest as soon as anyone subscribes to it (SRS §3.1.3 step 10).
  if (subs.some((s) => s.topic === T.manifest)) {
    aedes.publish({ topic: T.manifest, payload: JSON.stringify(buildManifest()), qos: 1 });
    console.log(`[sim] manifest sent to ${client ? client.id : 'broker'}`);
  }
});

aedes.on('publish', (packet) => {
  if (packet.topic !== T.cmd || !packet.payload) return;
  let c;
  try {
    c = JSON.parse(packet.payload.toString());
  } catch {
    return;
  }
  if (c.action === 'request_manifest') {
    aedes.publish({ topic: T.manifest, payload: JSON.stringify(buildManifest()), qos: 1 });
    return;
  }
  applyCommand(c);
  console.log(`[sim] cmd ${c.module}/${c.action}=${JSON.stringify(c.value)}`);
  if (c.msgId) {
    aedes.publish({
      topic: T.ack,
      payload: JSON.stringify({ msgId: c.msgId, ok: true, ts: Math.floor(Date.now() / 1000) }),
      qos: 1,
    });
  }
});

// ---- Listeners ----
net.createServer(aedes.handle).listen(TCP_PORT, () =>
  console.log(`[sim] MQTT/TCP  on ${TCP_PORT}`),
);
const httpServer = http.createServer();
ws.createServer({ server: httpServer }, aedes.handle);
httpServer.listen(WS_PORT, () => console.log(`[sim] MQTT/WS   on ${WS_PORT}  (app connects here)`));

// ---- Periodic publishers ----
aedes.publish({ topic: T.status, payload: JSON.stringify({ online: true }), qos: 1 });
setInterval(() => {
  if (state.timer.sleepActive && state.timer.sleepRemaining > 0) {
    state.timer.sleepRemaining = Math.max(0, state.timer.sleepRemaining - 2);
    if (state.timer.sleepRemaining === 0) {
      state.timer.sleepActive = false;
      state.power = false;
    }
  }
  // gentle temperature drift toward target when heating
  if (HAS.heater && state.climate.heaterOn) {
    const d = state.climate.targetTemp - state.climate.currentTemp;
    state.climate.currentTemp = +(state.climate.currentTemp + Math.sign(d) * 0.1).toFixed(1);
  }
  aedes.publish({ topic: T.telemetry, payload: JSON.stringify(buildTelemetry()), qos: 0 });
}, 2000);

console.log(`\n[sim] Mock WD Cassette — SKU=${SKU}  serial=${SERIAL}`);
console.log(`[sim] topic base: kl/${SN}/*`);
console.log(`[sim] telemetry every 2 s · Ctrl+C to stop\n`);

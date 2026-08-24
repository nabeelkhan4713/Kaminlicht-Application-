/*
 * Glow Fire — ESP32 firmware (Phase 2: BLE provisioning + Wi-Fi MQTT control).
 *
 * FLOW:
 *  - Boot: load saved Wi-Fi from flash.
 *      • found  → connect Wi-Fi → start MQTT broker (normal use, BLE stays off)
 *      • none   → start BLE setup → wait for "WIFI:ssid,password" → SAVE to flash
 *                 → connect → start MQTT → turn BLE off
 *  - Factory reset: send "RESET" over BLE (or MQTT system/factory_reset) → wipes Wi-Fi → reboots.
 *
 * Libraries: PicoMQTT, ArduinoJson (v7), Adafruit NeoPixel, ESP32 BLE (built in).
 * Board: ESP32 Dev Module. Serial Monitor: 115200.
 *
 * NOTE: BLE + Wi-Fi + MQTT is large. If it won't compile ("Sketch too big"),
 *       set Tools → Partition Scheme → "Huge APP (3MB No OTA/1MB SPIFFS)".
 */
#include <WiFi.h>
#include <Preferences.h>
#include <ESPmDNS.h>
#include <Arduino.h>
#include <PicoMQTT.h>
#include <PicoWebsocket.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ---------- CONFIG ----------
const char* SERIAL_NO       = "KL-2026-A3F92C";   // MUST match the app's serialNumber
const char* MDNS_HOST       = "kl-glowfire";      // device reachable at kl-glowfire.local
const char* BLE_DEVICE_NAME = "KL-GlowFire-Setup"; // shown when scanning over Bluetooth

// Nordic UART Service UUIDs (the app writes credentials to RX, reads replies on TX)
#define UART_SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define UART_RX_UUID      "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  // phone → ESP32
#define UART_TX_UUID      "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  // ESP32 → phone

#define LED_PIN   2
#define STRIP_PIN 25
#define NUM_LEDS  10
Adafruit_NeoPixel strip(NUM_LEDS, STRIP_PIN, NEO_GRB + NEO_KHZ800);

// ---------- Broker over WebSocket on 9001 ----------
WiFiServer tcpServer(9001);
PicoWebsocket::Server<::WiFiServer> wsServer(tcpServer);
PicoMQTT::Server mqtt(wsServer);

Preferences prefs;  // flash storage for Wi-Fi credentials

// ---------- Topics & state ----------
String T_CMD, T_TLM, T_MAN, T_ACK;
bool power = false, vaporOn = true;
bool flameLightOn = false;
int  vaporIntensity = 3;
uint8_t flameR = 255, flameG = 80, flameB = 0;
int flameBrightness = 85;
unsigned long bootMs = 0, lastTlm = 0;
bool sleepTimerActive = false;
unsigned long sleepTimerEndMs = 0;
uint32_t sleepTimerDurationSec = 0;
bool mqttStarted = false;
bool bleActive = false;
bool restartPending = false;
unsigned long restartAtMs = 0;

// ---------- Audio: DFPlayer Mini / MP3-TF-16P on UART2 (FR-AUD) ----------
// Pins confirmed with firmware/audio_pin_finder. GPIO26/27 avoid both the LED strip
// (GPIO25) and the GPIO12 strapping pin that causes a boot loop.
#define DFPLAYER_RX 26            // ESP32 receives  <- module TX
#define DFPLAYER_TX 27            // ESP32 sends     -> module RX
HardwareSerial dfSerial(2);

const int AUDIO_VOLUME_STEPS = 10;  // app-facing steps; must match manifest volumeSteps
const int DF_MAX_VOLUME = 30;       // DFPlayer hardware range is 0..30
bool audioOn = false;
int  audioVolume = 5;               // 0..AUDIO_VOLUME_STEPS
int  audioTrackIndex = 0;           // 0-based; SD files are 0001.mp3, 0002.mp3, ...
int  audioTrackCount = 1;           // read from the SD card at boot
bool dfReady = false;

BLECharacteristic* txCharacteristic = nullptr;
bool bleClientConnected = false;

struct CachedWifiNetwork {
  String ssid;
  int rssi;
  int secure;
};
const int WIFI_SCAN_CACHE_MAX = 16;
CachedWifiNetwork wifiScanCache[WIFI_SCAN_CACHE_MAX];
int wifiScanCacheCount = 0;
struct WifiCred {
  String ssid;
  String pass;
};

const int WIFI_SLOT_COUNT = 1;

String wifiKey(const char* prefix, int slot) {
  return String(prefix) + String(slot);
}

void saveWifiSlot(int slot, const String& ssid, const String& pass) {
  prefs.begin("wifi", false);
  prefs.putString(wifiKey("ssid", slot).c_str(), ssid);
  prefs.putString(wifiKey("pass", slot).c_str(), pass);
  prefs.end();
  Serial.printf("[wifi] saved slot %d: %s\n", slot, ssid.c_str());
}

void clearSavedWifi() {
  prefs.begin("wifi", false);
  prefs.clear();
  prefs.end();
  Serial.println("[wifi] saved credentials cleared");
}

void setLastWifiFailure(const String& reason) {
  prefs.begin("setup", false);
  prefs.putString("lastFail", reason);
  prefs.end();
}

String consumeLastWifiFailure() {
  prefs.begin("setup", false);
  String reason = prefs.getString("lastFail", "");
  if (reason.length() > 0) prefs.remove("lastFail");
  prefs.end();
  return reason;
}

WifiCred loadWifiSlot(int slot) {
  WifiCred cred;
  prefs.begin("wifi", true);
  cred.ssid = prefs.getString(wifiKey("ssid", slot).c_str(), "");
  cred.pass = prefs.getString(wifiKey("pass", slot).c_str(), "");
  prefs.end();
  return cred;
}

void migrateLegacyWifiIfNeeded() {
  WifiCred slot0 = loadWifiSlot(0);
  if (slot0.ssid.length() > 0) return;

  prefs.begin("wifi", false);
  String legacySsid = prefs.getString("ssid", "");
  String legacyPass = prefs.getString("pass", "");
  if (legacySsid.length() > 0) {
    prefs.putString("ssid0", legacySsid);
    prefs.putString("pass0", legacyPass);
    prefs.remove("ssid");
    prefs.remove("pass");
    Serial.println("[wifi] migrated legacy Wi-Fi to slot 0");
  }
  prefs.end();
}

bool hasSavedWifi() {
  for (int i = 0; i < WIFI_SLOT_COUNT; i++) {
    if (loadWifiSlot(i).ssid.length() > 0) return true;
  }
  return false;
}

bool chooseBestSavedWifi(WifiCred& best) {
  WifiCred saved[WIFI_SLOT_COUNT];
  for (int i = 0; i < WIFI_SLOT_COUNT; i++) saved[i] = loadWifiSlot(i);

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(100);
  Serial.println("[wifi] scanning for saved networks...");
  int found = WiFi.scanNetworks();
  int bestRssi = -1000;
  int bestSlot = -1;

  for (int n = 0; n < found; n++) {
    String seen = WiFi.SSID(n);
    int rssi = WiFi.RSSI(n);
    for (int slot = 0; slot < WIFI_SLOT_COUNT; slot++) {
      if (saved[slot].ssid.length() > 0 && seen == saved[slot].ssid && rssi > bestRssi) {
        bestRssi = rssi;
        bestSlot = slot;
      }
    }
  }
  WiFi.scanDelete();

  if (bestSlot >= 0) {
    best = saved[bestSlot];
    Serial.printf("[wifi] selected slot %d (%s), RSSI %d\n", bestSlot, best.ssid.c_str(), bestRssi);
    return true;
  }
  return false;
}

// ---------- DFPlayer serial protocol ----------
// Frames are 10 bytes: 7E FF 06 CMD FEEDBACK PARAM_HI PARAM_LO CHK_HI CHK_LO EF.
// Written directly rather than via a library: no extra install, and the sketch is
// already close to the partition limit.
void dfSend(uint8_t cmd, uint16_t param) {
  uint8_t f[10] = { 0x7E, 0xFF, 0x06, cmd, 0x00,
                    (uint8_t)(param >> 8), (uint8_t)(param & 0xFF), 0x00, 0x00, 0xEF };
  uint16_t sum = 0;
  for (int i = 1; i <= 6; i++) sum += f[i];
  uint16_t chk = (uint16_t)(-sum);
  f[7] = chk >> 8;
  f[8] = chk & 0xFF;
  dfSerial.write(f, sizeof(f));
  dfSerial.flush();
}

/** Send a query and return its 16-bit payload, or -1 if the module did not answer. */
int dfQuery(uint8_t cmd) {
  while (dfSerial.available()) dfSerial.read();
  dfSend(cmd, 0);

  uint8_t b[10];
  int n = 0;
  unsigned long deadline = millis() + 400;
  while (millis() < deadline && n < (int)sizeof(b)) {
    if (dfSerial.available()) b[n++] = dfSerial.read();
  }
  if (n >= 10 && b[0] == 0x7E && b[3] == cmd) return (b[5] << 8) | b[6];
  return -1;
}

void dfSetVolume(int step) {
  int level = map(constrain(step, 0, AUDIO_VOLUME_STEPS), 0, AUDIO_VOLUME_STEPS, 0, DF_MAX_VOLUME);
  dfSend(0x06, level);
}

void dfPlayTrack(int index0) { dfSend(0x03, (uint16_t)(index0 + 1)); }  // files are 1-based
void dfStop() { dfSend(0x16, 0); }

void audioBegin() {
  dfSerial.begin(9600, SERIAL_8N1, DFPLAYER_RX, DFPLAYER_TX);
  delay(200);
  dfSend(0x0C, 0);              // reset
  delay(1500);                  // the module needs ~1s to come back up
  dfSend(0x09, 2);              // select the TF/SD card as source
  delay(300);

  int count = dfQuery(0x48);    // number of files on the card
  if (count > 0) {
    audioTrackCount = count;
    dfReady = true;
    Serial.printf("[audio] DFPlayer ready on RX=%d TX=%d, %d track(s)\n",
                  DFPLAYER_RX, DFPLAYER_TX, audioTrackCount);
  } else {
    // Commands still go out; only the track count is unknown (usually a missing SD card).
    audioTrackCount = 1;
    dfReady = false;
    Serial.println("[audio] DFPlayer did not report a track count - check the SD card");
  }
  dfSetVolume(audioVolume);
  dfStop();
}

int brightnessToNeoPixel(int percent) {
  return map(constrain(percent, 0, 100), 0, 100, 0, 255);
}

void setStrip(uint8_t r, uint8_t g, uint8_t b) {
  strip.setBrightness(brightnessToNeoPixel(flameBrightness));
  if (r == 0 && g == 0 && b == 0) {
    strip.clear();
  } else {
    for (int i = 0; i < NUM_LEDS; i++) strip.setPixelColor(i, strip.Color(r, g, b));
  }
  strip.show();
  Serial.printf("[strip] color %u %u %u brightness %d\n", r, g, b, flameBrightness);
}

void blePrint(const String& msg) {
  Serial.println(msg);
  if (txCharacteristic && bleClientConnected) {
    txCharacteristic->setValue((msg + "\n").c_str());
    txCharacteristic->notify();
  }
}

String sanitizeBleField(String value) {
  value.replace("|", " ");
  value.replace("\n", " ");
  value.replace("\r", " ");
  return value;
}

void refreshWifiScanCache() {
  wifiScanCacheCount = 0;
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.disconnect(false);
  delay(120);

  Serial.println("[ble-wifi] scanning nearby networks...");
  int found = WiFi.scanNetworks(false, true, false, 180, 0);
  Serial.printf("[ble-wifi] scan result: %d\n", found);
  if (found < 0) {
    WiFi.scanDelete();
    return;
  }

  for (int i = 0; i < found && wifiScanCacheCount < WIFI_SCAN_CACHE_MAX; i++) {
    String ssid = sanitizeBleField(WiFi.SSID(i));
    if (ssid.length() == 0) continue;
    bool duplicate = false;
    for (int j = 0; j < wifiScanCacheCount; j++) {
      if (wifiScanCache[j].ssid == ssid) { duplicate = true; break; }
    }
    if (duplicate) continue;

    wifiScanCache[wifiScanCacheCount].ssid = ssid;
    wifiScanCache[wifiScanCacheCount].rssi = WiFi.RSSI(i);
    wifiScanCache[wifiScanCacheCount].secure = WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? 0 : 1;
    wifiScanCacheCount++;
  }
  WiFi.scanDelete();
  Serial.printf("[ble-wifi] cached networks: %d\n", wifiScanCacheCount);
}

void scanWifiForBle() {
  blePrint("SCAN_START");
  refreshWifiScanCache();
  for (int i = 0; i < wifiScanCacheCount; i++) {
    blePrint(
      "AP:" + wifiScanCache[i].ssid + "|" +
      String(wifiScanCache[i].rssi) + "|" +
      String(wifiScanCache[i].secure)
    );
    delay(25);
  }
  blePrint("SCAN_DONE:" + String(wifiScanCacheCount));
}

// ---------- MQTT publishers ----------
void publishManifest() {
  JsonDocument doc;
  doc["serialNumber"] = SERIAL_NO;
  doc["firmwareVersion"] = "2.0.0-esp";
  doc["skuHint"] = "KL-PRO";
  JsonObject c = doc["capabilities"].to<JsonObject>();
  c["vapor"] = true;
  JsonObject lg = c["lighting"].to<JsonObject>();
  JsonArray zones = lg["zones"].to<JsonArray>();
  zones.add("flame");
  lg["relays"] = 1;
  JsonObject cl = c["climate"].to<JsonObject>();
  cl["heater"] = true; cl["thermostat"] = true; cl["stages"] = 2;
  JsonObject au = c["audio"].to<JsonObject>();
  au["present"] = true; au["volumeSteps"] = 10; au["trackControl"] = true;
  JsonObject fan = c["exhaustFan"].to<JsonObject>();
  fan["present"] = true;
  JsonArray sp = fan["speeds"].to<JsonArray>();
  sp.add("off"); sp.add("low"); sp.add("medium"); sp.add("high");
  JsonObject rc = c["remoteControl"].to<JsonObject>();
  rc["present"] = true; rc["gpio"] = 6;
  c["hotelschaltung"] = true;
  JsonObject net = doc["network"].to<JsonObject>();
  net["mqttPort"] = 1883; net["wsPort"] = 9001;
  // Report how to reach this unit so the app never depends on hardcoded addresses.
  // mDNS survives DHCP changes; the raw IP is the fallback for networks (or Android
  // versions) where .local names do not resolve.
  net["mdnsHostname"] = MDNS_HOST;
  net["ip"] = WiFi.localIP().toString();
  String out; serializeJson(doc, out);
  mqtt.publish(T_MAN, out);
  Serial.println("[mqtt] manifest published");
}

void publishTelemetry() {
  JsonDocument doc;
  doc["ts"] = (uint32_t)(millis() / 1000);
  doc["online"] = true;
  doc["uptime"] = (uint32_t)((millis() - bootMs) / 1000);
  doc["firmwareVersion"] = "2.0.0-esp";
  doc["wifiRssi"] = (int)WiFi.RSSI();
  doc["power"] = power;
  doc["hotelschaltung"] = false;
  JsonObject v = doc["vapor"].to<JsonObject>();
  v["on"] = vaporOn; v["intensity"] = vaporIntensity; v["waterLevel"] = "medium";
  JsonObject lt = doc["lighting"].to<JsonObject>();
  JsonObject fl = lt["flame"].to<JsonObject>();
  fl["on"] = flameLightOn; fl["r"] = flameR; fl["g"] = flameG; fl["b"] = flameB; fl["brightness"] = flameBrightness;
  JsonObject timer = doc["timer"].to<JsonObject>();
  timer["sleepActive"] = sleepTimerActive;
  uint32_t remaining = 0;
  if (sleepTimerActive) {
    long delta = (long)(sleepTimerEndMs - millis());
    remaining = delta > 0 ? (uint32_t)(delta / 1000) : 0;
  }
  timer["sleepRemaining"] = remaining;
  timer["scheduleActive"] = false;
  timer["scheduleNext"] = nullptr;
  JsonObject clm = doc["climate"].to<JsonObject>();
  clm["heaterOn"] = false; clm["stage"] = 1; clm["targetTemp"] = 21;
  clm["currentTemp"] = 20.0; clm["humidity"] = 45.0;
  JsonObject au = doc["audio"].to<JsonObject>();
  au["on"] = audioOn;
  au["volume"] = audioVolume;
  au["trackIndex"] = audioTrackIndex;
  au["trackName"] = "Track " + String(audioTrackIndex + 1);
  String out; serializeJson(doc, out);
  mqtt.publish(T_TLM, out);
}

void turnOffForSleepTimer() {
  power = false;
  vaporOn = false;
  flameLightOn = false;
  audioOn = false;
  dfStop();
  digitalWrite(LED_PIN, LOW);
  setStrip(0, 0, 0);
  Serial.println("[timer] sleep timer expired - fireplace off");
}

void setSleepTimer(uint32_t seconds) {
  if (seconds == 0) {
    sleepTimerActive = false;
    sleepTimerDurationSec = 0;
    sleepTimerEndMs = 0;
    Serial.println("[timer] sleep timer cancelled");
    return;
  }
  sleepTimerActive = true;
  sleepTimerDurationSec = seconds;
  sleepTimerEndMs = millis() + (unsigned long)seconds * 1000UL;
  Serial.printf("[timer] sleep timer set: %lu seconds\n", (unsigned long)seconds);
}
void factoryReset() {
  clearSavedWifi();
  Serial.println("[reset] Wi-Fi wiped - rebooting into setup mode");
  restartPending = true;
  restartAtMs = millis() + 3000;
}

void publishAck(const char* msgId, bool ok = true) {
  if (!msgId || !strlen(msgId)) return;
  
  JsonDocument a;
  a["msgId"] = msgId;
  a["ok"] = ok;
  String out;
  serializeJson(a, out);
  mqtt.publish(T_ACK, out);
}

// ---------- MQTT command handler ----------
void onCommand(const char* topic, const char* payload) {
  Serial.printf("[cmd] %s\n", payload);
  JsonDocument doc;
  if (deserializeJson(doc, payload)) { Serial.println("[cmd] bad json"); return; }
  const char* module = doc["module"] | "";
  const char* action = doc["action"] | "";
  const char* msgId = doc["msgId"] | "";

  if (!strcmp(action, "request_manifest")) { publishManifest(); publishAck(msgId); return; }
  if (!strcmp(action, "factory_reset")) { publishAck(msgId); delay(150); factoryReset(); return; }
  if (!strcmp(module, "system") && !strcmp(action, "add_wifi")) {
    // Disabled for now: production setup uses one saved Wi-Fi network.
    // Keep this command as a no-op so older app builds do not change firmware state.
    Serial.println("[wifi] add_wifi ignored; single-network mode enabled");
    publishAck(msgId);
    return;
  }

  if (!strcmp(module, "system") && !strcmp(action, "power")) {
    power = doc["value"] | false;
    Serial.printf("[power] %s\n", power ? "ON" : "OFF");
  } else if (!strcmp(module, "lighting")) {
    if (!strcmp(action, "set_color")) {
      flameR = doc["value"]["r"] | flameR;
      flameG = doc["value"]["g"] | flameG;
      flameB = doc["value"]["b"] | flameB;
      flameLightOn = true;
      digitalWrite(LED_PIN, HIGH);
      setStrip(flameR, flameG, flameB);
    } else if (!strcmp(action, "set_brightness")) {
      flameBrightness = constrain((int)(doc["value"] | flameBrightness), 0, 100);
      setStrip(flameLightOn ? flameR : 0, flameLightOn ? flameG : 0, flameLightOn ? flameB : 0);
    } else if (!strcmp(action, "power")) {
      flameLightOn = doc["value"] | false;
      digitalWrite(LED_PIN, flameLightOn ? HIGH : LOW);
      setStrip(flameLightOn ? flameR : 0, flameLightOn ? flameG : 0, flameLightOn ? flameB : 0);
    }
  } else if (!strcmp(module, "vapor")) {
    if (!strcmp(action, "power")) vaporOn = doc["value"] | false;
    else if (!strcmp(action, "set_intensity")) vaporIntensity = doc["value"] | 0;
  } else if (!strcmp(module, "audio")) {
    // Track selection is driven by explicit "play track N" rather than the module's own
    // next/previous, so the index the app shows always matches what is actually playing.
    if (!strcmp(action, "power")) {
      audioOn = doc["value"] | false;
      if (audioOn) dfPlayTrack(audioTrackIndex);
      else dfStop();
      Serial.printf("[audio] %s\n", audioOn ? "ON" : "OFF");
    } else if (!strcmp(action, "set_volume")) {
      audioVolume = constrain((int)(doc["value"] | audioVolume), 0, AUDIO_VOLUME_STEPS);
      dfSetVolume(audioVolume);
      Serial.printf("[audio] volume %d/%d\n", audioVolume, AUDIO_VOLUME_STEPS);
    } else if (!strcmp(action, "track")) {
      const char* dir = doc["value"] | "";
      if (!strcmp(dir, "next")) audioTrackIndex = (audioTrackIndex + 1) % audioTrackCount;
      else if (!strcmp(dir, "prev")) audioTrackIndex = (audioTrackIndex + audioTrackCount - 1) % audioTrackCount;
      if (audioOn) dfPlayTrack(audioTrackIndex);
      Serial.printf("[audio] track %d/%d\n", audioTrackIndex + 1, audioTrackCount);
    }
  } else if (!strcmp(module, "timer")) {
    if (!strcmp(action, "set_sleep")) {
      int seconds = constrain((int)(doc["value"] | 0), 0, 28800);
      setSleepTimer((uint32_t)seconds);
    }
  }

  publishAck(msgId);
}

// ---------- Wi-Fi + MQTT ----------
bool connectWifi(const String& ssid, const String& pass, uint32_t timeoutMs = 20000) {
  WiFi.disconnect();
  delay(100);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  WiFi.begin(ssid.c_str(), pass.c_str());
  Serial.print("Connecting to " + ssid);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) { delay(400); Serial.print("."); }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}

void startMqtt() {
  String sn = SERIAL_NO;
  T_CMD = "kl/" + sn + "/cmd";  T_TLM = "kl/" + sn + "/telemetry";
  T_MAN = "kl/" + sn + "/manifest"; T_ACK = "kl/" + sn + "/ack";
  WiFi.setTxPower(WIFI_POWER_19_5dBm);
  WiFi.setSleep(false);
  Serial.print(">>> ESP32 IP ADDRESS: "); Serial.println(WiFi.localIP());
  if (MDNS.begin(MDNS_HOST)) Serial.printf(">>> mDNS name: %s.local\n", MDNS_HOST);
  mqtt.subscribe(T_CMD, onCommand);
  mqtt.begin();
  mqttStarted = true;
  Serial.println("MQTT/WS broker listening on :9001");
}

// ---------- BLE provisioning ----------
void handleProvisioning(String msg) {
  msg.trim();
  if (msg.equalsIgnoreCase("SCAN_WIFI")) {
    scanWifiForBle();
  } else if (msg.startsWith("WIFI:") || msg.startsWith("wifi:")) {
    String payload = msg.substring(5);
    int comma = payload.indexOf(',');
    if (comma < 0) { blePrint("ERR: send  WIFI:ssid,password"); return; }
    String ssid = payload.substring(0, comma); ssid.trim();
    String pass = payload.substring(comma + 1); pass.trim();
    // Save the credentials, then reboot from loop(). Do not connect to Wi-Fi while
    // BLE is active: on the ESP32 they share one radio, and association can fail
    // while the tablet is still connected over Bluetooth.
    saveWifiSlot(0, ssid, pass);
    blePrint("SAVED: " + ssid + " - restarting to connect");
    Serial.println("[prov] saved, restarting");
    restartPending = true;
    restartAtMs = millis() + 3000;
  } else if (msg.equalsIgnoreCase("RESET")) {
    factoryReset();
  } else {
    blePrint("Send:  WIFI:yourSSID,yourPassword");
  }
}

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    String v = c->getValue().c_str();
    Serial.println("BLE RX: " + v);
    handleProvisioning(v);
  } 
};

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { bleClientConnected = true; Serial.println("BLE client connected"); }
  void onDisconnect(BLEServer*) override {
    bleClientConnected = false;
    if (bleActive) BLEDevice::startAdvertising();
  }
};

void startBleProvisioning() {
  refreshWifiScanCache();
  WiFi.disconnect(false);
  delay(100);

  BLEDevice::init(BLE_DEVICE_NAME);
  BLEServer* srv = BLEDevice::createServer();
  srv->setCallbacks(new ServerCallbacks());
  BLEService* svc = srv->createService(UART_SERVICE_UUID);
  BLECharacteristic* rx = svc->createCharacteristic(
    UART_RX_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new RxCallbacks());
  txCharacteristic = svc->createCharacteristic(
    UART_TX_UUID, BLECharacteristic::PROPERTY_NOTIFY | BLECharacteristic::PROPERTY_READ);
  txCharacteristic->addDescriptor(new BLE2902());
  svc->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(UART_SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  bleActive = true;
  Serial.println("=== SETUP MODE ===");
  String lastFail = consumeLastWifiFailure();
  if (lastFail.length() > 0) Serial.println("SETUP_REASON:" + lastFail);
  Serial.println("BLE device: " + String(BLE_DEVICE_NAME));
  Serial.println("Send over BLE:  WIFI:yourSSID,yourPassword");
}

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("[boot] Glow Fire firmware starting");
  pinMode(LED_PIN, OUTPUT); digitalWrite(LED_PIN, LOW);
  strip.begin(); strip.setBrightness(brightnessToNeoPixel(flameBrightness)); strip.clear(); strip.show();
  audioBegin();
  bootMs = millis();

  // Load saved Wi-Fi credentials from flash
  migrateLegacyWifiIfNeeded();
  WifiCred selected;

  if (hasSavedWifi() && chooseBestSavedWifi(selected)) {
    Serial.println("Saved Wi-Fi found (" + selected.ssid + ") - connecting...");
    if (connectWifi(selected.ssid, selected.pass, 15000)) {
      startMqtt();                 // normal use
    } else {
      Serial.println("Saved Wi-Fi failed - clearing credentials and entering setup mode.");
      clearSavedWifi();
      setLastWifiFailure("wifi_connect_failed");
      startBleProvisioning();
    }
  } else {
    Serial.println("No saved Wi-Fi reachable - entering setup mode.");
    startBleProvisioning();        // first-time setup or recovery
  }
}

void loop() {
  if (restartPending && (long)(millis() - restartAtMs) >= 0) {
    restartPending = false;
    if (bleActive) {
      BLEDevice::deinit(true);
      bleActive = false;
    }
    delay(100);
    ESP.restart();
  }

  if (sleepTimerActive && (long)(millis() - sleepTimerEndMs) >= 0) {
    sleepTimerActive = false;
    sleepTimerDurationSec = 0;
    sleepTimerEndMs = 0;
    turnOffForSleepTimer();
  }

  if (mqttStarted) {
    mqtt.loop();
    if (millis() - lastTlm >= 2000) {
      lastTlm = millis();
      if (WiFi.status() == WL_CONNECTED) publishTelemetry();
    }
  }
}
 





  







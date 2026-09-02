/*
 * Glow Fire — PRODUCTION firmware (ESP32-S3).
 *
 * This is the DEV firmware's approach (BLE Wi-Fi provisioning + MQTT + DHCP + mDNS)
 * given the PRODUCTION board's pins and hardware. There is NO static IP, NO web page,
 * NO web login, and NO hardcoded Wi-Fi — setup is done from the app over Bluetooth,
 * exactly like the dev board.
 *
 * FLOW (same as dev):
 *   Boot -> load saved Wi-Fi from flash.
 *     found -> connect (DHCP) -> start MQTT broker (BLE off)
 *     none  -> start BLE setup -> receive "WIFI:ssid,password" -> save -> reboot -> connect
 *   Factory reset (app: system/factory_reset, or BLE "RESET") -> wipe Wi-Fi -> reboot to setup.
 *
 * HARDWARE (production PCB): 3x WS2805 LED strips, mist maker, 2 blowers, small heater,
 * two 1000W heaters + fan, DFPlayer audio, DHT11 temp/humidity. The WS2805 RMT driver and
 * the output drivers are kept from the tested production code because the LED chip (WS2805)
 * differs from the dev board's WS2812 — that is a hardware driver, not app logic.
 *
 * Board: ESP32S3 Dev Module. Partition: Huge APP (3MB No OTA). Serial: 115200.
 * Libraries: PicoMQTT, ArduinoJson (v7), DFRobotDFPlayerMini, DHT sensor library,
 *            ESP32 BLE (built in).
 *
 * ===== PIN MAP — match by the "IOxx" GPIO number, NOT the physical pin number =====
 *   Schematic net  GPIO  Function
 *   DebugLED       IO2   status LED
 *   DHTD           IO4   DHT11 sensor
 *   LED1           IO9   WS2805 strip 1
 *   LED2           IO10  WS2805 strip 2
 *   LED3           IO11  WS2805 strip 3
 *   MYST           IO12  mist maker
 *   HEAT           IO13  small heater
 *   B1             IO14  blower 1
 *   B2             IO15  blower 2
 *   TX_ESP         IO17  DFPlayer (ESP TX -> module RX)
 *   RX_ESP         IO18  DFPlayer (ESP RX <- module TX)
 *   R1             IO40  relay: heater fan
 *   R2             IO41  SSR: 1000W heater 1
 *   R3             IO42  SSR: 1000W heater 2
 * ================================================================================
 */
#include <WiFi.h>
#include <Preferences.h>
#include <ESPmDNS.h>
#include <Arduino.h>
#include <PicoMQTT.h>
#include <PicoWebsocket.h>
#include <ArduinoJson.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <DFRobotDFPlayerMini.h>
#include <DHT.h>
#include <esp32-hal-rmt.h>
#include <IRremote.hpp>

// ---------- CONFIG ----------
const char* SERIAL_NO       = "KL-2026-A3F92C";    // MUST match the app's serialNumber
const char* MDNS_HOST       = "kl-glowfire";       // device reachable at kl-glowfire.local
const char* BLE_DEVICE_NAME = "KL-GlowFire-Setup";  // shown when scanning over Bluetooth

// Nordic UART Service UUIDs (the app writes credentials to RX, reads replies on TX)
#define UART_SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define UART_RX_UUID      "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  // phone -> ESP32
#define UART_TX_UUID      "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  // ESP32 -> phone

// ---------- Pins (production PCB — see PIN MAP above; match by IOxx) ----------
#define DEBUG_LED_PIN    2    // DebugLED  IO2
#define DHT_PIN          4    // DHTD      IO4
#define LED1_PIN         9    // LED1      IO9
#define LED2_PIN         10   // LED2      IO10
#define LED3_PIN         11   // LED3      IO11
#define MIST_PIN         12   // MYST      IO12
#define SMALL_HEATER_PIN 13   // HEAT      IO13
#define BLOWER1_PIN      14   // B1        IO14
#define BLOWER2_PIN      15   // B2        IO15
#define DFPLAYER_TX      17   // TX_ESP    IO17 (ESP TX -> module RX)
#define DFPLAYER_RX      18   // RX_ESP    IO18 (ESP RX <- module TX)
#define HEATER_FAN_PIN   40   // R1        IO40
#define HEATER1_SSR_PIN  41   // R2        IO41
#define HEATER2_SSR_PIN  42   // R3        IO42
#define DHT_TYPE         DHT11

// Relay / SSR polarity — flip to LOW if your board is active-LOW.
const uint8_t HEAT_ON = HIGH, HEAT_OFF = LOW;

// ---------- Broker over WebSocket on 9001 (same as dev / the app) ----------
WiFiServer tcpServer(9001);
PicoWebsocket::Server<::WiFiServer> wsServer(tcpServer);
PicoMQTT::Server mqtt(wsServer);
Preferences prefs;  // flash storage for Wi-Fi credentials

// ---------- Topics & connectivity state ----------
String T_CMD, T_TLM, T_MAN, T_ACK;
unsigned long bootMs = 0, lastTlm = 0;
bool mqttStarted = false, bleActive = false, restartPending = false;
unsigned long restartAtMs = 0;
BLECharacteristic* txCharacteristic = nullptr;
bool bleClientConnected = false;

// ---------- Master power + sleep timer ----------
bool systemOn = false;
bool sleepTimerActive = false;
unsigned long sleepTimerEndMs = 0;

// ---------- WS2805 LED strips (3) ----------
const uint16_t LED_COUNT = 23;                 // LEDs per strip
const uint32_t WS2805_RMT_FREQUENCY_HZ = 10000000UL;
const uint16_t WS2805_T0H_TICKS = 3, WS2805_T0L_TICKS = 10;
const uint16_t WS2805_T1H_TICKS = 7, WS2805_T1L_TICKS = 6;
const uint16_t WS2805_RESET_US = 300;
const size_t WS2805_BITS_PER_PIXEL = 40;
const size_t WS2805_SYMBOL_COUNT = (size_t)LED_COUNT * WS2805_BITS_PER_PIXEL;
rmt_data_t ws2805Symbols[WS2805_SYMBOL_COUNT];
bool ws2805Ready[3] = {false, false, false};

struct LedStripState { bool on; uint8_t red, green, blue, warmWhite, coolWhite, brightnessPercent; };
// Default warm orange. NOTE: this strip has R/G physically swapped, so requested-red is
// stored in .green and requested-green in .red (matches the tested production driver).
LedStripState ledStates[3] = {
  {false, 80, 255, 0, 0, 0, 40},
  {false, 80, 255, 0, 0, 0, 40},
  {false, 80, 255, 0, 0, 0, 40},
};

// ---------- Mist / blowers / heaters ----------
bool mistOn = false;
int  mistLevel = 0;                              // 0..5
const int mistPwm[6] = {0, 120, 150, 180, 220, 255};
int  blower1Speed = 150, blower2Speed = 150;     // 0..255
bool blower1On = false, blower2On = false;
bool smallHeaterOn = false, heaterFanOn = false, heater1On = false, heater2On = false;

// ---------- DFPlayer audio ----------
HardwareSerial dfSerial(2);
DFRobotDFPlayerMini dfPlayer;
const int AUDIO_VOLUME_STEPS = 10;               // app-facing steps
const int DF_MAX_VOLUME = 30;                    // DFPlayer hardware range
int  volumeLevel = 15;                           // 0..30
bool isPlaying = false;
int  audioTrackIndex = 0;

// ---------- DHT ----------
DHT dht(DHT_PIN, DHT_TYPE);
float temperatureC = NAN, humidityPercent = NAN;
unsigned long lastDhtRead = 0;

// ---------- IR remote (net RECEIVERD -> IO6). Codes confirmed on the real remote. ----------
#define IR_RECEIVE_PIN     6
#define IR_POWER_CODE      0xFB047F80UL   // On/Off
#define IR_FIRE_UP_CODE    0xE51A7F80UL   // Flame up
#define IR_FIRE_DOWN_CODE  0xFA057F80UL   // Flame down
#define IR_VOLUME_CODE     0xE6197F80UL   // Volume (cycles 10 -> 20 -> 30)
int fireLevel = 0;                        // 0 = off, 1..3 scene levels
int volumePreset = 0;                     // 0 = none, 1/2/3 = vol 10/20/30

// ---------- Wi-Fi provisioning (same as dev firmware) ----------
struct CachedWifiNetwork { String ssid; int rssi; int secure; };
const int WIFI_SCAN_CACHE_MAX = 16;
CachedWifiNetwork wifiScanCache[WIFI_SCAN_CACHE_MAX];
int wifiScanCacheCount = 0;
struct WifiCred { String ssid; String pass; };
const int WIFI_SLOT_COUNT = 1;

String wifiKey(const char* prefix, int slot) { return String(prefix) + String(slot); }

void saveWifiSlot(int slot, const String& ssid, const String& pass) {
  prefs.begin("wifi", false);
  prefs.putString(wifiKey("ssid", slot).c_str(), ssid);
  prefs.putString(wifiKey("pass", slot).c_str(), pass);
  prefs.end();
  Serial.printf("[wifi] saved slot %d: %s\n", slot, ssid.c_str());
}
void clearSavedWifi() {
  prefs.begin("wifi", false); prefs.clear(); prefs.end();
  Serial.println("[wifi] saved credentials cleared");
}
void setLastWifiFailure(const String& reason) {
  prefs.begin("setup", false); prefs.putString("lastFail", reason); prefs.end();
}
String consumeLastWifiFailure() {
  prefs.begin("setup", false);
  String reason = prefs.getString("lastFail", "");
  if (reason.length() > 0) prefs.remove("lastFail");
  prefs.end();
  return reason;
}
WifiCred loadWifiSlot(int slot) {
  WifiCred c;
  prefs.begin("wifi", true);
  c.ssid = prefs.getString(wifiKey("ssid", slot).c_str(), "");
  c.pass = prefs.getString(wifiKey("pass", slot).c_str(), "");
  prefs.end();
  return c;
}
bool hasSavedWifi() {
  for (int i = 0; i < WIFI_SLOT_COUNT; i++) if (loadWifiSlot(i).ssid.length() > 0) return true;
  return false;
}
bool chooseBestSavedWifi(WifiCred& best) {
  WifiCred saved[WIFI_SLOT_COUNT];
  for (int i = 0; i < WIFI_SLOT_COUNT; i++) saved[i] = loadWifiSlot(i);
  WiFi.mode(WIFI_STA); WiFi.disconnect(); delay(100);
  int found = WiFi.scanNetworks();
  int bestRssi = -1000, bestSlot = -1;
  for (int n = 0; n < found; n++) {
    String seen = WiFi.SSID(n); int rssi = WiFi.RSSI(n);
    for (int s = 0; s < WIFI_SLOT_COUNT; s++)
      if (saved[s].ssid.length() > 0 && seen == saved[s].ssid && rssi > bestRssi) { bestRssi = rssi; bestSlot = s; }
  }
  WiFi.scanDelete();
  if (bestSlot >= 0) { best = saved[bestSlot]; return true; }
  return false;
}

String sanitizeBleField(String v) { v.replace("|", " "); v.replace("\n", " "); v.replace("\r", " "); return v; }
void refreshWifiScanCache() {
  wifiScanCacheCount = 0;
  WiFi.mode(WIFI_STA); WiFi.setSleep(false); WiFi.disconnect(false); delay(120);
  int found = WiFi.scanNetworks(false, true, false, 180, 0);
  if (found < 0) { WiFi.scanDelete(); return; }
  for (int i = 0; i < found && wifiScanCacheCount < WIFI_SCAN_CACHE_MAX; i++) {
    String ssid = sanitizeBleField(WiFi.SSID(i));
    if (ssid.length() == 0) continue;
    bool dup = false;
    for (int j = 0; j < wifiScanCacheCount; j++) if (wifiScanCache[j].ssid == ssid) { dup = true; break; }
    if (dup) continue;
    wifiScanCache[wifiScanCacheCount].ssid = ssid;
    wifiScanCache[wifiScanCacheCount].rssi = WiFi.RSSI(i);
    wifiScanCache[wifiScanCacheCount].secure = WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? 0 : 1;
    wifiScanCacheCount++;
  }
  WiFi.scanDelete();
}

void blePrint(const String& msg) {
  Serial.println(msg);
  if (txCharacteristic && bleClientConnected) {
    txCharacteristic->setValue((msg + "\n").c_str());
    txCharacteristic->notify();
  }
}
void scanWifiForBle() {
  blePrint("SCAN_START");
  refreshWifiScanCache();
  for (int i = 0; i < wifiScanCacheCount; i++) {
    blePrint("AP:" + wifiScanCache[i].ssid + "|" + String(wifiScanCache[i].rssi) + "|" + String(wifiScanCache[i].secure));
    delay(25);
  }
  blePrint("SCAN_DONE:" + String(wifiScanCacheCount));
}

// ---------- WS2805 driver (kept from tested production code) ----------
uint8_t scaleLed(uint8_t v, uint8_t pct) { return (uint8_t)(((uint16_t)v * pct) / 100U); }
int ledPinFor(int idx) { return idx == 0 ? LED1_PIN : idx == 1 ? LED2_PIN : LED3_PIN; }

void ws2805EncodeBit(bool b, size_t& i) {
  if (i >= WS2805_SYMBOL_COUNT) return;
  rmt_data_t& s = ws2805Symbols[i++];
  s.level0 = 1; s.level1 = 0;
  if (b) { s.duration0 = WS2805_T1H_TICKS; s.duration1 = WS2805_T1L_TICKS; }
  else   { s.duration0 = WS2805_T0H_TICKS; s.duration1 = WS2805_T0L_TICKS; }
}
void ws2805EncodeByte(uint8_t v, size_t& i) { for (int b = 7; b >= 0; b--) ws2805EncodeBit((v >> b) & 1, i); }

void ws2805Show(int idx) {
  if (!ws2805Ready[idx]) return;
  const LedStripState& st = ledStates[idx];
  uint8_t r = 0, g = 0, b = 0, w1 = 0, w2 = 0;
  if (systemOn && st.on && st.brightnessPercent > 0) {
    r = scaleLed(st.red, st.brightnessPercent);
    g = scaleLed(st.green, st.brightnessPercent);
    b = scaleLed(st.blue, st.brightnessPercent);
    w1 = scaleLed(st.warmWhite, st.brightnessPercent);
    w2 = scaleLed(st.coolWhite, st.brightnessPercent);
  }
  size_t i = 0;
  for (uint16_t px = 0; px < LED_COUNT; px++) {
    ws2805EncodeByte(r, i); ws2805EncodeByte(g, i); ws2805EncodeByte(b, i);
    ws2805EncodeByte(w1, i); ws2805EncodeByte(w2, i);
  }
  rmtWrite(ledPinFor(idx), ws2805Symbols, i, RMT_WAIT_FOR_EVER);
  delayMicroseconds(WS2805_RESET_US);   // latch
}
void applyLedStrips() { for (int i = 0; i < 3; i++) ws2805Show(i); }
void initWs2805() {
  for (int i = 0; i < 3; i++) {
    int pin = ledPinFor(i);
    ws2805Ready[i] = rmtInit(pin, RMT_TX_MODE, RMT_MEM_NUM_BLOCKS_1, WS2805_RMT_FREQUENCY_HZ);
    if (ws2805Ready[i]) rmtSetEOT(pin, 0);
    Serial.printf("[led] strip %d on GPIO %d: %s\n", i + 1, pin, ws2805Ready[i] ? "ready" : "FAILED");
  }
}

// ---------- Output drivers (kept from tested production code) ----------
void applyMist() {
  analogWrite(MIST_PIN, (systemOn && mistOn && mistLevel > 0) ? mistPwm[mistLevel] : 0);
}
void applyBlowers() {
  analogWrite(BLOWER1_PIN, (systemOn && blower1On) ? blower1Speed : 0);
  analogWrite(BLOWER2_PIN, (systemOn && blower2On) ? blower2Speed : 0);
}
void applyHeating() {
  digitalWrite(SMALL_HEATER_PIN, (systemOn && smallHeaterOn) ? HEAT_ON : HEAT_OFF);
  if (systemOn && (heater1On || heater2On)) heaterFanOn = true;   // safety interlock
  bool fan = systemOn && heaterFanOn;
  digitalWrite(HEATER_FAN_PIN, fan ? HEAT_ON : HEAT_OFF);
  digitalWrite(HEATER1_SSR_PIN, (fan && heater1On) ? HEAT_ON : HEAT_OFF);
  digitalWrite(HEATER2_SSR_PIN, (fan && heater2On) ? HEAT_ON : HEAT_OFF);
}
void applyAllOutputs() { applyLedStrips(); applyMist(); applyBlowers(); applyHeating(); }

// ---------- Audio ----------
void dfSetVolume(int appStep) {
  volumeLevel = map(constrain(appStep, 0, AUDIO_VOLUME_STEPS), 0, AUDIO_VOLUME_STEPS, 0, DF_MAX_VOLUME);
  dfPlayer.volume(volumeLevel);
}
void audioBegin() {
  dfSerial.begin(9600, SERIAL_8N1, DFPLAYER_RX, DFPLAYER_TX);
  if (!dfPlayer.begin(dfSerial, false, true)) Serial.println("[audio] DFPlayer no reply (continuing)");
  else Serial.println("[audio] DFPlayer ready");
  delay(300);
  dfPlayer.outputDevice(DFPLAYER_DEVICE_SD);
  delay(200);
  dfPlayer.volume(volumeLevel);
}

// ---------- DHT ----------
void readDHT() {
  if (millis() - lastDhtRead < 2000) return;
  lastDhtRead = millis();
  float h = dht.readHumidity(), t = dht.readTemperature();
  if (!isnan(h) && !isnan(t)) { temperatureC = t; humidityPercent = h; }
}

// ---------- Master power / timer ----------
void systemPowerOff() {
  systemOn = false;
  mistOn = false; mistLevel = 0;
  blower1On = false; blower2On = false;
  for (int i = 0; i < 3; i++) ledStates[i].on = false;
  smallHeaterOn = heater1On = heater2On = heaterFanOn = false;
  applyAllOutputs();
  if (isPlaying) { dfPlayer.pause(); isPlaying = false; }
  Serial.println("[system] OFF");
}
void systemPowerOn() { systemOn = true; applyAllOutputs(); Serial.println("[system] ON"); }
void setSleepTimer(uint32_t seconds) {
  if (seconds == 0) { sleepTimerActive = false; sleepTimerEndMs = 0; return; }
  sleepTimerActive = true; sleepTimerEndMs = millis() + (unsigned long)seconds * 1000UL;
}
void factoryReset() { clearSavedWifi(); restartPending = true; restartAtMs = millis() + 2500; }

// ---------- IR remote handling ----------
// A "fire level" scene: one press sets flame colour, brightness, mist and blowers together.
void applyFireLevel(int level) {
  fireLevel = constrain(level, 1, 3);
  systemOn = true;
  // Keep whatever colour the app/presets already set — the remote's flame up/down
  // changes only the fire INTENSITY (brightness + mist + blowers), never the colour.
  // (The default orange applies only if no colour was ever chosen.)
  for (int i = 0; i < 3; i++) ledStates[i].on = true;
  blower1On = true; blower2On = true; mistOn = true;
  int bright = fireLevel == 1 ? 25 : fireLevel == 2 ? 60 : 100;
  int bspeed = fireLevel == 1 ? 90 : fireLevel == 2 ? 170 : 255;
  mistLevel     = fireLevel == 1 ? 2  : fireLevel == 2 ? 4   : 5;
  for (int i = 0; i < 3; i++) ledStates[i].brightnessPercent = bright;
  blower1Speed = bspeed; blower2Speed = bspeed;
  applyAllOutputs();
  if (!isPlaying) { dfPlayer.start(); isPlaying = true; }
  Serial.printf("[ir] fire level %d\n", fireLevel);
}
void remoteFireUp()   { applyFireLevel((!systemOn || fireLevel < 1) ? 1 : (fireLevel < 3 ? fireLevel + 1 : 3)); }
void remoteFireDown() { applyFireLevel((!systemOn || fireLevel < 1) ? 1 : (fireLevel > 1 ? fireLevel - 1 : 1)); }
void cycleVolume() {
  volumePreset = (volumePreset >= 3) ? 1 : volumePreset + 1;
  volumeLevel = volumePreset == 1 ? 10 : volumePreset == 2 ? 20 : 30;
  dfPlayer.volume(volumeLevel);
  Serial.printf("[ir] volume %d\n", volumeLevel);
}
void checkIRRemote() {
  if (!IrReceiver.decode()) return;
  if (!(IrReceiver.decodedIRData.flags & IRDATA_FLAGS_IS_REPEAT)) {   // ignore held-button repeats
    uint32_t code = (uint32_t)IrReceiver.decodedIRData.decodedRawData;
    switch (code) {
      case IR_POWER_CODE:     if (systemOn) systemPowerOff(); else applyFireLevel(1); break;
      case IR_FIRE_UP_CODE:   remoteFireUp();   break;
      case IR_FIRE_DOWN_CODE: remoteFireDown(); break;
      case IR_VOLUME_CODE:    cycleVolume();    break;
      default: Serial.printf("[ir] unknown 0x%08X\n", code); break;
    }
  }
  IrReceiver.resume();
}

// ---------- MQTT publishers ----------
void publishAck(const char* msgId, bool ok = true) {
  if (!msgId || !strlen(msgId)) return;
  JsonDocument a; a["msgId"] = msgId; a["ok"] = ok;
  String out; serializeJson(a, out); mqtt.publish(T_ACK, out);
}
void publishManifest() {
  JsonDocument doc;
  doc["serialNumber"] = SERIAL_NO;
  doc["firmwareVersion"] = "prod-s3-1.0";
  doc["skuHint"] = "KL-PRO";
  JsonObject c = doc["capabilities"].to<JsonObject>();
  c["vapor"] = true;
  JsonObject lg = c["lighting"].to<JsonObject>();
  lg["zones"].to<JsonArray>().add("flame"); lg["relays"] = 0;
  JsonObject cl = c["climate"].to<JsonObject>();
  cl["heater"] = true; cl["thermostat"] = false; cl["stages"] = 2;
  JsonObject au = c["audio"].to<JsonObject>();
  au["present"] = true; au["volumeSteps"] = AUDIO_VOLUME_STEPS; au["trackControl"] = true;
  JsonObject fan = c["exhaustFan"].to<JsonObject>();
  fan["present"] = false; fan["speeds"].to<JsonArray>();
  JsonObject rc = c["remoteControl"].to<JsonObject>(); rc["present"] = false;
  c["hotelschaltung"] = false;
  JsonObject net = doc["network"].to<JsonObject>();
  net["mqttPort"] = 1883; net["wsPort"] = 9001;
  net["mdnsHostname"] = MDNS_HOST; net["ip"] = WiFi.localIP().toString();
  String out; serializeJson(doc, out); mqtt.publish(T_MAN, out);
  Serial.println("[mqtt] manifest published");
}
void publishTelemetry() {
  readDHT();
  JsonDocument doc;
  doc["ts"] = (uint32_t)(millis() / 1000);
  doc["online"] = true;
  doc["uptime"] = (uint32_t)((millis() - bootMs) / 1000);
  doc["firmwareVersion"] = "prod-s3-1.0";
  doc["wifiRssi"] = (int)WiFi.RSSI();
  doc["power"] = systemOn;

  JsonObject v = doc["vapor"].to<JsonObject>();
  v["on"] = mistOn; v["intensity"] = mistLevel;
  // waterLevel is NOT sent: this board has no water-level sensor. The app shows "—".

  JsonObject lt = doc["lighting"].to<JsonObject>();
  JsonObject fl = lt["flame"].to<JsonObject>();
  fl["on"] = ledStates[0].on;
  fl["r"] = ledStates[0].green;   // swap back (strip stores red in green slot)
  fl["g"] = ledStates[0].red;
  fl["b"] = ledStates[0].blue;
  fl["brightness"] = ledStates[0].brightnessPercent;

  JsonObject clm = doc["climate"].to<JsonObject>();
  clm["heaterOn"] = (heater1On || heater2On || smallHeaterOn);
  clm["stage"] = heater2On ? 2 : 1;
  // targetTemp is NOT sent: these heaters are on/off + stage, no thermostat.
  // currentTemp/humidity are sent ONLY if a real DHT sensor responds — never placeholders.
  if (!isnan(temperatureC)) clm["currentTemp"] = temperatureC;
  if (!isnan(humidityPercent)) clm["humidity"] = humidityPercent;

  JsonObject au = doc["audio"].to<JsonObject>();
  au["on"] = isPlaying;
  au["volume"] = map(constrain(volumeLevel, 0, DF_MAX_VOLUME), 0, DF_MAX_VOLUME, 0, AUDIO_VOLUME_STEPS);
  au["trackIndex"] = audioTrackIndex;
  au["trackName"] = "Track " + String(audioTrackIndex + 1);

  JsonObject timer = doc["timer"].to<JsonObject>();
  timer["sleepActive"] = sleepTimerActive;
  uint32_t remaining = 0;
  if (sleepTimerActive) { long d = (long)(sleepTimerEndMs - millis()); remaining = d > 0 ? (uint32_t)(d / 1000) : 0; }
  timer["sleepRemaining"] = remaining;
  timer["scheduleActive"] = false; timer["scheduleNext"] = nullptr;

  String out; serializeJson(doc, out); mqtt.publish(T_TLM, out);
}

// ---------- MQTT command handler (app -> production hardware) ----------
void onCommand(const char* topic, const char* payload) {
  JsonDocument doc;
  if (deserializeJson(doc, payload)) { Serial.println("[cmd] bad json"); return; }
  const char* module = doc["module"] | "";
  const char* action = doc["action"] | "";
  const char* msgId  = doc["msgId"]  | "";

  if (!strcmp(action, "request_manifest")) { publishManifest(); publishAck(msgId); return; }
  if (!strcmp(action, "factory_reset")) { publishAck(msgId); delay(120); factoryReset(); return; }

  if (!strcmp(module, "system") && !strcmp(action, "power")) {
    if (doc["value"] | false) systemPowerOn(); else systemPowerOff();

  } else if (!strcmp(module, "vapor")) {                       // mist maker
    if (!strcmp(action, "power")) {
      mistOn = doc["value"] | false;
      if (mistOn && mistLevel == 0) mistLevel = 5;
      if (!mistOn) mistLevel = 0;
      systemOn = true; applyMist();
    } else if (!strcmp(action, "set_intensity")) {
      mistLevel = constrain((int)(doc["value"] | 0), 0, 5);
      mistOn = mistLevel > 0; systemOn = true; applyMist();
    }

  } else if (!strcmp(module, "lighting")) {                    // all 3 WS2805 strips
    if (!strcmp(action, "set_color")) {
      uint8_t r = doc["value"]["r"] | 0, g = doc["value"]["g"] | 0, b = doc["value"]["b"] | 0;
      for (int i = 0; i < 3; i++) { ledStates[i].on = true; ledStates[i].red = g; ledStates[i].green = r; ledStates[i].blue = b; }
      systemOn = true; applyLedStrips();
    } else if (!strcmp(action, "set_brightness")) {
      int br = constrain((int)(doc["value"] | 0), 0, 100);
      for (int i = 0; i < 3; i++) ledStates[i].brightnessPercent = br;
      applyLedStrips();
    } else if (!strcmp(action, "power")) {
      bool on = doc["value"] | false;
      for (int i = 0; i < 3; i++) ledStates[i].on = on;
      if (on) systemOn = true; applyLedStrips();
    }

  } else if (!strcmp(module, "audio")) {
    if (!strcmp(action, "power")) {
      bool on = doc["value"] | false;
      if (on) { dfPlayer.start(); isPlaying = true; } else { dfPlayer.pause(); isPlaying = false; }
    } else if (!strcmp(action, "set_volume")) {
      dfSetVolume(doc["value"] | 0);
    } else if (!strcmp(action, "track")) {
      const char* dir = doc["value"] | "";
      if (!strcmp(dir, "next")) { dfPlayer.next(); audioTrackIndex++; }
      else if (!strcmp(dir, "prev")) { dfPlayer.previous(); if (audioTrackIndex > 0) audioTrackIndex--; }
      isPlaying = true;
    }

  } else if (!strcmp(module, "climate")) {                     // two 1000W heaters (+ safety fan)
    if (!strcmp(action, "power")) {
      bool on = doc["value"] | false;
      systemOn = true;
      if (on) { heater1On = true; heaterFanOn = true; } else { heater1On = false; heater2On = false; }
      applyHeating();
    } else if (!strcmp(action, "set_stage")) {
      int stage = doc["value"] | 1;
      systemOn = true; heater1On = true; heater2On = (stage >= 2); heaterFanOn = true;
      applyHeating();
    }

  } else if (!strcmp(module, "timer") && !strcmp(action, "set_sleep")) {
    setSleepTimer((uint32_t)constrain((int)(doc["value"] | 0), 0, 28800));
  }

  publishAck(msgId);
}

// ---------- Wi-Fi connect (DHCP — no static IP) + MQTT start ----------
bool connectWifi(const String& ssid, const String& pass, uint32_t timeoutMs = 15000) {
  WiFi.disconnect(); delay(100);
  WiFi.mode(WIFI_STA); WiFi.setSleep(false);
  WiFi.begin(ssid.c_str(), pass.c_str());   // DHCP: router assigns the IP
  Serial.print("Connecting to " + ssid);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) { delay(400); Serial.print("."); }
  Serial.println();
  return WiFi.status() == WL_CONNECTED;
}
void startMqtt() {
  String sn = SERIAL_NO;
  T_CMD = "kl/" + sn + "/cmd"; T_TLM = "kl/" + sn + "/telemetry";
  T_MAN = "kl/" + sn + "/manifest"; T_ACK = "kl/" + sn + "/ack";
  WiFi.setSleep(false);
  Serial.print(">>> ESP32 IP: "); Serial.println(WiFi.localIP());
  if (MDNS.begin(MDNS_HOST)) Serial.printf(">>> mDNS: %s.local\n", MDNS_HOST);
  mqtt.subscribe(T_CMD, onCommand);
  mqtt.begin();
  mqttStarted = true;
  Serial.println("MQTT/WS broker on :9001");
}

// ---------- BLE provisioning (same as dev firmware) ----------
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
    saveWifiSlot(0, ssid, pass);
    blePrint("SAVED: " + ssid + " - restarting to connect");
    restartPending = true; restartAtMs = millis() + 3000;   // reboot with BLE off, then connect
  } else if (msg.equalsIgnoreCase("RESET")) {
    factoryReset();
  } else {
    blePrint("Send:  WIFI:yourSSID,yourPassword");
  }
}
class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override { handleProvisioning(String(c->getValue().c_str())); }
};
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { bleClientConnected = true; }
  void onDisconnect(BLEServer*) override { bleClientConnected = false; if (bleActive) BLEDevice::startAdvertising(); }
};
void startBleProvisioning() {
  refreshWifiScanCache();
  WiFi.disconnect(false); delay(100);
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
  adv->addServiceUUID(UART_SERVICE_UUID); adv->setScanResponse(true);
  BLEDevice::startAdvertising();
  bleActive = true;
  Serial.println("=== SETUP MODE ===");
  String lastFail = consumeLastWifiFailure();
  if (lastFail.length() > 0) Serial.println("SETUP_REASON:" + lastFail);
  Serial.println("BLE device: " + String(BLE_DEVICE_NAME));
}

// ---------- Setup / Loop ----------
void setup() {
  Serial.begin(115200);
  delay(800);
  Serial.println("[boot] Glow Fire PRODUCTION (S3) starting");

  pinMode(DEBUG_LED_PIN, OUTPUT); digitalWrite(DEBUG_LED_PIN, LOW);
  pinMode(BLOWER1_PIN, OUTPUT); pinMode(BLOWER2_PIN, OUTPUT); pinMode(MIST_PIN, OUTPUT);
  pinMode(SMALL_HEATER_PIN, OUTPUT); pinMode(HEATER_FAN_PIN, OUTPUT);
  pinMode(HEATER1_SSR_PIN, OUTPUT); pinMode(HEATER2_SSR_PIN, OUTPUT);
  // Safe boot: all heaters OFF.
  digitalWrite(SMALL_HEATER_PIN, HEAT_OFF); digitalWrite(HEATER_FAN_PIN, HEAT_OFF);
  digitalWrite(HEATER1_SSR_PIN, HEAT_OFF); digitalWrite(HEATER2_SSR_PIN, HEAT_OFF);
  analogWrite(BLOWER1_PIN, 0); analogWrite(BLOWER2_PIN, 0); analogWrite(MIST_PIN, 0);

  initWs2805(); applyLedStrips();
  dht.begin();
  audioBegin();
  IrReceiver.begin(IR_RECEIVE_PIN, DISABLE_LED_FEEDBACK);   // physical remote
  bootMs = millis();

  WifiCred selected;
  if (hasSavedWifi() && chooseBestSavedWifi(selected)) {
    Serial.println("Saved Wi-Fi found (" + selected.ssid + ") - connecting...");
    if (connectWifi(selected.ssid, selected.pass, 15000)) startMqtt();
    else { clearSavedWifi(); setLastWifiFailure("wifi_connect_failed"); startBleProvisioning(); }
  } else {
    Serial.println("No saved Wi-Fi - entering setup mode.");
    startBleProvisioning();
  }
}

void loop() {
  if (restartPending && (long)(millis() - restartAtMs) >= 0) {
    restartPending = false;
    if (bleActive) { BLEDevice::deinit(true); bleActive = false; }
    delay(100); ESP.restart();
  }
  if (sleepTimerActive && (long)(millis() - sleepTimerEndMs) >= 0) {
    sleepTimerActive = false; sleepTimerEndMs = 0; systemPowerOff();
  }
  checkIRRemote();   // physical remote works alongside the app
  if (mqttStarted) {
    mqtt.loop();
    if (millis() - lastTlm >= 2000) {
      lastTlm = millis();
      if (WiFi.status() == WL_CONNECTED) publishTelemetry();
    }
  }
}

/*
 * mqtt_bridge.ino  —  Companion file that adds app control (MQTT) to the
 * production ESP32-S3 fireplace firmware, WITHOUT changing the tested hardware
 * logic. Drop this file into the SAME sketch folder as the main firmware.
 *
 * It runs the same MQTT-over-WebSocket broker the Glow Fire app already speaks
 * (see docs/MQTT Contract.md). Each incoming command calls the main firmware's
 * existing functions/variables (systemPowerOn, applyMist, dfPlayer, ...), so the
 * hardware behaviour is exactly what has already been tested. The built-in web
 * page keeps working unchanged.
 *
 * ==== TWO LINES to add to the MAIN firmware ====
 *   in setup(), AFTER connectWiFi():   mqttBridgeBegin();
 *   in loop(),  anywhere:              mqttBridgeLoop();
 *
 * ==== Library required ====
 *   PicoMQTT (includes PicoWebsocket) + ArduinoJson v7  (Library Manager)
 *
 * ==== Board settings ====
 *   Board: ESP32S3 Dev Module   Partition: Huge APP (3MB No OTA)
 *
 * Everything below references globals defined in the main file; Arduino compiles
 * all .ino files in a folder as one unit, so they are shared automatically.
 */
#include <PicoMQTT.h>
#include <PicoWebsocket.h>
#include <ArduinoJson.h>
#include <ESPmDNS.h>

// Must match the app's serialNumber (src/config.ts). Topics are kl/{sn}/*.
static const char* KL_SERIAL_NO = "KL-2026-A3F92C";
static const char* KL_MDNS_HOST = "kl-glowfire";

// Broker over WebSocket on 9001 (same as the dev firmware / the app).
static WiFiServer klTcpServer(9001);
static PicoWebsocket::Server<::WiFiServer> klWsServer(klTcpServer);
static PicoMQTT::Server klMqtt(klWsServer);

static String KL_T_CMD, KL_T_TLM, KL_T_MAN, KL_T_ACK;
static unsigned long klLastTlm = 0;
static bool klMqttStarted = false;

// ---- helpers: map between the app's ranges and the device's ranges ----
static int klAppVolToDevice(int v0to10) { return constrain((int)lround(v0to10 * 3.0), 0, 30); }   // 0..10 -> 0..30
static int klDeviceVolToApp(int v0to30) { return constrain((int)lround(v0to30 / 3.0), 0, 10); }    // 0..30 -> 0..10

// =====================================================
// Publishers
// =====================================================
static void klPublishAck(const char* msgId, bool ok = true) {
  if (!msgId || !strlen(msgId)) return;
  JsonDocument a;
  a["msgId"] = msgId;
  a["ok"] = ok;
  String out; serializeJson(a, out);
  klMqtt.publish(KL_T_ACK, out);
}

static void klPublishManifest() {
  JsonDocument doc;
  doc["serialNumber"] = KL_SERIAL_NO;
  doc["firmwareVersion"] = "prod-s3-1.0";
  doc["skuHint"] = "KL-PRO";
  JsonObject c = doc["capabilities"].to<JsonObject>();
  c["vapor"] = true;
  JsonObject lg = c["lighting"].to<JsonObject>();
  JsonArray zones = lg["zones"].to<JsonArray>();
  zones.add("flame");
  lg["relays"] = 0;
  JsonObject cl = c["climate"].to<JsonObject>();
  cl["heater"] = true; cl["thermostat"] = false; cl["stages"] = 2;   // two 1000W heaters
  JsonObject au = c["audio"].to<JsonObject>();
  au["present"] = true; au["volumeSteps"] = 10; au["trackControl"] = true;
  JsonObject fan = c["exhaustFan"].to<JsonObject>();
  fan["present"] = false;
  fan["speeds"].to<JsonArray>();
  JsonObject rc = c["remoteControl"].to<JsonObject>();
  rc["present"] = true;                 // IR remote fitted
  c["hotelschaltung"] = false;
  JsonObject net = doc["network"].to<JsonObject>();
  net["mqttPort"] = 1883; net["wsPort"] = 9001;
  net["mdnsHostname"] = KL_MDNS_HOST;
  net["ip"] = WiFi.localIP().toString();
  String out; serializeJson(doc, out);
  klMqtt.publish(KL_T_MAN, out);
}

static void klPublishTelemetry() {
  JsonDocument doc;
  doc["ts"] = (uint32_t)(millis() / 1000);
  doc["online"] = true;
  doc["firmwareVersion"] = "prod-s3-1.0";
  doc["wifiRssi"] = (int)WiFi.RSSI();
  doc["power"] = systemOn;

  JsonObject v = doc["vapor"].to<JsonObject>();
  v["on"] = mistOn;
  v["intensity"] = mistLevel;            // 0..5 (app shows /6)
  v["waterLevel"] = "full";              // no water sensor on this board

  // Flame lighting mirrors strip 1. NOTE the R/G swap: the physical strip stores
  // requested-red in the green slot, so swap back when reporting to the app.
  JsonObject lt = doc["lighting"].to<JsonObject>();
  JsonObject fl = lt["flame"].to<JsonObject>();
  fl["on"] = ledStates[0].on;
  fl["r"] = ledStates[0].green;          // swap back
  fl["g"] = ledStates[0].red;            // swap back
  fl["b"] = ledStates[0].blue;
  fl["brightness"] = ledStates[0].brightnessPercent;

  JsonObject clm = doc["climate"].to<JsonObject>();
  clm["heaterOn"] = (heater1On || heater2On || smallHeaterOn);
  clm["stage"] = heater2On ? 2 : 1;
  clm["targetTemp"] = 21;                // no thermostat control on this board
  clm["currentTemp"] = isnan(temperatureC) ? 20.0 : temperatureC;
  clm["humidity"] = isnan(humidityPercent) ? 45.0 : humidityPercent;

  JsonObject au = doc["audio"].to<JsonObject>();
  au["on"] = isPlaying;
  au["volume"] = klDeviceVolToApp(volumeLevel);
  au["trackIndex"] = 0;
  au["trackName"] = "Track";

  JsonObject timer = doc["timer"].to<JsonObject>();
  timer["sleepActive"] = timerActive;
  timer["sleepRemaining"] = (uint32_t)getTimerRemainingSeconds();
  timer["scheduleActive"] = false;
  timer["scheduleNext"] = nullptr;

  String out; serializeJson(doc, out);
  klMqtt.publish(KL_T_TLM, out);
}

// =====================================================
// Command handler  (app -> hardware)
// =====================================================
static void klOnCommand(const char* topic, const char* payload) {
  JsonDocument doc;
  if (deserializeJson(doc, payload)) return;
  const char* module = doc["module"] | "";
  const char* action = doc["action"] | "";
  const char* msgId  = doc["msgId"]  | "";

  if (!strcmp(action, "request_manifest")) { klPublishManifest(); klPublishAck(msgId); return; }

  if (!strcmp(module, "system")) {
    if (!strcmp(action, "power")) {
      bool on = doc["value"] | false;
      if (on) systemPowerOn(); else systemPowerOff();
    } else if (!strcmp(action, "factory_reset")) {
      klPublishAck(msgId);
      prefs.begin("wifi", false); prefs.clear(); prefs.end();
      WiFi.disconnect(true, true);
      delay(500); ESP.restart();
      return;
    }

  } else if (!strcmp(module, "vapor")) {                 // "vapour" = the mist maker
    if (!strcmp(action, "power")) {
      mistOn = doc["value"] | false;
      if (mistOn && mistLevel == 0) mistLevel = 5;
      if (!mistOn) mistLevel = 0;
      systemOn = true;
      applyMist();
    } else if (!strcmp(action, "set_intensity")) {
      int level = doc["value"] | 0;                      // app 1..6
      mistLevel = constrain(level, 0, 5);                // device 0..5
      mistOn = mistLevel > 0;
      systemOn = true;
      applyMist();
    }

  } else if (!strcmp(module, "lighting")) {              // drives all 3 LED strips together
    if (!strcmp(action, "set_color")) {
      // App sends true RGB; the strip has R/G swapped, so store red in green slot.
      uint8_t r = doc["value"]["r"] | 0;
      uint8_t g = doc["value"]["g"] | 0;
      uint8_t b = doc["value"]["b"] | 0;
      for (int i = 0; i < 3; i++) {
        ledStates[i].on = true;
        ledStates[i].red = g;           // swap
        ledStates[i].green = r;         // swap
        ledStates[i].blue = b;
      }
      systemOn = true;
      applyLedStrips();
    } else if (!strcmp(action, "set_brightness")) {
      int b = constrain((int)(doc["value"] | 0), 0, 100);
      for (int i = 0; i < 3; i++) ledStates[i].brightnessPercent = b;
      applyLedStrips();
    } else if (!strcmp(action, "power")) {
      bool on = doc["value"] | false;
      for (int i = 0; i < 3; i++) ledStates[i].on = on;
      if (on) systemOn = true;
      applyLedStrips();
    }

  } else if (!strcmp(module, "audio")) {
    if (!strcmp(action, "power")) {
      bool on = doc["value"] | false;
      if (on) { dfPlayer.start(); isPlaying = true; }
      else    { dfPlayer.pause(); isPlaying = false; }
    } else if (!strcmp(action, "set_volume")) {
      volumeLevel = klAppVolToDevice(doc["value"] | 0);  // app 0..10 -> 0..30
      dfPlayer.volume(volumeLevel);
    } else if (!strcmp(action, "track")) {
      const char* dir = doc["value"] | "";
      if (!strcmp(dir, "next")) dfPlayer.next();
      else if (!strcmp(dir, "prev")) dfPlayer.previous();
      isPlaying = true;
    }

  } else if (!strcmp(module, "climate")) {               // the two 1000W heaters (+ safety fan)
    if (!strcmp(action, "power")) {
      bool on = doc["value"] | false;
      systemOn = true;
      if (on) { heater1On = true; heaterFanOn = true; }
      else    { heater1On = false; heater2On = false; }  // fan interlock handled in applyHeatingOutputs
      applyHeatingOutputs();
    } else if (!strcmp(action, "set_stage")) {
      int stage = doc["value"] | 1;
      systemOn = true;
      heater1On = true;
      heater2On = (stage >= 2);
      heaterFanOn = true;
      applyHeatingOutputs();
    }
    // set_thermostat: no thermostat hardware on this board -> ignored (telemetry shows temp only)

  } else if (!strcmp(module, "timer")) {
    if (!strcmp(action, "set_sleep")) {
      long sec = doc["value"] | 0;
      if (sec <= 0) { timerActive = false; timerMinutesSet = 0; }
      else {
        timerMinutesSet = (int)((sec + 59) / 60);
        timerEndMillis = millis() + (unsigned long)sec * 1000UL;
        timerActive = true;
        systemPowerOn();
      }
    }
  }

  klPublishAck(msgId);
}

// =====================================================
// Public hooks — call these from the main setup() / loop()
// =====================================================
void mqttBridgeBegin() {
  String sn = KL_SERIAL_NO;
  KL_T_CMD = "kl/" + sn + "/cmd";
  KL_T_TLM = "kl/" + sn + "/telemetry";
  KL_T_MAN = "kl/" + sn + "/manifest";
  KL_T_ACK = "kl/" + sn + "/ack";

  if (MDNS.begin(KL_MDNS_HOST)) {
    Serial.printf("[mqtt] mDNS: %s.local\n", KL_MDNS_HOST);
  }
  klMqtt.subscribe(KL_T_CMD, klOnCommand);
  klMqtt.begin();
  klMqttStarted = true;
  Serial.print("[mqtt] app broker on ws://");
  Serial.print(WiFi.localIP());
  Serial.println(":9001");
}

void mqttBridgeLoop() {
  if (!klMqttStarted) return;
  klMqtt.loop();
  if (millis() - klLastTlm >= 2000) {
    klLastTlm = millis();
    if (WiFi.status() == WL_CONNECTED) klPublishTelemetry();
  }
}

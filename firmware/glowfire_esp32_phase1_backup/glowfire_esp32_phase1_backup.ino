/*
 * Glow Fire — ESP32 firmware seed (bring-up).
 * Hosts an MQTT broker over WebSocket on port 9001 (the port the React Native app
 * connects to) and implements the SRS §3.2 contract: command intake on kl/{sn}/cmd,
 * telemetry on kl/{sn}/telemetry, manifest on request, ack on kl/{sn}/ack.
 *
 * Libraries (Arduino Library Manager): PicoMQTT, ArduinoJson (v7), Adafruit NeoPixel.
 * Board: ESP32 Dev Module. Serial Monitor: 115200 baud.
 */
#include <WiFi.h>
#include <WiFiMulti.h>
#include <ESPmDNS.h>
#include <Arduino.h>
#include <PicoMQTT.h>
#include <PicoWebsocket.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>

// ---------- CONFIG ----------
const char* SERIAL_NO = "KL-2026-A3F92C";   // MUST match the app's serialNumber
const char* MDNS_HOST = "kl-glowfire";      // device reachable at  kl-glowfire.local
WiFiMulti wifiMulti;                         // add every network in setup() below

// Built-in LED. Classic ESP32 (WROOM-32): use GPIO2. DO NOT use GPIO6-11 (flash pins).
#define LED_PIN 2

// WS2812 flame LED strip (confirmed wiring: data on GPIO25, 10 LEDs).
#define STRIP_PIN 25
#define NUM_LEDS  10
Adafruit_NeoPixel strip(NUM_LEDS, STRIP_PIN, NEO_GRB + NEO_KHZ800);

void setStrip(uint8_t r, uint8_t g, uint8_t b) {
  for (int i = 0; i < NUM_LEDS; i++) strip.setPixelColor(i, strip.Color(r, g, b));
  strip.show();
}

// ---------- Broker over WebSocket on 9001 ----------
WiFiServer tcpServer(9001);
PicoWebsocket::Server<::WiFiServer> wsServer(tcpServer);
PicoMQTT::Server mqtt(wsServer);

// ---------- Topics ----------
String T_CMD, T_TLM, T_MAN, T_ACK;

// ---------- Device state ----------
bool power = false;
bool vaporOn = true;
int  vaporIntensity = 3;
unsigned long bootMs = 0;
unsigned long lastTlm = 0;

void publishManifest() {
  JsonDocument doc;
  doc["serialNumber"] = SERIAL_NO;
  doc["firmwareVersion"] = "1.0.0-esp";
  doc["skuHint"] = "KL-PRO";
  JsonObject c = doc["capabilities"].to<JsonObject>();
  c["vapor"] = true;
  JsonObject lg = c["lighting"].to<JsonObject>();
  JsonArray zones = lg["zones"].to<JsonArray>();
  zones.add("flame"); zones.add("ambient"); zones.add("glow");
  lg["relays"] = 3;
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

  String out; serializeJson(doc, out);
  mqtt.publish(T_MAN, out);
  Serial.println("[mqtt] manifest published");
}

void publishTelemetry() {
  JsonDocument doc;
  doc["ts"] = (uint32_t)(millis() / 1000);
  doc["online"] = true;
  doc["uptime"] = (uint32_t)((millis() - bootMs) / 1000);
  doc["firmwareVersion"] = "1.0.0-esp";
  doc["wifiRssi"] = (int)WiFi.RSSI();
  doc["power"] = power;
  doc["hotelschaltung"] = false;
  JsonObject v = doc["vapor"].to<JsonObject>();
  v["on"] = vaporOn; v["intensity"] = vaporIntensity; v["waterLevel"] = "medium";
  JsonObject lt = doc["lighting"].to<JsonObject>();
  JsonObject fl = lt["flame"].to<JsonObject>();
  fl["on"] = true; fl["r"] = 255; fl["g"] = 80; fl["b"] = 0; fl["brightness"] = 85;
  JsonObject clm = doc["climate"].to<JsonObject>();
  clm["heaterOn"] = false; clm["stage"] = 1; clm["targetTemp"] = 21;
  clm["currentTemp"] = 20.0; clm["humidity"] = 45.0;

  String out; serializeJson(doc, out);
  mqtt.publish(T_TLM, out);
}

void onCommand(const char* topic, const char* payload) {
  Serial.printf("[cmd] %s\n", payload);
  JsonDocument doc;
  if (deserializeJson(doc, payload)) { Serial.println("[cmd] bad json"); return; }

  const char* module = doc["module"] | "";
  const char* action = doc["action"] | "";

  if (!strcmp(action, "request_manifest")) { publishManifest(); return; }

  if (!strcmp(module, "system") && !strcmp(action, "power")) {
    power = doc["value"] | false;
    digitalWrite(LED_PIN, power ? HIGH : LOW);
    setStrip(power ? 255 : 0, power ? 80 : 0, 0);       // warm flame on, off when powered down
    Serial.printf("[power] %s\n", power ? "ON" : "OFF");
  } else if (!strcmp(module, "lighting")) {
    if (!strcmp(action, "set_color")) {
      setStrip(doc["value"]["r"] | 255, doc["value"]["g"] | 80, doc["value"]["b"] | 0);
      Serial.println("[lighting] colour set");
    } else if (!strcmp(action, "set_brightness")) {
      int br = doc["value"] | 100;                       // app sends 0-100
      strip.setBrightness(map(br, 0, 100, 0, 200));      // cap at 200/255
      strip.show();
      Serial.printf("[lighting] brightness %d\n", br);
    }
  } else if (!strcmp(module, "vapor")) {
    if (!strcmp(action, "power")) vaporOn = doc["value"] | false;
    else if (!strcmp(action, "set_intensity")) vaporIntensity = doc["value"] | 0;
  }

  const char* msgId = doc["msgId"] | "";
  if (strlen(msgId)) {
    JsonDocument a; a["msgId"] = msgId; a["ok"] = true;
    String out; serializeJson(a, out);
    mqtt.publish(T_ACK, out);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  strip.begin();
  strip.setBrightness(120);   // ~half power — keeps current draw safe on USB
  strip.clear();
  strip.show();
  bootMs = millis();

  String sn = SERIAL_NO;
  T_CMD = "kl/" + sn + "/cmd";
  T_TLM = "kl/" + sn + "/telemetry";
  T_MAN = "kl/" + sn + "/manifest";
  T_ACK = "kl/" + sn + "/ack";

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);                 // disable Wi-Fi modem power-save → far fewer dropouts
  // Add every network the device should accept — it joins whichever is in range.
  // NOTE: This is an obsolete Phase-1 backup that hardcoded Wi-Fi credentials.
  // The current firmware provisions Wi-Fi over Bluetooth instead (nothing hardcoded).
  // Replace the placeholders below only for a local test; never commit real credentials.
  wifiMulti.addAP("YOUR_WIFI_SSID", "YOUR_WIFI_PASSWORD");
  wifiMulti.addAP("YOUR_SECOND_WIFI_SSID", "YOUR_SECOND_WIFI_PASSWORD");
  // wifiMulti.addAP("AnotherNetwork", "password");   // <-- add more locations here
  Serial.print("Connecting to WiFi");
  while (wifiMulti.run() != WL_CONNECTED) { delay(400); Serial.print("."); }
  WiFi.setTxPower(WIFI_POWER_19_5dBm);  // maximum transmit power for best range/stability
  Serial.println();
  Serial.print(">>> ESP32 IP ADDRESS: ");
  Serial.println(WiFi.localIP());
  if (MDNS.begin(MDNS_HOST)) Serial.printf(">>> mDNS name: %s.local\n", MDNS_HOST);

  mqtt.subscribe(T_CMD, onCommand);
  mqtt.begin();
  Serial.println("MQTT/WS broker listening on :9001");
}

void loop() {
  mqtt.loop();
  if (millis() - lastTlm >= 2000) {
    lastTlm = millis();
    if (WiFi.status() == WL_CONNECTED) publishTelemetry();
  }
}

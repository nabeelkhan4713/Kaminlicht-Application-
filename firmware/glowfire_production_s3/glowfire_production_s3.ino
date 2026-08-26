#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <DFRobotDFPlayerMini.h>
#include <DHT.h>
#include <IRremote.hpp>
#include <esp32-hal-rmt.h>

#if !defined(ARDUINO_ARCH_ESP32)
#error "This sketch requires the Espressif Arduino-ESP32 core."
#endif

// =====================================================
// ESP32-S3 Fireplace / DFPlayer / Blowers / Mist Web UI
// Board: ESP32S3 Dev Module
// USB CDC On Boot: Enabled
// USB Mode: Hardware CDC and JTAG
// =====================================================
//
// ===== PIN MAP (compare with the ESP32-S3-WROOM-1 schematic) =====
//
//   HOW TO READ THE SCHEMATIC: every pin shows TWO numbers, e.g. "LED1 -17- IO9".
//     - the plain number (17) is the PHYSICAL package pin  -> IGNORE for code
//     - the "IOxx" number (IO9) is the GPIO                -> THIS is what the code uses
//   Trap: LED1/2/3 sit at physical pins 17/18/19 but are GPIO IO9/IO10/IO11.
//   The DFPlayer's IO17/IO18 are a DIFFERENT pin from physical-pin-17. Always match "IOxx".
//
//   Schematic net   GPIO   Function
//   -------------   ----   -------------------------------
//   DebugLED        IO2    Debug/status LED
//   DHTD            IO4    DHT11 temperature/humidity sensor
//   BUTTOND         IO5    Analog button module
//   RECEIVERD       IO6    IR receiver
//   LED1            IO9    WS2805 LED strip 1
//   LED2            IO10   WS2805 LED strip 2
//   LED3            IO11   WS2805 LED strip 3
//   MYST            IO12   Mist maker
//   HEAT            IO13   Small heater
//   B1              IO14   Blower 1
//   B2              IO15   Blower 2
//   TX_ESP          IO17   DFPlayer  (ESP TX -> DFPlayer RX)
//   RX_ESP          IO18   DFPlayer  (ESP RX <- DFPlayer TX)
//   R1              IO40   Relay: heater fan
//   R2              IO41   SSR: 1000W heater 1
//   R3              IO42   SSR: 1000W heater 2
//
//   Wired on the PCB but NOT used in this code yet:
//   DRDYD IO16 (sensor data-ready), ReedSW1 IO47, ReedSW2 IO48 (reed switches)
//
//   ESP32-S3 strapping pins (do NOT repurpose): IO0, IO3, IO45, IO46
//   PSRAM (reserved, do NOT use): IO35, IO36, IO37
// =================================================================


// ---------- DFPlayer pins ----------
// SCHEMATIC CHECK: compare each pin below with the ESP32-S3-WROOM-1 diagram.
#define DFPLAYER_RX 18   // Schematic net: RX_ESP  -> IO18  (ESP32 receives from DFPlayer TX)
#define DFPLAYER_TX 17   // Schematic net: TX_ESP  -> IO17  (ESP32 sends to DFPlayer RX)

HardwareSerial dfSerial(2);
DFRobotDFPlayerMini dfPlayer;


// ---------- Debug LED ----------
#define DEBUG_LED_PIN 2   // Schematic net: DebugLED -> IO2

// ---------- WS2805 LED strips ----------
#define LED1_PIN 9        // Schematic net: LED1 -> IO9
#define LED2_PIN 10       // Schematic net: LED2 -> IO10
#define LED3_PIN 11       // Schematic net: LED3 -> IO11
const uint16_t LED_COUNT = 23;   // LEDs per strip

// ---------- Output pins ----------
#define MIST_PIN         12   // Schematic net: MYST -> IO12  (mist maker)
#define SMALL_HEATER_PIN 13   // Schematic net: HEAT -> IO13  (small heater)
#define BLOWER1_PIN      14   // Schematic net: B1   -> IO14  (blower 1)
#define BLOWER2_PIN      15   // Schematic net: B2   -> IO15  (blower 2)

// ---------- High-power heating outputs ----------
#define HEATER_FAN_PIN   40   // Schematic net: R1 -> IO40  (relay: heater fan)
#define HEATER1_SSR_PIN  41   // Schematic net: R2 -> IO41  (SSR: 1000W heater 1)
#define HEATER2_SSR_PIN  42   // Schematic net: R3 -> IO42  (SSR: 1000W heater 2)

// Change these levels only if your relay / SSR interface is active LOW.
const uint8_t SMALL_HEATER_ON_LEVEL  = HIGH;
const uint8_t SMALL_HEATER_OFF_LEVEL = LOW;
const uint8_t HEATER_FAN_ON_LEVEL    = HIGH;
const uint8_t HEATER_FAN_OFF_LEVEL   = LOW;
const uint8_t HEATER_SSR_ON_LEVEL    = HIGH;
const uint8_t HEATER_SSR_OFF_LEVEL   = LOW;


// ---------- WS2805 direct RMT driver ----------
// No NeoPixelBus is used.
//
// WS2805 datasheet:
// - 40 bits per logical pixel
// - chip order is RGBW1W2, but this physical strip requires G,R,B,W1,W2
// - MSB first
// - reset / latch: LOW for more than 280 us
//
// RMT clock is 10 MHz, therefore 1 tick = 100 ns.
//
// Timing selected inside the WS2805 datasheet ranges:
// 0 bit: HIGH 300 ns, LOW 1000 ns  -> total 1.30 us
// 1 bit: HIGH 700 ns, LOW 600 ns   -> total 1.30 us
//
// This uses the current Arduino-ESP32 RMT HAL and does NOT use
// the old legacy RMT driver that caused the previous boot conflict.
const uint32_t WS2805_RMT_FREQUENCY_HZ = 10000000UL;

const uint16_t WS2805_T0H_TICKS = 3;   // 300 ns
const uint16_t WS2805_T0L_TICKS = 10;  // 1000 ns
const uint16_t WS2805_T1H_TICKS = 7;   // 700 ns
const uint16_t WS2805_T1L_TICKS = 6;   // 600 ns

const uint16_t WS2805_RESET_US = 300;

const size_t WS2805_BITS_PER_PIXEL = 40;
const size_t WS2805_SYMBOL_COUNT =
  (size_t)LED_COUNT * WS2805_BITS_PER_PIXEL;

// One shared symbol buffer is enough because each strip is transmitted
// sequentially in blocking mode.
rmt_data_t ws2805Symbols[WS2805_SYMBOL_COUNT];

bool ws2805Led1Ready = false;
bool ws2805Led2Ready = false;
bool ws2805Led3Ready = false;

// ---------- Analog button module pin ----------
#define BUTTON_PIN 5      // Schematic net: BUTTOND -> IO5

// ---------- IR receiver ----------
#define IR_RECEIVE_PIN 6  // Schematic net: RECEIVERD -> IO6

#define IR_POWER_CODE      0xFB047F80UL
#define IR_FIRE_DOWN_CODE  0xFA057F80UL
#define IR_FIRE_UP_CODE    0xE51A7F80UL
#define IR_VOLUME_CODE     0xE6197F80UL

// ---------- DHT sensor pin ----------
#define DHT_PIN 4         // Schematic net: DHTD -> IO4  (temperature/humidity sensor)
#define DHT_TYPE DHT11

// ---------- DHT sensor ----------
DHT dht(DHT_PIN, DHT_TYPE);


// ---------- Blower variables ----------
int blower1Speed = 150;       // 0 to 255
int blower2Speed = 150;       // 0 to 255

bool blower1On = false;
bool blower2On = false;

const int blowerStep = 25;


// ---------- Heating variables ----------
bool smallHeaterOn = false;
bool heaterFanOn = false;
bool heater1On = false;
bool heater2On = false;


// ---------- Debug LED heartbeat ----------
bool debugLedState = false;
unsigned long lastDebugLedToggle = 0;
const unsigned long debugLedIntervalMs = 500;


// ---------- WS2805 LED variables ----------
struct LedStripState
{
  bool on;
  uint8_t red;
  uint8_t green;
  uint8_t blue;
  uint8_t warmWhite;
  uint8_t coolWhite;
  uint8_t brightnessPercent;
};

LedStripState ledStates[3] = {
  // Logical orange (R=255,G=80) stored with R/G physically swapped.
  {false, 80, 255, 0, 0, 0, 20},
  {false, 80, 255, 0, 0, 0, 20},
  {false, 80, 255, 0, 0, 0, 20}
};


// ---------- Mist maker variables ----------
bool mistOn = false;
int mistLevel = 0;   // 0 to 5

const int mistPwmValues[6] = {
  0,    // level 0 = OFF
  120,  // level 1 = low, stronger start
  150,  // level 2
  180,  // level 3
  220,  // level 4
  255   // level 5 = full power
};


// ---------- Button module / preset variables ----------
int allPresetLevel = 0;      // 0 = none/off, 1 = low, 2 = medium, 3 = high
int volumePresetLevel = 0;   // 0 = none, 1 = volume 10, 2 = volume 20, 3 = volume 30

int lastButtonReading = 0;
int stableButton = 0;
unsigned long lastButtonChangeTime = 0;
const unsigned long buttonDebounceMs = 80;


// ---------- System master ----------
bool systemOn = true;


// ---------- Timer ----------
bool timerActive = false;
unsigned long timerEndMillis = 0;
int timerMinutesSet = 0;


// ---------- Manual WiFi entry ----------
// Fill these in LOCALLY before flashing. Do NOT commit real credentials to git.
// (Future: replace with BLE provisioning like the dev firmware so nothing is hardcoded.)
const char* WIFI_SSID = "YOUR_WIFI_SSID";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";


// ---------- Website login ----------
// CHANGE THIS before shipping — the web page can switch the 1000W heaters.
const char* WEB_USERNAME = "admin";
const char* WEB_PASSWORD = "CHANGE_ME";


// ---------- Static IP ----------
IPAddress local_IP(192, 168, 188, 64);
IPAddress gateway(192, 168, 188, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress primaryDNS(8, 8, 8, 8);
IPAddress secondaryDNS(8, 8, 4, 4);


// ---------- Web server ----------
WebServer server(80);
Preferences prefs;


// ---------- Trigger and website-user tracking ----------
String lastTriggerSource = "Startup";
String lastTriggerAction = "Controller started";
String lastTriggerUser = "-";

const int MAX_WEB_CLIENTS = 10;
const unsigned long WEB_ACTIVE_TIMEOUT_MS = 10000;

String webClientIPs[MAX_WEB_CLIENTS];
unsigned long webClientLastSeen[MAX_WEB_CLIENTS] = {0};


// ---------- DFPlayer state ----------
int volumeLevel = 25;   // 0 to 30
bool isPlaying = false;


// ---------- WiFi reconnect timer ----------
unsigned long lastWiFiCheck = 0;
const unsigned long wifiCheckInterval = 5000;


// ---------- DHT reading timer ----------
float temperatureC = NAN;
float humidityPercent = NAN;

unsigned long lastDhtRead = 0;
const unsigned long dhtReadInterval = 2000;


// ---------- Function prototypes ----------
void applyAllOutputs();
void applyHeatingOutputs();
void applyLedStrips();
void updateDebugLed();
void systemPowerOff();
void systemPowerOn();
void toggleMasterPower();
void cycleVolumePreset();
void checkIRRemote();
void recordTrigger(const String& source, const String& action, const String& user = "-");
void touchWebClient();
int countActiveWebUsers();
String activeWebClientList();
String currentWebUser();


// =====================================================
// Trigger and website-user tracking
// =====================================================

void recordTrigger(const String& source, const String& action, const String& user)
{
  lastTriggerSource = source;
  lastTriggerAction = action;
  lastTriggerUser = user;

  Serial.print("TRIGGER | Source: ");
  Serial.print(source);
  Serial.print(" | Action: ");
  Serial.print(action);

  if (user != "-")
  {
    Serial.print(" | User: ");
    Serial.print(user);
  }

  Serial.println();
}


void touchWebClient()
{
  String ip = server.client().remoteIP().toString();
  unsigned long now = millis();

  // Refresh an existing client.
  for (int i = 0; i < MAX_WEB_CLIENTS; i++)
  {
    if (webClientIPs[i] == ip)
    {
      webClientLastSeen[i] = now;
      return;
    }
  }

  // Use an empty or expired slot.
  for (int i = 0; i < MAX_WEB_CLIENTS; i++)
  {
    if (webClientIPs[i].length() == 0 ||
        (unsigned long)(now - webClientLastSeen[i]) > WEB_ACTIVE_TIMEOUT_MS)
    {
      webClientIPs[i] = ip;
      webClientLastSeen[i] = now;
      return;
    }
  }

  // If all slots are occupied, replace the oldest one.
  int oldestIndex = 0;
  for (int i = 1; i < MAX_WEB_CLIENTS; i++)
  {
    if (webClientLastSeen[i] < webClientLastSeen[oldestIndex])
    {
      oldestIndex = i;
    }
  }

  webClientIPs[oldestIndex] = ip;
  webClientLastSeen[oldestIndex] = now;
}


int countActiveWebUsers()
{
  int count = 0;
  unsigned long now = millis();

  for (int i = 0; i < MAX_WEB_CLIENTS; i++)
  {
    if (webClientIPs[i].length() > 0 &&
        (unsigned long)(now - webClientLastSeen[i]) <= WEB_ACTIVE_TIMEOUT_MS)
    {
      count++;
    }
  }

  return count;
}


String activeWebClientList()
{
  String list = "";
  unsigned long now = millis();

  for (int i = 0; i < MAX_WEB_CLIENTS; i++)
  {
    if (webClientIPs[i].length() > 0 &&
        (unsigned long)(now - webClientLastSeen[i]) <= WEB_ACTIVE_TIMEOUT_MS)
    {
      if (list.length() > 0)
      {
        list += ", ";
      }

      list += webClientIPs[i];
    }
  }

  if (list.length() == 0)
  {
    return "None";
  }

  return list;
}


String currentWebUser()
{
  return String(WEB_USERNAME) + " @ " + server.client().remoteIP().toString();
}


// =====================================================
// Debug LED heartbeat
// =====================================================

void updateDebugLed()
{
  unsigned long now = millis();

  if (now - lastDebugLedToggle >= debugLedIntervalMs)
  {
    lastDebugLedToggle = now;
    debugLedState = !debugLedState;
    digitalWrite(DEBUG_LED_PIN, debugLedState ? HIGH : LOW);
  }
}


// =====================================================
// WS2805 LED functions
// =====================================================

uint8_t scaleLedChannel(uint8_t value, uint8_t brightnessPercent)
{
  return (uint8_t)(((uint16_t)value * brightnessPercent) / 100U);
}


bool ws2805PinReady(uint8_t pin)
{
  if (pin == LED1_PIN)
  {
    return ws2805Led1Ready;
  }

  if (pin == LED2_PIN)
  {
    return ws2805Led2Ready;
  }

  if (pin == LED3_PIN)
  {
    return ws2805Led3Ready;
  }

  return false;
}


void ws2805EncodeBit(bool bitValue, size_t& symbolIndex)
{
  if (symbolIndex >= WS2805_SYMBOL_COUNT)
  {
    return;
  }

  rmt_data_t& symbol = ws2805Symbols[symbolIndex++];

  symbol.level0 = 1;
  symbol.level1 = 0;

  if (bitValue)
  {
    symbol.duration0 = WS2805_T1H_TICKS;
    symbol.duration1 = WS2805_T1L_TICKS;
  }
  else
  {
    symbol.duration0 = WS2805_T0H_TICKS;
    symbol.duration1 = WS2805_T0L_TICKS;
  }
}


void ws2805EncodeByte(uint8_t value, size_t& symbolIndex)
{
  // WS2805 sends the most significant bit first.
  for (int bit = 7; bit >= 0; bit--)
  {
    ws2805EncodeBit((value >> bit) & 0x01, symbolIndex);
  }
}


bool ws2805Show(uint8_t pin, const LedStripState& state)
{
  if (!ws2805PinReady(pin))
  {
    return false;
  }

  uint8_t red = 0;
  uint8_t green = 0;
  uint8_t blue = 0;
  uint8_t white1 = 0;
  uint8_t white2 = 0;

  if (systemOn && state.on && state.brightnessPercent > 0)
  {
    red = scaleLedChannel(state.red, state.brightnessPercent);
    green = scaleLedChannel(state.green, state.brightnessPercent);
    blue = scaleLedChannel(state.blue, state.brightnessPercent);

    // W1 = warm white, W2 = cool white for this controller.
    // If your physical strip has these two white channels reversed,
    // swap the next two assignments only.
    white1 = scaleLedChannel(state.warmWhite, state.brightnessPercent);
    white2 = scaleLedChannel(state.coolWhite, state.brightnessPercent);
  }

  size_t symbolIndex = 0;

  for (uint16_t pixel = 0; pixel < LED_COUNT; pixel++)
  {
    // WS2805 channel order for this strip:
    // R, G, B, W1, W2
    //
    // Website RED -> first channel
    // Website GREEN -> second channel
    ws2805EncodeByte(red, symbolIndex);
    ws2805EncodeByte(green, symbolIndex);
    ws2805EncodeByte(blue, symbolIndex);
    ws2805EncodeByte(white1, symbolIndex);
    ws2805EncodeByte(white2, symbolIndex);
  }

  bool ok = rmtWrite(
    pin,
    ws2805Symbols,
    symbolIndex,
    RMT_WAIT_FOR_EVER
  );

  // The RMT EOT level is LOW, so holding here provides the WS2805
  // frame reset / latch period (> 280 us).
  delayMicroseconds(WS2805_RESET_US);

  if (!ok)
  {
    Serial.print("WS2805 RMT transmission failed on GPIO ");
    Serial.println(pin);
  }

  return ok;
}


bool initWs2805Pin(uint8_t pin)
{
  // One RMT memory block per strip. ESP32-S3 has separate TX resources
  // and three TX outputs fit within the available TX channels.
  if (!rmtInit(
        pin,
        RMT_TX_MODE,
        RMT_MEM_NUM_BLOCKS_1,
        WS2805_RMT_FREQUENCY_HZ))
  {
    Serial.print("WS2805 RMT init FAILED on GPIO ");
    Serial.println(pin);
    return false;
  }

  // Keep the data line LOW after every transmission.
  rmtSetEOT(pin, 0);

  Serial.print("WS2805 RMT ready on GPIO ");
  Serial.println(pin);

  return true;
}


void initWs2805()
{
  ws2805Led1Ready = initWs2805Pin(LED1_PIN);
  ws2805Led2Ready = initWs2805Pin(LED2_PIN);
  ws2805Led3Ready = initWs2805Pin(LED3_PIN);

  Serial.print("WS2805 LED 1: ");
  Serial.println(ws2805Led1Ready ? "READY" : "FAILED");

  Serial.print("WS2805 LED 2: ");
  Serial.println(ws2805Led2Ready ? "READY" : "FAILED");

  Serial.print("WS2805 LED 3: ");
  Serial.println(ws2805Led3Ready ? "READY" : "FAILED");
}


void applyLedStrips()
{
  // Blocking sequential transfers keep one shared symbol buffer safe.
  ws2805Show(LED1_PIN, ledStates[0]);
  ws2805Show(LED2_PIN, ledStates[1]);
  ws2805Show(LED3_PIN, ledStates[2]);
}


int clampLedByte(int value)
{
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}


int clampLedPercent(int value)
{
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}


// =====================================================
// Output functions
// =====================================================

void applyBlower1()
{
  if (systemOn && blower1On)
  {
    analogWrite(BLOWER1_PIN, blower1Speed);
  }
  else
  {
    analogWrite(BLOWER1_PIN, 0);
  }

  Serial.print("Blower 1: ");
  Serial.print(blower1On ? "ON" : "OFF");
  Serial.print(" | Speed: ");
  Serial.println(blower1Speed);
}


void applyBlower2()
{
  if (systemOn && blower2On)
  {
    analogWrite(BLOWER2_PIN, blower2Speed);
  }
  else
  {
    analogWrite(BLOWER2_PIN, 0);
  }

  Serial.print("Blower 2: ");
  Serial.print(blower2On ? "ON" : "OFF");
  Serial.print(" | Speed: ");
  Serial.println(blower2Speed);
}


void applyMist()
{
  if (systemOn && mistOn && mistLevel > 0)
  {
    analogWrite(MIST_PIN, mistPwmValues[mistLevel]);
  }
  else
  {
    analogWrite(MIST_PIN, 0);
  }

  Serial.print("Mist: ");
  Serial.print(mistOn ? "ON" : "OFF");
  Serial.print(" | Level: ");
  Serial.print(mistLevel);
  Serial.print(" | PWM: ");
  Serial.println(mistPwmValues[mistLevel]);
}


void applyHeatingOutputs()
{
  // Small heater on GPIO 13: simple digital ON / OFF.
  bool smallHeaterOutputOn = systemOn && smallHeaterOn;
  digitalWrite(SMALL_HEATER_PIN,
               smallHeaterOutputOn ? SMALL_HEATER_ON_LEVEL
                                   : SMALL_HEATER_OFF_LEVEL);

  // Safety interlock: either 1000 W heater automatically requires the fan.
  if (systemOn && (heater1On || heater2On))
  {
    heaterFanOn = true;
  }

  // Fan output is applied before either SSR output.
  bool fanOutputOn = systemOn && heaterFanOn;
  digitalWrite(HEATER_FAN_PIN,
               fanOutputOn ? HEATER_FAN_ON_LEVEL : HEATER_FAN_OFF_LEVEL);

  bool heater1OutputOn = systemOn && heaterFanOn && heater1On;
  bool heater2OutputOn = systemOn && heaterFanOn && heater2On;

  digitalWrite(HEATER1_SSR_PIN,
               heater1OutputOn ? HEATER_SSR_ON_LEVEL : HEATER_SSR_OFF_LEVEL);
  digitalWrite(HEATER2_SSR_PIN,
               heater2OutputOn ? HEATER_SSR_ON_LEVEL : HEATER_SSR_OFF_LEVEL);

  Serial.print("Small heater: ");
  Serial.print(smallHeaterOutputOn ? "ON" : "OFF");
  Serial.print(" | Heater fan: ");
  Serial.print(fanOutputOn ? "ON" : "OFF");
  Serial.print(" | Heater 1: ");
  Serial.print(heater1OutputOn ? "ON" : "OFF");
  Serial.print(" | Heater 2: ");
  Serial.println(heater2OutputOn ? "ON" : "OFF");
}


void applyAllOutputs()
{
  applyBlower1();
  applyBlower2();
  applyMist();
  applyHeatingOutputs();
  applyLedStrips();
}



// =====================================================
// Button module / preset functions
// =====================================================

int getButton()
{
  int value = analogRead(BUTTON_PIN);

  if (value < 2244)
  {
    return 1;   // Button 1
  }
  else if (value < 2746)
  {
    return 2;   // Button 2
  }
  else if (value < 3200)
  {
    return 3;   // Button 3
  }
  else
  {
    return 0;   // No button
  }
}


void applyAllPreset(int level)
{
  systemOn = true;

  if (level < 1)
  {
    level = 1;
  }
  else if (level > 3)
  {
    level = 3;
  }

  allPresetLevel = level;

  // All three LED strips use the same fire color.
  // Logical orange R=255/G=80 is stored with R/G swapped for this strip.
  for (int i = 0; i < 3; i++)
  {
    ledStates[i].on = true;
    ledStates[i].red = 80;
    ledStates[i].green = 255;
    ledStates[i].blue = 0;
    ledStates[i].warmWhite = 0;
    ledStates[i].coolWhite = 0;
  }

  blower1On = true;
  blower2On = true;
  mistOn = true;

  if (level == 1)
  {
    ledStates[0].brightnessPercent = 25;
    ledStates[1].brightnessPercent = 25;
    ledStates[2].brightnessPercent = 25;

    blower1Speed = 90;
    blower2Speed = 90;
    mistLevel = 2;
  }
  else if (level == 2)
  {
    ledStates[0].brightnessPercent = 60;
    ledStates[1].brightnessPercent = 60;
    ledStates[2].brightnessPercent = 60;

    blower1Speed = 170;
    blower2Speed = 170;
    mistLevel = 4;
  }
  else
  {
    ledStates[0].brightnessPercent = 100;
    ledStates[1].brightnessPercent = 100;
    ledStates[2].brightnessPercent = 100;

    blower1Speed = 255;
    blower2Speed = 255;
    mistLevel = 5;
  }

  // One common preset controls LEDs, mist, and both blowers.
  // Heating remains independently controlled.
  applyAllOutputs();

  // Fire-level control also starts/resumes the sound.
  if (!isPlaying)
  {
    dfPlayer.start();
    isPlaying = true;
  }

  Serial.print("COMMON FIRE LEVEL: ");
  Serial.println(allPresetLevel);
}


void buttonOneAllLevels()
{
  // Button 1:
  // Press 1 = level 1
  // Press 2 = level 2
  // Press 3 = level 3
  // Press 4 = back to level 1
  if (allPresetLevel < 1 || allPresetLevel >= 3)
  {
    applyAllPreset(1);
  }
  else
  {
    applyAllPreset(allPresetLevel + 1);
  }
}


void cycleVolumePreset()
{
  // Shared by PCB Button 2 and the IR Volume button:
  // Press 1 = volume 10
  // Press 2 = volume 20
  // Press 3 = volume 30
  // Press 4 = back to volume 10
  volumePresetLevel++;

  if (volumePresetLevel > 3)
  {
    volumePresetLevel = 1;
  }

  if (volumePresetLevel == 1)
  {
    volumeLevel = 10;
  }
  else if (volumePresetLevel == 2)
  {
    volumeLevel = 20;
  }
  else
  {
    volumeLevel = 30;
  }

  dfPlayer.volume(volumeLevel);
}


void toggleMasterPower()
{
  // Shared by PCB Button 3 and the IR Power button.
  if (systemOn)
  {
    systemPowerOff();
  }
  else
  {
    applyAllPreset(1);
  }
}


void handleButtonPress(int button)
{
  if (button == 1)
  {
    buttonOneAllLevels();
    recordTrigger("PCB Button", "Fire mode level " + String(allPresetLevel), "Button 1");
  }
  else if (button == 2)
  {
    cycleVolumePreset();
    recordTrigger("PCB Button", "Volume level " + String(volumeLevel), "Button 2");
  }
  else if (button == 3)
  {
    toggleMasterPower();
    recordTrigger("PCB Button", systemOn ? "Power ON" : "Power OFF", "Button 3");
  }
}


void checkButtonModule()
{
  int reading = getButton();

  if (reading != lastButtonReading)
  {
    lastButtonChangeTime = millis();
    lastButtonReading = reading;
  }

  if ((millis() - lastButtonChangeTime) > buttonDebounceMs)
  {
    if (reading != stableButton)
    {
      stableButton = reading;

      // Trigger only when pressed.
      // Release back to 0 does nothing.
      if (stableButton != 0)
      {
        handleButtonPress(stableButton);
      }
    }
  }
}


// =====================================================
// IR remote control
// =====================================================

void remoteFireModeUp()
{
  int nextLevel = allPresetLevel;

  if (!systemOn || nextLevel < 1)
  {
    nextLevel = 1;
  }
  else if (nextLevel < 3)
  {
    nextLevel++;
  }

  applyAllPreset(nextLevel);
  recordTrigger("IR Remote", "Fire mode level " + String(allPresetLevel), "Fire Up");
}


void remoteFireModeDown()
{
  int nextLevel = allPresetLevel;

  if (!systemOn || nextLevel < 1)
  {
    nextLevel = 1;
  }
  else if (nextLevel > 1)
  {
    nextLevel--;
  }

  applyAllPreset(nextLevel);
  recordTrigger("IR Remote", "Fire mode level " + String(allPresetLevel), "Fire Down");
}


void checkIRRemote()
{
  if (!IrReceiver.decode())
  {
    return;
  }

  if (!(IrReceiver.decodedIRData.flags & IRDATA_FLAGS_IS_REPEAT))
  {
    uint32_t code = (uint32_t)IrReceiver.decodedIRData.decodedRawData;

    switch (code)
    {
      case IR_POWER_CODE:
        toggleMasterPower();
        recordTrigger("IR Remote", systemOn ? "Power ON" : "Power OFF", "Power");
        break;

      case IR_FIRE_DOWN_CODE:
        remoteFireModeDown();
        break;

      case IR_FIRE_UP_CODE:
        remoteFireModeUp();
        break;

      case IR_VOLUME_CODE:
        cycleVolumePreset();
        recordTrigger("IR Remote", "Volume level " + String(volumeLevel), "Volume Level");
        break;

      default:
        Serial.print("IR Remote | Unknown code: 0x");
        Serial.println(code, HEX);
        break;
    }
  }

  IrReceiver.resume();
}


// =====================================================
// Master system control
// =====================================================

void systemPowerOff()
{
  Serial.println("SYSTEM: OFF");

  systemOn = false;
  timerActive = false;
  timerMinutesSet = 0;
  allPresetLevel = 0;

  blower1On = false;
  blower2On = false;

  mistOn = false;
  mistLevel = 0;

  // All three LED strips turn OFF with master power.
  ledStates[0].on = false;
  ledStates[1].on = false;
  ledStates[2].on = false;

  // Small heater, high-power heaters, and heater fan all turn OFF.
  smallHeaterOn = false;
  heater1On = false;
  heater2On = false;
  heaterFanOn = false;

  applyAllOutputs();

  if (isPlaying)
  {
    dfPlayer.pause();
    isPlaying = false;
  }
}


void systemPowerOn()
{
  Serial.println("SYSTEM: ON");

  systemOn = true;
  applyAllOutputs();
}


// =====================================================
// Timer
// =====================================================

unsigned long getTimerRemainingSeconds()
{
  if (!timerActive)
  {
    return 0;
  }

  long remaining = (long)(timerEndMillis - millis());

  if (remaining <= 0)
  {
    return 0;
  }

  return remaining / 1000;
}


void checkTimer()
{
  if (!timerActive)
  {
    return;
  }

  if ((long)(millis() - timerEndMillis) >= 0)
  {
    Serial.println("TIMER: Finished. Turning system OFF.");
    systemPowerOff();
    recordTrigger("Timer", "Power OFF");
  }
}



// =====================================================
// DHT sensor
// =====================================================

void readDHT()
{
  if (millis() - lastDhtRead < dhtReadInterval)
  {
    return;
  }

  lastDhtRead = millis();

  float h = dht.readHumidity();
  float t = dht.readTemperature();  // Celsius

  if (!isnan(t) && !isnan(h))
  {
    temperatureC = t;
    humidityPercent = h;
  }
}


String dhtValueText(float value, int decimals)
{
  if (isnan(value))
  {
    return "--";
  }

  return String(value, decimals);
}


// =====================================================
// Status JSON
// =====================================================

String statusJson()
{
  readDHT();

  String json = "{";

  json += "\"ip\":\"";
  json += WiFi.localIP().toString();
  json += "\",";

  json += "\"systemOn\":";
  json += systemOn ? "true" : "false";
  json += ",";

  json += "\"allPresetLevel\":";
  json += String(allPresetLevel);
  json += ",";

  json += "\"volumePresetLevel\":";
  json += String(volumePresetLevel);
  json += ",";

  json += "\"volume\":";
  json += String(volumeLevel);
  json += ",";

  json += "\"isPlaying\":";
  json += isPlaying ? "true" : "false";
  json += ",";

  json += "\"blower1On\":";
  json += blower1On ? "true" : "false";
  json += ",";

  json += "\"blower1Speed\":";
  json += String(blower1Speed);
  json += ",";

  json += "\"blower2On\":";
  json += blower2On ? "true" : "false";
  json += ",";

  json += "\"blower2Speed\":";
  json += String(blower2Speed);
  json += ",";

  json += "\"mistOn\":";
  json += mistOn ? "true" : "false";
  json += ",";

  json += "\"mistLevel\":";
  json += String(mistLevel);
  json += ",";

  json += "\"mistPercent\":";
  json += String(mistLevel * 20);
  json += ",";

  json += "\"smallHeaterOn\":";
  json += (systemOn && smallHeaterOn) ? "true" : "false";
  json += ",";

  json += "\"debugLed\":";
  json += debugLedState ? "true" : "false";
  json += ",";

  json += "\"led1On\":";
  json += (systemOn && ledStates[0].on) ? "true" : "false";
  json += ",";

  json += "\"led1Brightness\":";
  json += String(ledStates[0].brightnessPercent);
  json += ",";

  json += "\"led2On\":";
  json += (systemOn && ledStates[1].on) ? "true" : "false";
  json += ",";

  json += "\"led2Brightness\":";
  json += String(ledStates[1].brightnessPercent);
  json += ",";

  json += "\"led3On\":";
  json += (systemOn && ledStates[2].on) ? "true" : "false";
  json += ",";

  json += "\"led3Brightness\":";
  json += String(ledStates[2].brightnessPercent);
  json += ",";

  json += "\"heaterFanOn\":";
  json += (systemOn && heaterFanOn) ? "true" : "false";
  json += ",";

  json += "\"heater1On\":";
  json += (systemOn && heaterFanOn && heater1On) ? "true" : "false";
  json += ",";

  json += "\"heater2On\":";
  json += (systemOn && heaterFanOn && heater2On) ? "true" : "false";
  json += ",";

  json += "\"temperatureC\":\"";
  json += dhtValueText(temperatureC, 1);
  json += "\",";

  json += "\"humidityPercent\":\"";
  json += dhtValueText(humidityPercent, 1);
  json += "\",";

  json += "\"timerActive\":";
  json += timerActive ? "true" : "false";
  json += ",";

  json += "\"timerMinutesSet\":";
  json += String(timerMinutesSet);
  json += ",";

  json += "\"timerRemainingSec\":";
  json += String(getTimerRemainingSeconds());
  json += ",";

  json += "\"activeWebUsers\":";
  json += String(countActiveWebUsers());
  json += ",";

  json += "\"activeWebClients\":\"";
  json += activeWebClientList();
  json += "\",";

  json += "\"lastTriggerSource\":\"";
  json += lastTriggerSource;
  json += "\",";

  json += "\"lastTriggerAction\":\"";
  json += lastTriggerAction;
  json += "\",";

  json += "\"lastTriggerUser\":\"";
  json += lastTriggerUser;
  json += "\"";

  json += "}";

  return json;
}


void sendStatus()
{
  server.send(200, "application/json", statusJson());
}


// =====================================================
// Web page
// =====================================================

String page()
{
  String html = "";

  html += "<!DOCTYPE html>";
  html += "<html>";
  html += "<head>";
  html += "<meta name='viewport' content='width=device-width, initial-scale=1'>";
  html += "<title>Fireplace Control</title>";

  html += "<style>";
  html += "body{font-family:Arial;background:#111;color:white;text-align:center;margin:0;padding:20px;}";
  html += "h1{font-size:28px;margin:10px 0 20px 0;}";
  html += "h2{font-size:23px;margin-top:0;}";
  html += ".frame{max-width:1250px;margin:auto;border:2px solid #444;border-radius:24px;padding:20px;background:#181818;box-shadow:0 0 25px #000;}";
  html += ".grid{display:flex;gap:18px;justify-content:center;align-items:stretch;flex-wrap:wrap;}";
  html += ".box{flex:1;min-width:250px;max-width:310px;background:#242424;padding:20px;border-radius:20px;box-shadow:0 0 15px #000;}";
  html += "button{width:90%;height:58px;font-size:20px;margin:9px;border:0;border-radius:15px;background:#444;color:white;cursor:pointer;}";
  html += "button:active{background:#777;transform:scale(0.98);}";
  html += "input{width:80%;height:48px;font-size:22px;text-align:center;border-radius:12px;border:0;margin:10px;background:#eee;color:#111;}";
  html += ".main{background:#0b74ff;}";
  html += ".vol{background:#2d8a34;}";
  html += ".danger{background:#9b2226;}";
  html += ".blower{background:#7a4cc2;}";
  html += ".mist{background:#0891b2;}";
  html += ".heater{background:#c2410c;}";
  html += ".led{background:#2563eb;}";
  html += "select{width:85%;height:48px;font-size:18px;border-radius:12px;border:0;margin:8px;padding:0 10px;}";
  html += "input[type=color]{width:80%;height:52px;border:0;border-radius:10px;margin:8px;}";
  html += "input[type=range]{width:80%;margin:14px;}";
  html += ".timer{background:#d97706;}";
  html += ".power{background:#b91c1c;}";
  html += ".info{font-size:19px;margin:12px;}";
  html += ".small{font-size:15px;color:#bbb;margin-top:12px;}";
  html += "</style>";

  html += "</head>";
  html += "<body>";

  html += "<div class='frame'>";
  html += "<h1>Fireplace Control</h1>";

  html += "<div class='info'>IP: <span id='ip'>";
  html += WiFi.localIP().toString();
  html += "</span></div>";

  html += "<div class='info'>System: <span id='systemstate'>";
  html += systemOn ? "ON" : "OFF";
  html += "</span></div>";

  html += "<div class='info'>All Preset Level: <span id='allpreset'>";
  html += String(allPresetLevel);
  html += "</span> / 3</div>";

  html += "<div class='info'>Active Website Users: <span id='activeusers'>0</span></div>";
  html += "<div class='small'>Active Devices: <span id='activeclients'>None</span></div>";
  html += "<div class='info'>Last Trigger: <span id='triggersource'>Startup</span></div>";
  html += "<div class='info'>Last Action: <span id='triggeraction'>Controller started</span></div>";
  html += "<div class='small'>Last Web User: <span id='triggeruser'>-</span></div>";

  html += "<button class='power' style='max-width:320px;' onclick=\"cmd('/systemtoggle')\">SYSTEM ON / OFF</button>";

  html += "<div class='grid'>";

  // ---------- DFPlayer box ----------
  html += "<div class='box'>";
  html += "<h2>DFPlayer</h2>";

  html += "<div class='info'>Volume: <span id='volume'>";
  html += String(volumeLevel);
  html += "</span> / 30</div>";

  html += "<div class='info'>State: <span id='playstate'>";
  html += isPlaying ? "Playing" : "Paused";
  html += "</span></div>";

  html += "<button class='main' onclick=\"cmd('/prev')\">Before Song</button>";
  html += "<button class='main' onclick=\"cmd('/next')\">Next Song</button>";
  html += "<button class='vol' onclick=\"cmd('/volup')\">Volume Up</button>";
  html += "<button class='vol' onclick=\"cmd('/voldown')\">Volume Down</button>";
  html += "<button onclick=\"cmd('/play')\">Play Song 1</button>";
  html += "<button class='danger' onclick=\"cmd('/pause')\">Pause / Resume</button>";

  html += "</div>";

  // ---------- Blower 1 box ----------
  html += "<div class='box'>";
  html += "<h2>Blower 1</h2>";

  html += "<div class='info'>State: <span id='blower1state'>";
  html += blower1On ? "ON" : "OFF";
  html += "</span></div>";

  html += "<div class='info'>Speed: <span id='blower1speed'>";
  html += String(blower1Speed);
  html += "</span> / 255</div>";

  html += "<button class='blower' onclick=\"cmd('/blower1toggle')\">ON / OFF</button>";
  html += "<button class='vol' onclick=\"cmd('/blower1up')\">Speed Up</button>";
  html += "<button class='danger' onclick=\"cmd('/blower1down')\">Speed Down</button>";

  html += "</div>";

  // ---------- Blower 2 box ----------
  html += "<div class='box'>";
  html += "<h2>Blower 2</h2>";

  html += "<div class='info'>State: <span id='blower2state'>";
  html += blower2On ? "ON" : "OFF";
  html += "</span></div>";

  html += "<div class='info'>Speed: <span id='blower2speed'>";
  html += String(blower2Speed);
  html += "</span> / 255</div>";

  html += "<button class='blower' onclick=\"cmd('/blower2toggle')\">ON / OFF</button>";
  html += "<button class='vol' onclick=\"cmd('/blower2up')\">Speed Up</button>";
  html += "<button class='danger' onclick=\"cmd('/blower2down')\">Speed Down</button>";

  html += "</div>";

  // ---------- Mist box ----------
  html += "<div class='box'>";
  html += "<h2>Mist Maker</h2>";

  html += "<div class='info'>State: <span id='miststate'>";
  html += mistOn ? "ON" : "OFF";
  html += "</span></div>";

  html += "<div class='info'>Level: <span id='mistlevel'>";
  html += String(mistLevel);
  html += "</span> / 5</div>";

  html += "<div class='info'>Power: <span id='mistpercent'>";
  html += String(mistLevel * 20);
  html += "</span>%</div>";

  html += "<button class='mist' onclick=\"cmd('/misttoggle')\">ON / OFF</button>";
  html += "<button class='vol' onclick=\"cmd('/mistup')\">Level Up</button>";
  html += "<button class='danger' onclick=\"cmd('/mistdown')\">Level Down</button>";

  html += "</div>";


  // ---------- WS2805 LED box ----------
  html += "<div class='box'>";
  html += "<h2>WS2805 LEDs</h2>";

  html += "<select id='ledtarget'>";
  html += "<option value='0'>All 3 LED strips</option>";
  html += "<option value='1'>LED 1 - GPIO 9</option>";
  html += "<option value='2'>LED 2 - GPIO 10</option>";
  html += "<option value='3'>LED 3 - GPIO 11</option>";
  html += "</select>";

  html += "<div class='info'>LED 1: <span id='led1state'>OFF</span> | <span id='led1brightness'>20</span>%</div>";
  html += "<div class='info'>LED 2: <span id='led2state'>OFF</span> | <span id='led2brightness'>20</span>%</div>";
  html += "<div class='info'>LED 3: <span id='led3state'>OFF</span> | <span id='led3brightness'>20</span>%</div>";

  html += "<input id='ledcolor' type='color' value='#ff5000'>";
  html += "<div class='info'>Brightness: <span id='ledbrightnessvalue'>20</span>%</div>";
  html += "<input id='ledbrightnessslider' type='range' min='0' max='100' value='20' oninput=\"document.getElementById('ledbrightnessvalue').innerText=this.value\">";

  html += "<button class='led' onclick=\"setLedColor()\">Apply RGB Color</button>";
  html += "<button class='vol' onclick=\"ledPreset('warm')\">Warm White</button>";
  html += "<button class='main' onclick=\"ledPreset('cool')\">Cool White</button>";
  html += "<button class='led' onclick=\"ledPreset('red')\">Red Test</button>";
  html += "<button class='led' onclick=\"ledPreset('green')\">Green Test</button>";
  html += "<button class='led' onclick=\"ledPreset('blue')\">Blue Test</button>";
  html += "<button class='vol' onclick=\"ledPower(1)\">LED ON</button>";
  html += "<button class='danger' onclick=\"ledPower(0)\">LED OFF</button>";

  html += "<div class='small'>This strip has red and green physically reversed. The website compensates automatically: Red is mapped to the strip's second color channel and Green to the first.</div>";
  html += "</div>";


  // ---------- Heating box ----------
  html += "<div class='box'>";
  html += "<h2>Heating</h2>";

  html += "<div class='info'>Small Heater GPIO 13: <span id='smallheaterstate'>";
  html += (systemOn && smallHeaterOn) ? "ON" : "OFF";
  html += "</span></div>";
  html += "<button class='heater' onclick=\"cmd('/smallheatertoggle')\">Small Heater ON / OFF</button>";

  html += "<div class='info'>Fan: <span id='heaterfanstate'>";
  html += (systemOn && heaterFanOn) ? "ON" : "OFF";
  html += "</span></div>";

  html += "<div class='info'>Heater 1 (1000 W): <span id='heater1state'>";
  html += (systemOn && heaterFanOn && heater1On) ? "ON" : "OFF";
  html += "</span></div>";

  html += "<div class='info'>Heater 2 (1000 W): <span id='heater2state'>";
  html += (systemOn && heaterFanOn && heater2On) ? "ON" : "OFF";
  html += "</span></div>";

  html += "<button class='blower' onclick=\"cmd('/heaterfantoggle')\">Fan ON / OFF</button>";
  html += "<button class='heater' onclick=\"cmd('/heater1toggle')\">Heater 1 ON / OFF</button>";
  html += "<button class='heater' onclick=\"cmd('/heater2toggle')\">Heater 2 ON / OFF</button>";
  html += "<div class='small'>Turning on either heater starts the fan. Turning the fan OFF also turns both 1000 W heaters OFF.</div>";

  html += "</div>";


  // ---------- DHT box ----------
  html += "<div class='box'>";
  html += "<h2>Temperature</h2>";

  html += "<div class='info'>Temp: <span id='temperature'>";
  html += dhtValueText(temperatureC, 1);
  html += "</span> &deg;C</div>";

  html += "<div class='info'>Humidity: <span id='humidity'>";
  html += dhtValueText(humidityPercent, 1);
  html += "</span>%</div>";

  html += "<div class='small'>Updates automatically every 2 seconds.</div>";

  html += "</div>";

  // ---------- Timer box ----------
  html += "<div class='box'>";  html += "<h2>Timer</h2>";

  html += "<div class='info'>Timer: <span id='timerstate'>";
  html += timerActive ? "ON" : "OFF";
  html += "</span></div>";

  html += "<div class='info'>Remaining: <span id='timerremaining'>0:00</span></div>";

  html += "<input id='timerminutes' type='number' min='1' max='600' value='5'>";
  html += "<button class='timer' onclick=\"setTimer()\">Set Timer</button>";
  html += "<button class='danger' onclick=\"cmd('/timerstop')\">Cancel Timer</button>";

  html += "</div>";

  html += "</div>";

  html += "<button class='danger' style='max-width:320px;margin-top:22px;' onclick=\"wifiReset()\">Reset Saved WiFi</button>";
  html += "<div class='small'>Buttons use fetch(), so the page does not refresh. SYSTEM OFF turns off DFPlayer, LED strips, blowers, mist, small heater, the 1000 W heaters, and their fan. The ESP and debug heartbeat LED stay online.</div>";

  html += "</div>";

  // ---------- JavaScript ----------
  html += "<script>";

  html += "function formatTime(sec){";
  html += "let m=Math.floor(sec/60);";
  html += "let s=sec%60;";
  html += "return m+':' +(s<10?'0':'')+s;";
  html += "}";

  html += "function updateStatus(s){";
  html += "document.getElementById('ip').innerText=s.ip;";
  html += "document.getElementById('systemstate').innerText=s.systemOn?'ON':'OFF';";
  html += "document.getElementById('allpreset').innerText=s.allPresetLevel;";
  html += "document.getElementById('volume').innerText=s.volume;";
  html += "document.getElementById('playstate').innerText=s.isPlaying?'Playing':'Paused';";
  html += "document.getElementById('blower1state').innerText=s.blower1On?'ON':'OFF';";
  html += "document.getElementById('blower1speed').innerText=s.blower1Speed;";
  html += "document.getElementById('blower2state').innerText=s.blower2On?'ON':'OFF';";
  html += "document.getElementById('blower2speed').innerText=s.blower2Speed;";
  html += "document.getElementById('miststate').innerText=s.mistOn?'ON':'OFF';";
  html += "document.getElementById('mistlevel').innerText=s.mistLevel;";
  html += "document.getElementById('mistpercent').innerText=s.mistPercent;";
  html += "document.getElementById('led1state').innerText=s.led1On?'ON':'OFF';";
  html += "document.getElementById('led1brightness').innerText=s.led1Brightness;";
  html += "document.getElementById('led2state').innerText=s.led2On?'ON':'OFF';";
  html += "document.getElementById('led2brightness').innerText=s.led2Brightness;";
  html += "document.getElementById('led3state').innerText=s.led3On?'ON':'OFF';";
  html += "document.getElementById('led3brightness').innerText=s.led3Brightness;";
  html += "document.getElementById('smallheaterstate').innerText=s.smallHeaterOn?'ON':'OFF';";
  html += "document.getElementById('heaterfanstate').innerText=s.heaterFanOn?'ON':'OFF';";
  html += "document.getElementById('heater1state').innerText=s.heater1On?'ON':'OFF';";
  html += "document.getElementById('heater2state').innerText=s.heater2On?'ON':'OFF';";
  html += "document.getElementById('temperature').innerText=s.temperatureC;";
  html += "document.getElementById('humidity').innerText=s.humidityPercent;";
  html += "document.getElementById('timerstate').innerText=s.timerActive?'ON':'OFF';";
  html += "document.getElementById('timerremaining').innerText=formatTime(s.timerRemainingSec);";
  html += "document.getElementById('activeusers').innerText=s.activeWebUsers;";
  html += "document.getElementById('activeclients').innerText=s.activeWebClients;";
  html += "document.getElementById('triggersource').innerText=s.lastTriggerSource;";
  html += "document.getElementById('triggeraction').innerText=s.lastTriggerAction;";
  html += "document.getElementById('triggeruser').innerText=s.lastTriggerUser;";
  html += "}";

  html += "async function cmd(path){";
  html += "try{";
  html += "let r=await fetch(path);";
  html += "let s=await r.json();";
  html += "updateStatus(s);";
  html += "}catch(e){console.log(e);}";
  html += "}";

  html += "async function setTimer(){";
  html += "let min=document.getElementById('timerminutes').value;";
  html += "if(min<1){min=1;}";
  html += "try{";
  html += "let r=await fetch('/timerset?min='+min);";
  html += "let s=await r.json();";
  html += "updateStatus(s);";
  html += "}catch(e){console.log(e);}";
  html += "}";

  html += "function hexToRgb(hex){";
  html += "return {r:parseInt(hex.substring(1,3),16),g:parseInt(hex.substring(3,5),16),b:parseInt(hex.substring(5,7),16)};";
  html += "}";

  html += "async function setLedColor(){";
  html += "let target=document.getElementById('ledtarget').value;";
  html += "let brightness=document.getElementById('ledbrightnessslider').value;";
  html += "let rgb=hexToRgb(document.getElementById('ledcolor').value);";
  html += "await cmd('/ledset?target='+target+'&r='+rgb.r+'&g='+rgb.g+'&b='+rgb.b+'&ww=0&cw=0&brightness='+brightness);";
  html += "}";

  html += "async function ledPreset(name){";
  html += "let target=document.getElementById('ledtarget').value;";
  html += "let brightness=document.getElementById('ledbrightnessslider').value;";
  html += "await cmd('/ledpreset?target='+target+'&name='+name+'&brightness='+brightness);";
  html += "}";

  html += "async function ledPower(on){";
  html += "let target=document.getElementById('ledtarget').value;";
  html += "await cmd('/ledpower?target='+target+'&on='+on);";
  html += "}";

  html += "async function refreshStatus(){";
  html += "try{";
  html += "let r=await fetch('/status');";
  html += "let s=await r.json();";
  html += "updateStatus(s);";
  html += "}catch(e){console.log(e);}";
  html += "}";

  html += "async function wifiReset(){";
  html += "if(confirm('Reset saved WiFi and restart ESP32?')){";
  html += "await fetch('/wifireset');";
  html += "document.body.innerHTML='<h1>WiFi cleared. ESP32 restarting...</h1>';";
  html += "}";
  html += "}";

  html += "setInterval(refreshStatus,1000);";
  html += "refreshStatus();";

  html += "</script>";

  html += "</body>";
  html += "</html>";

  return html;
}


// =====================================================
// Website login protection
// =====================================================

bool requireWebLogin()
{
  if (!server.authenticate(WEB_USERNAME, WEB_PASSWORD))
  {
    server.requestAuthentication();
    return false;
  }

  touchWebClient();
  return true;
}


// =====================================================
// Website handlers
// =====================================================

void handleRoot()
{
  if (!requireWebLogin())
  {
    return;
  }

  server.send(200, "text/html", page());
}


void handleStatus()
{
  if (!requireWebLogin())
  {
    return;
  }

  sendStatus();
}


void handleSystemToggle()
{
  if (!requireWebLogin())
  {
    return;
  }

  if (systemOn)
  {
    systemPowerOff();
  }
  else
  {
    systemPowerOn();
  }

  recordTrigger("Website", systemOn ? "Power ON" : "Power OFF", currentWebUser());
  sendStatus();
}


void handleTimerSet()
{
  if (!requireWebLogin())
  {
    return;
  }

  int minutes = server.arg("min").toInt();

  if (minutes < 1)
  {
    minutes = 1;
  }

  if (minutes > 600)
  {
    minutes = 600;
  }

  timerMinutesSet = minutes;
  timerEndMillis = millis() + ((unsigned long)minutes * 60000UL);
  timerActive = true;

  systemPowerOn();

  Serial.print("TIMER: Set for ");
  Serial.print(minutes);
  Serial.println(" minute(s)");

  recordTrigger("Website", "Timer set for " + String(minutes) + " minute(s)", currentWebUser());
  sendStatus();
}


void handleTimerStop()
{
  if (!requireWebLogin())
  {
    return;
  }

  timerActive = false;
  timerMinutesSet = 0;

  Serial.println("TIMER: Cancelled");

  recordTrigger("Website", "Timer cancelled", currentWebUser());
  sendStatus();
}


// ---------- DFPlayer handlers ----------

void handleNext()
{
  if (!requireWebLogin())
  {
    return;
  }

  systemPowerOn();

  Serial.println("WEB: Next song");
  dfPlayer.next();
  isPlaying = true;

  recordTrigger("Website", "Next song", currentWebUser());
  sendStatus();
}


void handlePrev()
{
  if (!requireWebLogin())
  {
    return;
  }

  systemPowerOn();

  Serial.println("WEB: Previous song");
  dfPlayer.previous();
  isPlaying = true;

  recordTrigger("Website", "Previous song", currentWebUser());
  sendStatus();
}


void handleVolUp()
{
  if (!requireWebLogin())
  {
    return;
  }

  if (volumeLevel < 30)
  {
    volumeLevel++;
  }

  dfPlayer.volume(volumeLevel);

  Serial.print("WEB: Volume up -> ");
  Serial.println(volumeLevel);

  recordTrigger("Website", "Volume up to " + String(volumeLevel), currentWebUser());
  sendStatus();
}


void handleVolDown()
{
  if (!requireWebLogin())
  {
    return;
  }

  if (volumeLevel > 0)
  {
    volumeLevel--;
  }

  dfPlayer.volume(volumeLevel);

  Serial.print("WEB: Volume down -> ");
  Serial.println(volumeLevel);

  recordTrigger("Website", "Volume down to " + String(volumeLevel), currentWebUser());
  sendStatus();
}


void handlePlay()
{
  if (!requireWebLogin())
  {
    return;
  }

  systemPowerOn();

  Serial.println("WEB: Play song 1");
  dfPlayer.play(1);
  isPlaying = true;

  recordTrigger("Website", "Play song 1", currentWebUser());
  sendStatus();
}


void handlePause()
{
  if (!requireWebLogin())
  {
    return;
  }

  if (!systemOn)
  {
    systemPowerOn();
  }

  if (isPlaying)
  {
    Serial.println("WEB: Pause");
    dfPlayer.pause();
    isPlaying = false;
  }
  else
  {
    Serial.println("WEB: Resume");
    dfPlayer.start();
    isPlaying = true;
  }

  recordTrigger("Website", isPlaying ? "Resume" : "Pause", currentWebUser());
  sendStatus();
}


void handleWifiReset()
{
  if (!requireWebLogin())
  {
    return;
  }

  recordTrigger("Website", "Reset saved WiFi", currentWebUser());
  server.send(200, "text/plain", "WiFi cleared. Restarting ESP32...");

  prefs.begin("wifi", false);
  prefs.clear();
  prefs.end();

  WiFi.disconnect(true, true);

  delay(1000);
  ESP.restart();
}


// ---------- Blower 1 handlers ----------

void handleBlower1Toggle()
{
  if (!requireWebLogin())
  {
    return;
  }

  systemPowerOn();

  blower1On = !blower1On;

  if (blower1On && blower1Speed == 0)
  {
    blower1Speed = 150;
  }

  Serial.println("WEB: Blower 1 toggle");
  applyBlower1();

  recordTrigger("Website", blower1On ? "Blower 1 ON" : "Blower 1 OFF", currentWebUser());
  sendStatus();
}


void handleBlower1Up()
{
  if (!requireWebLogin())
  {
    return;
  }

  systemPowerOn();

  blower1On = true;
  blower1Speed += blowerStep;

  if (blower1Speed > 255)
  {
    blower1Speed = 255;
  }

  Serial.print("WEB: Blower 1 speed up -> ");
  Serial.println(blower1Speed);

  applyBlower1();

  recordTrigger("Website", "Blower 1 speed " + String(blower1Speed), currentWebUser());
  sendStatus();
}


void handleBlower1Down()
{
  if (!requireWebLogin())
  {
    return;
  }

  blower1Speed -= blowerStep;

  if (blower1Speed <= 0)
  {
    blower1Speed = 0;
    blower1On = false;
  }

  Serial.print("WEB: Blower 1 speed down -> ");
  Serial.println(blower1Speed);

  applyBlower1();

  recordTrigger("Website", "Blower 1 speed " + String(blower1Speed), currentWebUser());
  sendStatus();
}


// ---------- Blower 2 handlers ----------

void handleBlower2Toggle()
{
  if (!requireWebLogin())
  {
    return;
  }

  systemPowerOn();

  blower2On = !blower2On;

  if (blower2On && blower2Speed == 0)
  {
    blower2Speed = 150;
  }

  Serial.println("WEB: Blower 2 toggle");
  applyBlower2();

  recordTrigger("Website", blower2On ? "Blower 2 ON" : "Blower 2 OFF", currentWebUser());
  sendStatus();
}


void handleBlower2Up()
{
  if (!requireWebLogin())
  {
    return;
  }

  systemPowerOn();

  blower2On = true;
  blower2Speed += blowerStep;

  if (blower2Speed > 255)
  {
    blower2Speed = 255;
  }

  Serial.print("WEB: Blower 2 speed up -> ");
  Serial.println(blower2Speed);

  applyBlower2();

  recordTrigger("Website", "Blower 2 speed " + String(blower2Speed), currentWebUser());
  sendStatus();
}


void handleBlower2Down()
{
  if (!requireWebLogin())
  {
    return;
  }

  blower2Speed -= blowerStep;

  if (blower2Speed <= 0)
  {
    blower2Speed = 0;
    blower2On = false;
  }

  Serial.print("WEB: Blower 2 speed down -> ");
  Serial.println(blower2Speed);

  applyBlower2();

  recordTrigger("Website", "Blower 2 speed " + String(blower2Speed), currentWebUser());
  sendStatus();
}


// ---------- Mist handlers ----------

void handleMistToggle()
{
  if (!requireWebLogin())
  {
    return;
  }

  systemPowerOn();

  mistOn = !mistOn;

  if (mistOn && mistLevel == 0)
  {
    mistLevel = 5;   // start full power so the mist starts reliably
  }

  if (!mistOn)
  {
    mistLevel = 0;
  }

  Serial.println("WEB: Mist toggle");
  applyMist();

  recordTrigger("Website", mistOn ? "Mist ON" : "Mist OFF", currentWebUser());
  sendStatus();
}


void handleMistUp()
{
  if (!requireWebLogin())
  {
    return;
  }

  systemPowerOn();

  mistOn = true;

  if (mistLevel < 5)
  {
    mistLevel++;
  }

  Serial.print("WEB: Mist level up -> ");
  Serial.println(mistLevel);

  applyMist();

  recordTrigger("Website", "Mist level " + String(mistLevel), currentWebUser());
  sendStatus();
}


void handleMistDown()
{
  if (!requireWebLogin())
  {
    return;
  }

  if (mistLevel > 0)
  {
    mistLevel--;
  }

  if (mistLevel == 0)
  {
    mistOn = false;
  }

  Serial.print("WEB: Mist level down -> ");
  Serial.println(mistLevel);

  applyMist();

  recordTrigger("Website", "Mist level " + String(mistLevel), currentWebUser());
  sendStatus();
}


// =====================================================
// WS2805 LED handlers
// =====================================================

int requestedLedTarget()
{
  int target = server.arg("target").toInt();

  if (target < 0 || target > 3)
  {
    target = 0;
  }

  return target;
}


void applyLedStateToTarget(int target, const LedStripState& state)
{
  if (target == 0)
  {
    ledStates[0] = state;
    ledStates[1] = state;
    ledStates[2] = state;
  }
  else
  {
    ledStates[target - 1] = state;
  }

  applyLedStrips();
}


void handleLedSet()
{
  if (!requireWebLogin())
  {
    return;
  }

  systemPowerOn();

  int target = requestedLedTarget();

  LedStripState state;
  state.on = true;
  // Actual strip has RED and GREEN channels reversed.
  // Store requested RED in the physical GREEN slot and requested GREEN
  // in the physical RED slot. The low-level transmitter remains R,G,B.
  state.red = clampLedByte(server.arg("g").toInt());
  state.green = clampLedByte(server.arg("r").toInt());
  state.blue = clampLedByte(server.arg("b").toInt());
  state.warmWhite = clampLedByte(server.arg("ww").toInt());
  state.coolWhite = clampLedByte(server.arg("cw").toInt());
  state.brightnessPercent = clampLedPercent(server.arg("brightness").toInt());

  applyLedStateToTarget(target, state);

  recordTrigger("Website", "LED color changed", currentWebUser());
  sendStatus();
}


void handleLedPreset()
{
  if (!requireWebLogin())
  {
    return;
  }

  systemPowerOn();

  int target = requestedLedTarget();
  String name = server.arg("name");
  int brightness = clampLedPercent(server.arg("brightness").toInt());

  LedStripState state = {true, 0, 0, 0, 0, 0, (uint8_t)brightness};

  if (name == "red")
  {
    // Physical strip: requested RED is on the second color channel.
    state.green = 255;
  }
  else if (name == "green")
  {
    // Physical strip: requested GREEN is on the first color channel.
    state.red = 255;
  }
  else if (name == "blue")
  {
    state.blue = 255;
  }
  else if (name == "warm")
  {
    state.warmWhite = 255;
  }
  else if (name == "cool")
  {
    state.coolWhite = 255;
  }
  else
  {
    server.send(400, "application/json", "{\"error\":\"Unknown LED preset\"}");
    return;
  }

  applyLedStateToTarget(target, state);

  recordTrigger("Website", "LED preset " + name, currentWebUser());
  sendStatus();
}


void handleLedPower()
{
  if (!requireWebLogin())
  {
    return;
  }

  int target = requestedLedTarget();
  bool turnOn = server.arg("on").toInt() == 1;

  if (turnOn)
  {
    systemPowerOn();
  }

  if (target == 0)
  {
    ledStates[0].on = turnOn;
    ledStates[1].on = turnOn;
    ledStates[2].on = turnOn;
  }
  else
  {
    ledStates[target - 1].on = turnOn;
  }

  applyLedStrips();

  recordTrigger("Website",
                turnOn ? "LED ON" : "LED OFF",
                currentWebUser());
  sendStatus();
}


// =====================================================
// Heating handlers
// =====================================================

void handleSmallHeaterToggle()
{
  if (!requireWebLogin())
  {
    return;
  }

  if (!systemOn)
  {
    systemPowerOn();
  }

  smallHeaterOn = !smallHeaterOn;
  applyHeatingOutputs();

  recordTrigger("Website",
                smallHeaterOn ? "Small heater ON" : "Small heater OFF",
                currentWebUser());
  sendStatus();
}


void handleHeaterFanToggle()
{
  if (!requireWebLogin())
  {
    return;
  }

  if (heaterFanOn)
  {
    // The fan cannot be stopped while either heater remains enabled.
    heater1On = false;
    heater2On = false;
    heaterFanOn = false;

    recordTrigger("Website",
                  "Heater fan OFF; heaters 1 and 2 forced OFF",
                  currentWebUser());
  }
  else
  {
    systemPowerOn();
    heaterFanOn = true;

    recordTrigger("Website", "Heater fan ON", currentWebUser());
  }

  applyHeatingOutputs();
  sendStatus();
}


void handleHeater1Toggle()
{
  if (!requireWebLogin())
  {
    return;
  }

  systemPowerOn();
  heater1On = !heater1On;

  if (heater1On)
  {
    heaterFanOn = true;
  }

  applyHeatingOutputs();

  recordTrigger("Website",
                heater1On ? "Heater 1 ON; fan ON" : "Heater 1 OFF",
                currentWebUser());
  sendStatus();
}


void handleHeater2Toggle()
{
  if (!requireWebLogin())
  {
    return;
  }

  systemPowerOn();
  heater2On = !heater2On;

  if (heater2On)
  {
    heaterFanOn = true;
  }

  applyHeatingOutputs();

  recordTrigger("Website",
                heater2On ? "Heater 2 ON; fan ON" : "Heater 2 OFF",
                currentWebUser());
  sendStatus();
}


// =====================================================
// WiFi functions
// =====================================================

void saveWiFiCredentials()
{
  prefs.begin("wifi", false);

  String savedSSID = prefs.getString("ssid", "");
  String savedPASS = prefs.getString("pass", "");

  if (savedSSID != String(WIFI_SSID) || savedPASS != String(WIFI_PASS))
  {
    Serial.println("Saving WiFi credentials to ESP32 flash...");

    prefs.putString("ssid", WIFI_SSID);
    prefs.putString("pass", WIFI_PASS);
  }
  else
  {
    Serial.println("WiFi credentials already saved.");
  }

  prefs.end();
}


void connectWiFi()
{
  prefs.begin("wifi", true);
  String ssid = prefs.getString("ssid", WIFI_SSID);
  String pass = prefs.getString("pass", WIFI_PASS);
  prefs.end();

  Serial.println();
  Serial.println("Starting WiFi...");
  Serial.print("SSID: ");
  Serial.println(ssid);

  WiFi.mode(WIFI_STA);
  WiFi.persistent(true);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);

  if (!WiFi.config(local_IP, gateway, subnet, primaryDNS, secondaryDNS))
  {
    Serial.println("Static IP config failed");
  }

  WiFi.begin(ssid.c_str(), pass.c_str());

  Serial.print("Connecting");

  unsigned long startAttemptTime = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - startAttemptTime < 20000)
  {
    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED)
  {
    Serial.println("WiFi connected.");
    Serial.print("Website: http://");
    Serial.println(WiFi.localIP());
  }
  else
  {
    Serial.println("WiFi connection failed.");
    Serial.println("Check SSID/password/router/static IP.");
  }
}


void checkWiFiReconnect()
{
  if (millis() - lastWiFiCheck < wifiCheckInterval)
  {
    return;
  }

  lastWiFiCheck = millis();

  if (WiFi.status() != WL_CONNECTED)
  {
    Serial.println("WiFi lost. Reconnecting...");

    WiFi.disconnect(false);
    delay(200);

    if (!WiFi.config(local_IP, gateway, subnet, primaryDNS, secondaryDNS))
    {
      Serial.println("Static IP reconfig failed");
    }

    WiFi.reconnect();
  }
}


// =====================================================
// Setup / Loop
// =====================================================

void setup()
{
  Serial.begin(115200);
  delay(2000);

  Serial.println();
  Serial.println("ESP32-S3 ALL HARDWARE TEST: Debug + DHT + Buttons + IR + 3x WS2805 Direct RMT + Mist + Small Heater + Blowers + DFPlayer + Heating");
  Serial.println("PCB buttons and IR remote now use shared control functions.");
  Serial.println("Fire level controls all 3 LEDs + mist + both blowers + sound.");

  // ---------- Debug LED ----------
  pinMode(DEBUG_LED_PIN, OUTPUT);
  digitalWrite(DEBUG_LED_PIN, LOW);

  // ---------- Start WS2805 LED strips with current RMT HAL ----------
  initWs2805();

  // Send one confirmed OFF frame to every initialized strip.
  applyLedStrips();

  // ---------- Start output pins ----------
  pinMode(BLOWER1_PIN, OUTPUT);
  pinMode(BLOWER2_PIN, OUTPUT);
  pinMode(MIST_PIN, OUTPUT);

  pinMode(SMALL_HEATER_PIN, OUTPUT);
  pinMode(HEATER_FAN_PIN, OUTPUT);
  pinMode(HEATER1_SSR_PIN, OUTPUT);
  pinMode(HEATER2_SSR_PIN, OUTPUT);

  // Safe boot state: all heater outputs OFF first.
  digitalWrite(SMALL_HEATER_PIN, SMALL_HEATER_OFF_LEVEL);
  digitalWrite(HEATER1_SSR_PIN, HEATER_SSR_OFF_LEVEL);
  digitalWrite(HEATER2_SSR_PIN, HEATER_SSR_OFF_LEVEL);
  digitalWrite(HEATER_FAN_PIN, HEATER_FAN_OFF_LEVEL);

  pinMode(BUTTON_PIN, INPUT);
  analogReadResolution(12);

  IrReceiver.begin(IR_RECEIVE_PIN, DISABLE_LED_FEEDBACK);
  Serial.println("IR receiver started on fixed PCB input");

  dht.begin();

  analogWrite(BLOWER1_PIN, 0);
  analogWrite(BLOWER2_PIN, 0);
  analogWrite(MIST_PIN, 0);
  applyHeatingOutputs();

  // ---------- Save WiFi credentials ----------
  saveWiFiCredentials();

  // ---------- Start DFPlayer ----------
  dfSerial.begin(9600, SERIAL_8N1, DFPLAYER_RX, DFPLAYER_TX);

  Serial.println("Starting DFPlayer...");

  if (!dfPlayer.begin(dfSerial, false, true))
  {
    Serial.println("DFPlayer did not reply, but continuing anyway...");
  }
  else
  {
    Serial.println("DFPlayer replied OK.");
  }

  delay(1000);

  dfPlayer.outputDevice(DFPLAYER_DEVICE_SD);
  delay(500);

  dfPlayer.volume(volumeLevel);
  delay(500);

  Serial.print("Volume set to ");
  Serial.println(volumeLevel);

  Serial.println("Playing song 1...");
  dfPlayer.play(1);
  isPlaying = true;

  // ---------- Start WiFi ----------
  connectWiFi();

  // ---------- Web routes ----------
  server.on("/", handleRoot);
  server.on("/status", handleStatus);

  server.on("/systemtoggle", handleSystemToggle);

  server.on("/timerset", handleTimerSet);
  server.on("/timerstop", handleTimerStop);

  server.on("/next", handleNext);
  server.on("/prev", handlePrev);
  server.on("/volup", handleVolUp);
  server.on("/voldown", handleVolDown);
  server.on("/play", handlePlay);
  server.on("/pause", handlePause);
  server.on("/wifireset", handleWifiReset);

  server.on("/blower1toggle", handleBlower1Toggle);
  server.on("/blower1up", handleBlower1Up);
  server.on("/blower1down", handleBlower1Down);

  server.on("/blower2toggle", handleBlower2Toggle);
  server.on("/blower2up", handleBlower2Up);
  server.on("/blower2down", handleBlower2Down);

  server.on("/misttoggle", handleMistToggle);
  server.on("/mistup", handleMistUp);
  server.on("/mistdown", handleMistDown);

  server.on("/ledset", handleLedSet);
  server.on("/ledpreset", handleLedPreset);
  server.on("/ledpower", handleLedPower);

  server.on("/smallheatertoggle", handleSmallHeaterToggle);
  server.on("/heaterfantoggle", handleHeaterFanToggle);
  server.on("/heater1toggle", handleHeater1Toggle);
  server.on("/heater2toggle", handleHeater2Toggle);

  server.begin();

  Serial.println("Web server started");

  // ---- App control (MQTT) — see mqtt_bridge.ino. Adds the Glow Fire app's
  //      MQTT interface on top of this firmware without changing hardware logic. ----
  mqttBridgeBegin();
}


void loop()
{
  updateDebugLed();
  server.handleClient();
  checkWiFiReconnect();
  checkTimer();
  checkButtonModule();
  checkIRRemote();
  readDHT();
  mqttBridgeLoop();   // service the app's MQTT connection + publish telemetry
  }
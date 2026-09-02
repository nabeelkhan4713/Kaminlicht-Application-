# Production firmware (ESP32-S3)

`glowfire_production_s3.ino` is the **dev firmware's approach** (BLE Wi-Fi provisioning +
MQTT + DHCP + mDNS) with the **production board's pins and hardware**.

It is the same "language" the app speaks — **no static IP, no web page, no web login, no
hardcoded Wi-Fi**. Setup is done from the app over Bluetooth, exactly like the dev board.

## ⚠️ Safety

This firmware switches **two 1000 W mains heaters**. Flash and test only on the proper
production board, with the person who handles it safely. Test one function at a time.

## Build

- Board: **ESP32S3 Dev Module** · Partition: **Huge APP (3MB No OTA)**
- Libraries (Library Manager): **PicoMQTT**, **ArduinoJson** (v7), **DFRobotDFPlayerMini**,
  **DHT sensor library**. (ESP32 BLE is built into the core.)
- Upload, open Serial Monitor at 115200.

## What it does

- Boot → load saved Wi-Fi → connect (DHCP) → MQTT broker on :9001. No Wi-Fi → Bluetooth setup.
- App controls: power, vapour (mist), flame lighting (all 3 WS2805 strips), audio (DFPlayer),
  heater on/off + stage 1/2, sleep timer. Publishes telemetry + a capability manifest every 2 s.
- **IR remote** (codes confirmed on the real remote): On/Off, Flame Up/Down (fire level 1-3 =
  brightness + mist + blowers, keeps the chosen colour), Volume (cycles 10/20/30).
- Temp/humidity/water level are sent **only when a real sensor responds** — never placeholders.
- Factory reset (app or BLE "RESET") wipes Wi-Fi and returns to Bluetooth setup.

## Pins

See the PIN MAP comment at the top of the `.ino`. **Match by the `IOxx` GPIO number**, not the
physical package-pin number (e.g. LED1 is physical pin 17 but GPIO **IO9**).

## Kept from the tested production code (hardware drivers only)

The **WS2805 LED driver** and the mist/blower/heater output drivers are kept from the tested
production firmware, because the production LEDs are **WS2805** (different chip from the dev
board's WS2812) and need their own driver. These are hardware drivers — none of the web /
static-IP / login code was carried over.

## Not yet exposed to the app (future, additive)

- The **2 blowers** and per-strip LED control (app drives all 3 strips together).
- **Physical PCB buttons** (wired on IO5; not handled yet — the IR remote IS handled).
- The **"fire level" scene** in the app (the remote uses it; the app doesn't expose it yet).
- **Remote volume up/down/mute** — current remote has one volume button (cycles up). Deferred
  to a new remote with dedicated buttons.

## Before shipping

- Consider adding multi-network Wi-Fi (currently one saved network, like the dev board).

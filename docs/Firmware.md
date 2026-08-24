# Firmware (the ESP32 code)

Back to [[Home]]. The code that runs on the fireplace: `firmware/glowfire_esp32/glowfire_esp32.ino`.

## What it does

- Boots, loads saved Wi-Fi (see [[Provisioning]]).
- If Wi-Fi found → connects, starts the MQTT broker, runs normally.
- If no Wi-Fi → starts Bluetooth setup mode.
- Runs an MQTT broker **on the ESP32 itself** (PicoMQTT over WebSocket, port 9001).
- Publishes telemetry every 2 seconds; responds to commands per the [[MQTT Contract]].

## Hardware currently wired (dev board)

| Pin | Use |
|---|---|
| GPIO2 | onboard status LED |
| GPIO25 | WS2812 LED strip (10 LEDs) |
| GPIO26 | Audio module RX (ESP32 receives) |
| GPIO27 | Audio module TX (ESP32 sends) |

> **Pin safety:** avoid GPIO0, 2, 12, 15 (strapping pins) and GPIO6–11 (flash). GPIO12 in
> particular caused a boot loop earlier — it sets flash voltage at boot. The audio pins were
> confirmed with the `firmware/audio_pin_finder` sketch, not guessed.

## Audio (DFPlayer / MP3-TF-16P)

Plays numbered MP3 files (`0001.mp3`, `0002.mp3`, …) from a microSD card. The firmware talks
to it over serial with a hand-written protocol (no library needed). App volume 0–10 maps to
the module's 0–30. Track count is read from the SD card at boot.

## Modules the firmware handles

- `system` (power, factory_reset), `lighting` (colour/brightness/power), `vapor`
  (power/intensity), `audio` (power/volume/track), `timer` (sleep).
- **Heater / vapour / fan hardware** live on the production board, not the dev board. The
  firmware tracks their state as variables (like a simulation) until wired.

## Uploading (Arduino IDE)

- Board: **ESP32 Dev Module**
- Partition Scheme: **Huge APP (3MB No OTA/1MB SPIFFS)** — required, or "sketch too big"
- Erase All Flash: **Enabled** to force Bluetooth setup mode; **Disabled** to keep saved Wi-Fi
- Serial Monitor: **115200**

## Diagnostic sketches

- `firmware/audio_pin_finder/` — finds which pins a DFPlayer is wired to. Keep it for the
  production board.

Related: [[MQTT Contract]] · [[Architecture]] · [[Setup and Testing]]

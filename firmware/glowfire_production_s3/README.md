# Production board firmware (ESP32-S3) + app control

This folder adds **app control (MQTT)** to the engineer's working production firmware,
**without changing its tested high-voltage logic**. His built-in web page keeps working too.

## ⚠️ Safety first

This firmware switches **two 1000 W mains heaters**. Only flash and test it on the proper
production board, with the person who handles that board safely. Test one function at a time.

## How to assemble the sketch

Arduino compiles every `.ino` in a folder together, so we keep his file and add ours beside it.

1. Create a folder, e.g. `glowfire_production_s3`.
2. Put the **engineer's firmware** in it, renamed to match the folder:
   `glowfire_production_s3.ino`  (this is the "main" file).
3. Put **`mqtt_bridge.ino`** (from this folder) in the same folder.
4. Add **two lines** to the main file:
   - in `setup()`, right after `connectWiFi();`  →  `mqttBridgeBegin();`
   - in `loop()`, anywhere  →  `mqttBridgeLoop();`
5. Install the **PicoMQTT** and **ArduinoJson (v7)** libraries (Library Manager).
6. Board: **ESP32S3 Dev Module** · Partition: **Huge APP (3MB No OTA)**.
7. Upload.

## What now works from the app

| App | Maps to (his function/state) |
|---|---|
| Power on/off | `systemPowerOn/Off()` |
| Vapour on/off + intensity | mist maker (`mistOn`, `mistLevel`, `applyMist`) |
| Flame colour / brightness / on | all 3 LED strips (R/G swap handled) |
| Audio on/off, volume, next/prev | `dfPlayer` (volume mapped 0–10 ⇄ 0–30) |
| Heater on/off + stage 1/2 | the two 1000 W heaters (+ safety fan) |
| Sleep timer | his timer (seconds → minutes) |

Telemetry (temp, humidity, states) is published to the app every 2 s. The web page + IR remote
+ PCB buttons all keep working alongside the app.

## Not yet exposed to the app (future)

- The **2 blowers** individually, **per-LED-strip** control, and the **"fire level" scene (1–3)**.
  These need new app controls — see `docs/Production Board Integration.md`.

## Security to fix before shipping 🔴

- Remove the hardcoded Wi-Fi credentials (`WIFI_SSID`/`WIFI_PASS`) — provision instead.
- Change the web login from `admin` / `0000` to a real password.

## Reaching the board from the app

This board uses static IP **192.168.188.64** and advertises **kl-glowfire.local**. Both are in
the app's host list (`src/config.ts`), and the board also reports its IP in the manifest.

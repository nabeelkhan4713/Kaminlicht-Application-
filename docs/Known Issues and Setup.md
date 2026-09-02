# Known Issues and Setup

Back to [[Home]]. Problems hit during development + how they were solved, and current caveats.
Keep this handy — most of these recur.

## Errors hit while flashing the ESP32 (and the fix)

| Error / symptom | Cause | Fix |
|---|---|---|
| Port list empty / "No such port" | Board disconnected or **COM number changed** (they re-number often, e.g. COM6→COM7) | Unplug/replug, then **Tools → Port** → pick the one labelled **"Serielles USB-Gerät"** (the USB one, not the Bluetooth ports) |
| `Could not open COMx, port is busy` | **Serial Monitor open** on that port | Close Serial Monitor, then upload |
| `This chip is ESP32-S3, not ESP32` | Wrong **Board** selected | **Tools → Board → ESP32S3 Dev Module** (not plain "ESP32") |
| `no upload port provided` | No **Port** selected | **Tools → Port → COMx** |
| Serial Monitor shows only `ESP-ROM:...` and nothing else | **USB CDC On Boot** disabled → `Serial.print` doesn't reach USB | **Tools → USB CDC On Boot → Enabled**, re-upload |
| `Sketch too big` / 92% then IR won't fit | Wrong **partition** (default is ~1.3MB) | **Tools → Partition Scheme → Huge APP (3MB No OTA)** |
| `IRremote.hpp: No such file` | Library not installed | Library Manager → install **IRremote** (Armin Joachimsmeyer) |
| CP2102 / driver "Error" (earlier dev board) | USB-serial driver missing | Install the chip's USB driver (CP210x / CH340) on Windows |
| Boot loop `LoadProhibited` (earlier dev board) | Wire on **GPIO12** (a strapping pin) | Don't use GPIO12 for a UART line — moved audio to GPIO26/27 on the dev board |

## Required Arduino settings for the production firmware

- **Board:** ESP32S3 Dev Module
- **Partition Scheme:** Huge APP (3MB No OTA)  ← required
- **USB CDC On Boot:** Enabled  ← required for Serial Monitor
- **Port:** the "Serielles USB-Gerät" COM port
- **Libraries:** PicoMQTT, ArduinoJson (v7), DFRobotDFPlayerMini, DHT sensor library, IRremote

## Bugs found and fixed

- **Remote flame button reset colour to orange** — the fire-level scene forced orange on every
  press, wiping the app-chosen colour. Fixed: the remote now changes only intensity
  (brightness + mist + blowers) and keeps the colour.
- **Fake temperature / humidity** — the app was showing hardcoded 20°C / 45% as if real.
  Removed: those (plus water level, thermostat target) are sent only when a real sensor
  responds; otherwise the app shows "—".
- **Provisioning stuck / stale "connected"** — fixed with freshness checks + escape hatches
  (see [[Provisioning]]).

## Current caveats (not bugs — things to know)

- **No temperature/humidity sensor fitted** → the app shows "—" for those. Fit a **DHT11** on
  GPIO IO4 to get real readings (no code change needed).
- **No water-level sensor** → water level shows "—".
- **Old iPad (iOS 12.5.8) cannot run the app** — too old. Use the iPhone 17 Pro or a modern
  iPad (iOS 15.1+).
- **Remote has one volume button** → it cycles 10→20→30 (no down/mute yet). Deferred to a new
  remote — see [[Status and Roadmap]].
- **All units share one serial number** (`KL-2026-A3F92C`) — fine for one unit; production
  needs a unique serial per fireplace.
- **Heaters are high voltage** — test deliberately, one at a time, with someone who handles the
  mains side.

## Security to fix before shipping

- The engineer's original sample (`nabeel_test1_2.ino`) has a web login `admin`/`0000` and
  hardcoded Wi-Fi. The **production firmware removed the web server entirely**, so that's not in
  the shipped firmware — but don't reintroduce it.
- Give each unit a **unique serial**; consider a real web password only if the web page is ever
  re-added.

Related: [[Firmware]] · [[Setup and Testing]] · [[Status and Roadmap]]

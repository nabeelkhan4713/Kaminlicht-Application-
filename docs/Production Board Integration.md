# Production Board Integration (ESP32-S3)

Back to [[Home]]. How the working production firmware and the app get connected.

## Situation

- The **engineer's firmware** already runs the real ESP32-S3 board with all high-voltage
  hardware (heaters, blowers, mist, LED strips, audio, sensor, IR, buttons). It is controlled
  today by a **built-in web page** (HTTP), not MQTT.
- The **app** talks [[MQTT Contract|MQTT]] and is tested on Android + iOS.
- Goal: the app controls the production board. Decision made: **MQTT is the long-term
  strategy**; the web page stays only as a local technician/diagnostic tool.

## Approach (lowest risk)

**Add MQTT to the engineer's firmware** — do NOT rewrite his hardware logic. His existing
functions (`applyAllPreset`, `handleBlower1Toggle`, `dfPlayer.volume`, …) stay exactly as
tested on the high-voltage board. The MQTT layer just **calls those functions**. His web page
keeps working. The app barely changes on the transport side; it gains controls for hardware
it didn't model before.

> Safety: all high-voltage testing stays with the engineer on the production board.

## Feature mapping — app ⇄ production hardware

| App (MQTT command) | Engineer's function / variable | Notes |
|---|---|---|
| `system` / `power` true/false | `systemPowerOn()` / `systemPowerOff()` | master power |
| `vapor` / `power` | `mistOn` + `applyMist()` | "mist maker" = vapour |
| `vapor` / `set_intensity` 1–6 | `mistLevel` 0–5 (`applyMist()`) | map app 1–6 → device 0–5 |
| `lighting` / `set_color` {r,g,b} | `ledStates[].red/green/blue` + `applyLedStrips()` | see LED note below |
| `lighting` / `set_brightness` 0–100 | `ledStates[].brightnessPercent` | |
| `lighting` / `power` | `ledStates[].on` | |
| `audio` / `power` | `dfPlayer.start()` / `pause()` | |
| `audio` / `set_volume` 0–10 | `dfPlayer.volume()` 0–30 | app maps 0–10 → 0–30 |
| `audio` / `track` next/prev | `dfPlayer.next()` / `previous()` | |
| `climate` / `power` | `heater1On` / `smallHeaterOn` (+ safety fan) | decide which heater |
| `timer` / `set_sleep` seconds | `timerActive` / `timerEndMillis` | device uses minutes; convert |

### New things the hardware has that the app must add

| Hardware | Suggested app control |
|---|---|
| **2 blowers** (speed 0–255) | New blower controls, or fold into a "fan"/scene control |
| **3 LED strips** (independent) | Extend lighting to 3 zones, or "all strips" + per-strip |
| **Small heater + two 1000W heaters + fan** | Expand Climate: heater stages map to the 1000W units; fan is automatic (safety interlock in firmware) |
| **"Fire level" scene 1–3** | A "scene"/preset control that sets LEDs+blowers+mist+audio together |
| **DHT temp/humidity** | Already shown on Home/Climate |

### LED colour note

The engineer's strip has **red and green physically swapped**, and it's WS2805 (RGB + warm
white + cool white), not WS2812. His firmware already compensates for the R/G swap — so the
app keeps sending normal RGB and the firmware handles the mapping. White channels are extra
and optional for the app.

## What each side does

**Engineer (firmware):**
1. Add an MQTT client/broker speaking the [[MQTT Contract]] (topics `kl/{sn}/*`, port 9001 WS).
2. On each incoming command, call the matching existing function (table above).
3. Publish telemetry every 2 s (his `statusJson()` already has all the values — reshape it to
   the app's telemetry format).
4. Publish a manifest advertising the real capabilities (3 LED zones, blowers, heaters, audio).
5. Add BLE Wi-Fi provisioning (reuse the pattern from the dev firmware) OR keep hardcoded Wi-Fi
   for now — decide before customer units ship. **Remove hardcoded Wi-Fi credentials + change
   the `admin`/`0000` web password before release.**

**App (this repo, with Claude):**
1. Extend the model to match real hardware (blowers, 3 LED zones, multiple heaters, scenes).
2. Update [[MQTT Contract]] + Zod schemas + screens accordingly.
3. Keep everything gated on the manifest so the dev board and production board both work.

## Security to fix before release 🔴

- Hardcoded Wi-Fi credentials in the firmware — must be removed/provisioned.
- Web page login `admin` / `0000` — must be a real password (it can switch on 1000W heaters).

Related: [[MQTT Contract]] · [[Firmware]] · [[Status and Roadmap]]

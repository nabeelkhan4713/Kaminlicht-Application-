# MQTT Contract

Back to [[Home]]. This is the **most important note** — it's the agreement the app and the
[[Firmware]] both follow. If the engineer's firmware keeps this identical, it works with the
app with no changes.

## Topics

All topics start with `kl/{serialNumber}/`. Current serial: `KL-2026-A3F92C`.

| Topic | Direction | Purpose |
|---|---|---|
| `kl/{sn}/cmd` | app → fireplace | commands (turn on, set volume, …) |
| `kl/{sn}/telemetry` | fireplace → app | live state, sent every 2 seconds |
| `kl/{sn}/manifest` | fireplace → app | what hardware this unit has |
| `kl/{sn}/ack` | fireplace → app | "command received", by message id |

Transport: **MQTT over WebSocket, port 9001** (React Native can't do raw MQTT, so WebSocket).

## Command format (app → fireplace)

Every command is a small JSON message:

```json
{ "module": "audio", "action": "set_volume", "value": 7, "msgId": "uuid-here" }
```

- `module` — which subsystem: `system`, `vapor`, `lighting`, `climate`, `audio`, `timer`
- `action` — what to do
- `value` — the value (number, boolean, or object)
- `msgId` — unique id so the fireplace can confirm it with an `ack`

## The commands the app can send

| Module | Action | Value | Meaning |
|---|---|---|---|
| system | power | true/false | main power |
| system | factory_reset | null | forget Wi-Fi, reboot to setup |
| vapor | power | true/false | flame/vapour on/off |
| vapor | set_intensity | 1–6 | vapour strength |
| lighting | set_color | {r,g,b} | flame colour |
| lighting | set_brightness | 0–100 | flame brightness |
| lighting | power | true/false | flame light on/off |
| climate | power | true/false | heater on/off |
| climate | set_thermostat | 16–26 | target °C |
| climate | set_stage | 1 or 2 | heater power stage |
| audio | power | true/false | sound on/off |
| audio | set_volume | 0–10 | volume (app maps to 0–30 on DFPlayer) |
| audio | track | "next"/"prev" | change track |
| timer | set_sleep | 0–28800 | sleep timer seconds (0 = cancel) |

## Telemetry (fireplace → app, every 2 seconds)

Reports live state: power, vapour (on/intensity/water level), lighting (colour/brightness),
audio (on/volume/track), climate (temp/humidity), timer, Wi-Fi signal. The app validates
this with Zod before showing it — a malformed message is ignored, never trusted.

## Manifest (fireplace → app)

Tells the app **what hardware exists**, so it shows only the relevant tabs. e.g. no heater →
no Climate tab. Also reports the fireplace's `mdnsHostname` and current `ip` so the app can
reliably reconnect (see [[Provisioning]]).

## For the engineer's firmware

If a different `.ino` keeps **these topics, this command format, and these field names**, it
drops into the app with zero changes. Change the names and the matching tabs go silent. See
[[Firmware]] and [[Status and Roadmap]].

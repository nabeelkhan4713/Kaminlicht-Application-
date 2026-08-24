# Features

Back to [[Home]]. Every screen in the app and what it does. Tabs appear only if the
[[MQTT Contract|manifest]] says the hardware exists.

## Home tab ✅

The main control screen.

- **Status card** — connection, power, water level, temperature, humidity, Wi-Fi signal, sleep timer
- **Power** — big on/off button
- **Sleep timer** — set hours/minutes/seconds; live countdown; auto-off when it expires
- **Vapour** — flame effect on/off + intensity 1–6 (blocked when the water tank is empty)

## Ambience tab ✅

Flame lighting control (the WS2812 LED strip).

- **Colour wheel** — pick any RGB colour
- **Brightness** — 6-step slider
- **Presets** — save and reuse favourite colours

## Audio tab ✅

Sound module (DFPlayer / MP3-TF-16P playing from an SD card).

- **On/off** + current track name
- **Next / Previous** track
- **Volume** — bar slider (app 0–10, mapped to the module's 0–30) + Mute

## Climate tab 🔴 (placeholder — not built yet)

Will control the heater and exhaust fan. Only appears when the manifest reports a heater or
fan. Command builders already exist; the screen is still a scaffold. See [[Status and Roadmap]].

## Settings tab ✅

- Device info (serial, firmware version, variant)
- **Set up device (Bluetooth)** — opens [[Provisioning]] for a new fireplace / new Wi-Fi
- **Factory reset Wi-Fi setup** — makes the fireplace forget Wi-Fi and return to Bluetooth setup

## First-run setup ✅

On first launch (no fireplace paired) the app opens [[Provisioning]] instead of the tabs.
Escape hatches ("Use this fireplace" / "Skip setup") prevent getting stuck if the fireplace
is already on Wi-Fi.

Related: [[Provisioning]] · [[MQTT Contract]] · [[Architecture]]

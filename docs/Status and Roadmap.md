# Status and Roadmap

Back to [[Home]]. Full project state. Updated 2026-09-02.

## ✅ Done

### App (React Native, Android + iOS)
- **Android** build + run on tablet ✅
- **iOS** built via EAS cloud, installed + running on **iPhone 17 Pro** ✅
- **Provisioning → pairing → navigation gate**: BLE setup saves the device, app remembers it,
  first-run shows setup / paired shows tabs. Escape hatches ("Use this fireplace", "Skip setup").
- **Home**: power, vapour on/off + intensity, full sleep timer with countdown
- **Ambience**: RGB colour wheel, 6-step brightness, saved presets
- **Audio**: on/off, next/previous track, volume bar, mute
- **Climate**: heater on/off, stage 1 (1000W) / stage 2 (2000W), thermostat (gated on capability)
- **Settings**: device info, Bluetooth setup, factory reset
- Fireplace reports its own IP; app prefers it over hardcoded hosts
- **Placeholder sensor values removed** — temp/humidity/water level shown only when a real
  sensor responds; otherwise the app shows "—" (never a fake number)

### Production firmware (`firmware/glowfire_production_s3/`)
- Rebuilt as the **dev firmware's approach** (BLE provisioning + MQTT + DHCP + mDNS) with the
  **production board's pins and hardware**. No static IP, no web page, no web login, no
  hardcoded Wi-Fi.
- Hardware drivers kept from the tested production code: **WS2805** LED strips ×3, mist,
  blowers, small heater + two 1000W heaters + fan, DFPlayer audio, DHT.
- **All 16 pins verified** against the ESP32-S3 schematic (match by the `IOxx` number).
- **IR remote** added (codes confirmed on the real remote):
  - **On/Off** → power
  - **Flame Up/Down** → fire level 1→3 (brightness + mist + blowers; keeps the chosen colour)
  - **Volume** → cycles 10 → 20 → 30
- **Tested on the real production board:** boot, all 3 LED strips, audio, sleep timer,
  brightness + presets, and the remote (power, flame up/down, volume) ✅

### Project hygiene
- Git repo + **GitHub** (`Kaminlicht-Application`), commit after each step
- **Obsidian docs vault** under `docs/`
- Hardcoded Wi-Fi credentials scrubbed from committed firmware

## 🔴 Remaining

| Area | Note |
|---|---|
| **Vapour (mist)** on hardware | Not yet tested on the board |
| **Heater** on hardware | Not tested — high voltage, needs safe setup |
| **DHT temp/humidity sensor** | Not physically fitted → app shows "—" until one is added |
| **Water-level sensor** | Not fitted → app shows "—" |
| **Blowers in the app** | Firmware runs them (via fire scene); no app control yet |
| **Per-strip LED control** | App drives all 3 strips together |
| **iOS full validation** | Builds + runs; full BLE/MQTT test pass still to do |
| **Unique serial per device** | All units currently share `KL-2026-A3F92C` — production needs unique serials |
| **Release build / store prep** | Not started |
| **UI/UX redesign** | Deferred on purpose (functionality first) |

## ⏭️ Skipped for now (deliberate)

- **Remote volume up/down/mute** — current remote has ONE volume button (cycles up only).
  Deferred to a **new remote with dedicated buttons** (volume +/−, mute, etc.). Re-run the IR
  discovery process when it arrives.
- **Physical PCB buttons** — wired (IO5) but not handled in firmware yet
- **"Fire scene" control in the app** — the remote uses it; the app doesn't expose it
- **Thermostat control** — no thermostat hardware (heaters are on/off + stage)
- **Multi-network Wi-Fi** — one saved network at a time (like the dev board)

## ⚠️ Known issues / caveats

See [[Known Issues and Setup]] for the full list of errors hit during setup and how they were
fixed, plus current caveats (fake-value removal, old iPad too old to run the app, etc.).

## Suggested next steps

1. Test **vapour (mist)** on the board (safe)
2. Test **heater** — carefully, high voltage, one function at a time
3. Decide on **temp/humidity**: fit a DHT sensor, or leave "—"
4. When the **new remote** arrives: capture codes, wire volume +/−/mute
5. Add **blowers** + **per-strip LEDs** to the app (parity with the old web UI)
6. **Unique serial per unit** before making more than one fireplace
7. iOS full test pass → release build

Related: [[Home]] · [[Features]] · [[Firmware]] · [[Production Board Integration]] · [[Known Issues and Setup]]

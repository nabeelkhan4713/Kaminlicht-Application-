# Setup and Testing

Back to [[Home]]. How to build, flash, and test.

## Flash the firmware

1. Open `firmware/glowfire_esp32/glowfire_esp32.ino` in Arduino IDE.
2. Tools → Board: **ESP32 Dev Module**; Partition Scheme: **Huge APP**; Port: your COM port.
3. **Erase All Flash**: `Disabled` (keep Wi-Fi) or `Enabled` (force Bluetooth setup).
4. Upload. Serial Monitor at **115200**. Look for:
   - `[audio] DFPlayer ready on RX=26 TX=27, N track(s)`
   - `Saved Wi-Fi found ...` (normal use) or `=== SETUP MODE ===` (Bluetooth setup)

## Run the app on Android

```
npx expo run:android
```
Or with Metro already running, USB device:
```
adb reverse tcp:8081 tcp:8081
```
Press `r` in Metro to reload. Press `s` if it says "Using Expo Go" (must be development build).

## Run the app on iOS (iPhone/iPad, iOS 15.1+)

Built in the cloud with EAS (no Xcode/Mac needed):
```
npx eas build --platform ios --profile preview
```
- Log in with the company Apple Developer account when asked.
- Register the test device (Developer Portal import, using its UDID).
- Install the finished build from the link on the device.
- First run: enable **Developer Mode** (Settings → Privacy & Security) and **Trust** the
  developer profile (Settings → General → VPN & Device Management).

Status: built and installed successfully on an iPhone 17 Pro. iOS asks for **Bluetooth** and
**Local Network** permission on first use — both must be allowed.

## Test checklist (do one function at a time)

1. App boots → correct screen (setup if unpaired, tabs if paired).
2. Provisioning: scan → send Wi-Fi → fireplace reconnects → app shows tabs. See [[Provisioning]].
3. Home: power, vapour, sleep timer.
4. Ambience: colour, brightness, presets.
5. Audio: on/off, volume, next/previous → real sound.
6. Settings: factory reset → returns to Bluetooth setup.

## Safety

Test high-voltage parts (heater, vapour) **only on the engineer's production board**, and
one function at a time. Never power mains-voltage hardware on the dev bench yourself.

Related: [[Firmware]] · [[Features]] · [[Status and Roadmap]]

# Glow Fire — Project Home

The **Glow Fire Control App** is a mobile app (Android + iOS) that controls a Kaminlicht
water-vapour fireplace. Setup happens once over **Bluetooth**; everyday control runs over
**Wi-Fi**. The fireplace itself is an **ESP32** microcontroller.

> This is the documentation vault. Open this folder in Obsidian to browse it.
> Links in `[[double brackets]]` jump between notes.

## Start here

- [[Architecture]] — how the phone, the fireplace, and Wi-Fi fit together
- [[Features]] — every screen and what it does
- [[MQTT Contract]] — the "language" the app and firmware speak (the most important note)
- [[Firmware]] — what runs on the ESP32
- [[Setup and Testing]] — how to build, flash, and test on Android and iOS
- [[Status and Roadmap]] — what's done, what's left

## The one-paragraph summary

The phone talks to the fireplace using **MQTT messages** over Wi-Fi. The app never knows
or cares about wiring or pins — it only sends messages like "turn power on" or "set volume
to 7". The firmware on the ESP32 receives those messages and drives the real hardware
(lights, speaker, and — on the production board — heater and vapour). Because both sides
agree on the same [[MQTT Contract]], any board runs with the same app.

## Quick facts

| Thing | Value |
|---|---|
| App framework | React Native (Expo SDK 56) |
| Firmware | ESP32 (Arduino), `glowfire_esp32.ino` |
| Setup transport | Bluetooth (BLE) |
| Control transport | Wi-Fi → MQTT over WebSocket, port 9001 |
| Device serial | `KL-2026-A3F92C` |
| Platforms | Android ✅, iOS ✅ (tested on iPhone 17 Pro) |

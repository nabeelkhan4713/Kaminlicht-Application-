# Architecture

Back to [[Home]].

## The big picture

```
   ┌─────────────┐   Bluetooth (setup only)   ┌──────────────────┐
   │   Phone     │ ─────────────────────────▶ │   ESP32          │
   │  (the app)  │                            │  (the fireplace) │
   │             │ ◀─────────────────────────▶│                  │
   └─────────────┘   Wi-Fi + MQTT (control)   └──────────────────┘
                                                 │ drives
                                                 ▼
                                    Lights · Speaker · (Heater/Vapour on big board)
```

## Two phases

1. **Setup (once, over Bluetooth)** — the phone sends the home Wi-Fi name + password to the
   fireplace. The fireplace saves them, reboots, and joins Wi-Fi. See [[Provisioning]].
2. **Control (every day, over Wi-Fi)** — the phone and fireplace talk using [[MQTT Contract|MQTT]].

## Why Bluetooth AND Wi-Fi?

A brand-new fireplace has no Wi-Fi details yet, so it can't be on the network. Bluetooth is
used **once** to hand over the Wi-Fi credentials. After that, everything runs over Wi-Fi
because it has more range and doesn't need the phone nearby.

> The ESP32 shares one radio between Bluetooth and Wi-Fi, so it does **one at a time**:
> Bluetooth for setup, then it reboots and switches to Wi-Fi for normal use.

## The golden rule: the app doesn't know about hardware

The app only sends **messages** ([[MQTT Contract]]). It has no idea which pin drives the
speaker or whether the heater is on a relay. That's the firmware's job. This is why:

- The same app works on the small dev board **and** the big production board.
- The engineer can change pins/hardware freely — as long as the messages stay the same.

## App internals (for developers)

- **React Native + Expo** — one codebase runs on Android and iOS.
- **`DeviceContext`** — the only bridge between the network layer and the screens. Screens
  read state through hooks; they never touch MQTT directly.
- **`MQTTService`** — the only file allowed to talk to the MQTT library.
- **Zod schemas** — every message from the fireplace is validated before the app trusts it.
- **`DeviceSessionContext`** — remembers which fireplace the app is paired with.

Related: [[Firmware]] · [[MQTT Contract]] · [[Features]]

# Status and Roadmap

Back to [[Home]]. What's done and what's left. Updated 2026-08.

## Done ✅

| Area | Notes |
|---|---|
| Android build | Working |
| iOS build + install | Built via EAS, runs on iPhone 17 Pro |
| Provisioning + pairing | Bluetooth setup → saves Wi-Fi → app pairs and remembers device |
| Home screen | Power, vapour, sleep timer |
| Ambience screen | Colour wheel, brightness, presets |
| **Audio** | App + firmware, real speaker (DFPlayer) working |
| Settings + factory reset | Working |
| Location independence | Fireplace reports its own IP; no hardcoded addresses |

## Remaining 🔴

| Priority | Task | Blocked by |
|---|---|---|
| 1 | **Climate tab** (heater stage, thermostat, fan) — UI | Nothing — ready to build |
| 2 | **Settings**: hotelschaltung + schedules | Nothing |
| 3 | **Multi-network Wi-Fi** (remember several networks) | Small firmware change |
| 4 | **Beta polish** (loading/error states) | Nothing |
| 5 | **Real PCB integration** (heater, vapour, sensors) | Engineer's big board + pin list |
| 6 | **UI/UX redesign** | Designer (deferred on purpose) |
| 7 | **Release build** | Everything above |

## Key decisions / notes

- **Design is deliberately deferred** — functionality and speed first, visuals later. The
  app is built so a redesign won't touch the logic.
- **High-voltage board stays with the engineer** — you develop on the low-voltage dev board;
  the same code runs on both because of the [[MQTT Contract]].
- **Engineer's firmware** — when received, review it against the [[MQTT Contract]] before use;
  align names if his (AI-generated) code invented different ones.
- **Not in git yet** — the `src/` folder should be committed so there's version history.

Related: [[Home]] · [[Features]] · [[MQTT Contract]]

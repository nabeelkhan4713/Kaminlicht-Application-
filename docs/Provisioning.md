# Provisioning (Bluetooth setup)

Back to [[Home]]. How a fireplace gets onto Wi-Fi the first time.

## The flow

1. App scans over **Bluetooth** for a fireplace advertising `KL-GlowFire-Setup`.
2. User picks their Wi-Fi network and enters the password.
3. App sends the credentials to the fireplace over Bluetooth.
4. Fireplace **saves** them to its flash memory, then **reboots**.
5. On reboot it finds saved Wi-Fi, joins the network, turns Bluetooth off, starts [[MQTT Contract|MQTT]].
6. App detects the fireplace online and **pairs** with it (saves its serial + IP).
7. App switches from the setup screen to the normal tabs.

## Important behaviours

- **A fireplace with saved Wi-Fi does NOT advertise Bluetooth.** So if setup finds nothing,
  the fireplace is probably already connected — that's why the app offers "Use this fireplace".
- **Credentials are never stored in the app or in code** — only in the fireplace's own flash.
- To set up a **new Wi-Fi network**, use **Factory reset** first (Settings), which wipes the
  saved Wi-Fi and re-enables Bluetooth setup.

## Why setup + reboot (not connect while Bluetooth is live)

The ESP32 shares one radio. Joining Wi-Fi while Bluetooth is still connected is unreliable, so
the firmware **saves then reboots** and connects with Bluetooth off. See [[Architecture]].

## Known limitation

The fireplace remembers **one** Wi-Fi network at a time (`WIFI_SLOT_COUNT = 1`). Moving it
between two locations needs a factory reset each time. Multi-network is a possible future
change — see [[Status and Roadmap]].

Related: [[Features]] · [[Firmware]]

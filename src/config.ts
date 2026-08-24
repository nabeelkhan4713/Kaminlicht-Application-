/**
 * Device connection target(s).
 *
 * The app tries each host in order until one answers (mqtt.js round-robins on
 * reconnect), so you don't depend on a single hardcoded IP. Put the device's
 * mDNS name first (works on any subnet if Android resolves it), then known IPs
 * per location, then the simulator.
 *
 *   - 'kl-glowfire.local' → mDNS name from the firmware (survives DHCP/IP changes)
 *   - '192.168.x.x'       → a device IP for a specific location (read from Serial Monitor)
 *   - '10.0.2.2'          → PC simulator, from the Android emulator
 *
 * serialNumber MUST match SERIAL_NO in the ESP32 firmware (topics are kl/{serialNumber}/*).
 */
export const DEVICE = {
  // 192.168.188.64 is the production ESP32-S3 board's static IP (firmware/glowfire_production_s3).
  hosts: ['kl-glowfire.local', '192.168.188.94', '192.168.188.64', '192.168.178.43', '192.168.188.63', '10.0.2.2'],
  serialNumber: 'KL-2026-A3F92C',
  wsPort: 9001,
};


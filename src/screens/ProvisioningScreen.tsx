/**
 * ProvisioningScreen - first-time Bluetooth setup UI.
 * Keeps BLE provisioning simple for users while preserving technical details for testing.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { Device } from 'react-native-ble-plx';
import { useConnection, useLastTelemetryAt, useManifest } from '../contexts/DeviceContext';
import { useDeviceSession } from '../contexts/DeviceSessionContext';
import { useDeviceTelemetry } from '../hooks/useDeviceTelemetry';
import { bleService, type WifiNetwork } from '../services/BLEService';
import { DEVICE } from '../config';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Telemetry arrives every 2s, so anything older than this means the link is gone. */
const TELEMETRY_FRESH_MS = 8000;

/**
 * How long to wait for the fireplace after sending credentials. Covers reboot, boot,
 * Wi-Fi scan, joining the network, broker start, and the app finding it across its
 * candidate hosts — measured well past 25s in practice.
 */
const PROVISION_WAIT_MS = 75000;

type SetupStage =
  | 'idle'
  | 'scanning'
  | 'deviceFound'
  | 'connectingBle'
  | 'sendingWifi'
  | 'restarting'
  | 'waitingWifi'
  | 'complete'
  | 'error';

const stageText: Record<SetupStage, string> = {
  idle: 'Ready to set up',
  scanning: 'Scanning for fireplace',
  deviceFound: 'Fireplace found',
  connectingBle: 'Connecting over Bluetooth',
  sendingWifi: 'Sending Wi-Fi details',
  restarting: 'Device is restarting',
  waitingWifi: 'Waiting for Wi-Fi connection',
  complete: 'Setup complete',
  error: 'Setup needs attention',
};

interface ProvisioningScreenProps {
  /** Omitted during first-run setup — there is nothing to close back to. */
  onClose?: () => void;
  initialLog?: string[];
  autoScanDelayMs?: number;
}

export default function ProvisioningScreen({
  onClose,
  initialLog = [],
  autoScanDelayMs,
}: ProvisioningScreenProps) {
  const online = useConnection();
  const manifest = useManifest();
  const { saveDevice } = useDeviceSession();
  const telemetryTs = useDeviceTelemetry((t) => t?.ts ?? null);
  const lastTelemetryAt = useLastTelemetryAt();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [devices, setDevices] = useState<Device[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selected, setSelected] = useState<Device | null>(null);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [wifiNetworks, setWifiNetworks] = useState<WifiNetwork[]>([]);
  const [wifiScanBusy, setWifiScanBusy] = useState(false);
  const [manualSsid, setManualSsid] = useState(false);
  const [log, setLog] = useState<string[]>(initialLog);
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [stage, setStage] = useState<SetupStage>(initialLog.length > 0 ? 'restarting' : 'idle');
  const [userMessage, setUserMessage] = useState(
    initialLog.length > 0
      ? 'Waiting for the fireplace to restart in Bluetooth setup mode.'
      : 'Scan for your fireplace, then send the Wi-Fi name and password.',
  );
  const waitingForMqttRef = useRef(false);
  const mqttConfirmedRef = useRef(false);
  const pairedIdentityRef = useRef<string | null>(null);

  const addLog = (line: string) => setLog((prev) => [...prev, line]);

  /**
   * Reachable over Wi-Fi *right now*, and not mid-way through a BLE setup attempt.
   *
   * Freshness matters: after a factory reset the fireplace reboots into Bluetooth mode
   * and simply stops publishing, but MQTT keepalive means the client can take up to a
   * minute to notice. Requiring a recent payload (telemetry arrives every 2s) makes the
   * card disappear within seconds instead of claiming the device is still connected.
   */
  const telemetryFresh = lastTelemetryAt != null && nowMs - lastTelemetryAt < TELEMETRY_FRESH_MS;
  const alreadyConnected =
    online &&
    telemetryFresh &&
    !busy &&
    stage !== 'complete' &&
    // Suppressed only once a setup-mode fireplace has actually been found: such a device
    // has no saved Wi-Fi, so the two messages would contradict each other. While a scan
    // is merely running, keeping the card visible is what tells the user why the scan
    // finds nothing — their fireplace is already on Wi-Fi and not advertising.
    devices.length === 0;

  // A failed setup attempt leaves an error banner behind. If the fireplace turns out to
  // be reachable after all, that banner contradicts the "already connected" card — so
  // clear it rather than showing the user two opposite messages at once.
  useEffect(() => {
    if (!alreadyConnected || stage !== 'error') return;
    setStage('idle');
    setUserMessage('Your fireplace is connected and ready to use.');
  }, [alreadyConnected, stage]);

  useEffect(() => {
    return () => bleService.stopScan();
  }, []);

  // Drives the telemetry-freshness check below; without a tick, a device that goes
  // silent would keep looking connected until some other state change re-rendered.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!waitingForMqttRef.current || mqttConfirmedRef.current) return;
    if (!online || telemetryTs == null) return;

    mqttConfirmedRef.current = true;
    setBusy(false);
    setStage('complete');
    setUserMessage('The fireplace is connected over Wi-Fi and ready to use.');
    addLog('Wi-Fi/MQTT connection confirmed.');
  }, [online, telemetryTs]);

  /**
   * Persist the pairing using the identity the device itself reported, falling back to
   * the build-time defaults when the manifest has not arrived yet. Idempotent: re-saves
   * only when the identity actually changes. Wi-Fi credentials are never persisted
   * (NFR-S-001).
   */
  const persistPairing = useCallback(async () => {
    const serialNumber = manifest?.serialNumber ?? DEVICE.serialNumber;
    const mdns = manifest?.network?.mdnsHostname;
    const host = mdns ? (mdns.endsWith('.local') ? mdns : `${mdns}.local`) : DEVICE.hosts[0];
    const ip = manifest?.network?.ip;

    const identity = `${serialNumber}@${host}@${ip ?? '-'}`;
    if (pairedIdentityRef.current === identity) return;
    pairedIdentityRef.current = identity;

    try {
      await saveDevice({ serialNumber, host, ip });
      addLog(`Paired with ${serialNumber} at ${host}${ip ? ` (${ip})` : ''}.`);
    } catch (e: unknown) {
      pairedIdentityRef.current = null; // let a later attempt retry
      addLog(`Could not save device: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [manifest, saveDevice]);

  /**
   * Pair once BLE setup has confirmed the device is online. Telemetry can arrive before
   * the manifest, so this re-runs on manifest changes to correct the stored identity.
   */
  useEffect(() => {
    if (!mqttConfirmedRef.current) return;
    void persistPairing();
  }, [stage, persistPairing]);

  /**
   * Wait for the fireplace to come back on Wi-Fi after provisioning.
   *
   * The full sequence is slow: reboot delay, boot, a Wi-Fi scan, joining the network,
   * starting the broker, then the app finding it across its candidate hosts. That
   * regularly runs past half a minute, so declaring failure early produced an error
   * banner immediately followed by a successful connection.
   */
  useEffect(() => {
    if (stage !== 'waitingWifi') return;

    const reassure = setTimeout(() => {
      if (mqttConfirmedRef.current) return;
      setUserMessage('Still connecting. The fireplace restarts and joins Wi-Fi - this can take up to a minute.');
    }, 20000);

    const giveUp = setTimeout(() => {
      if (mqttConfirmedRef.current) return;
      waitingForMqttRef.current = false;
      setBusy(false);
      setSelected(null);
      setWifiNetworks([]);
      setSsid('');
      setPassword('');
      setStage('error');
      setUserMessage('Could not connect to Wi-Fi. Check the password and signal strength, then try again.');
      addLog('Wi-Fi connection was not confirmed. Waiting for user to retry setup.');
    }, PROVISION_WAIT_MS);

    return () => {
      clearTimeout(reassure);
      clearTimeout(giveUp);
    };
  }, [stage]);

  const startScan = async () => {
    setDevices([]);
    setStage('scanning');
    setUserMessage('Looking for KL-GlowFire-Setup nearby.');
    const ok = await bleService.requestPermissions();
    if (!ok) {
      setStage('error');
      setUserMessage('Bluetooth permission is required to set up the fireplace.');
      addLog('Bluetooth permission denied.');
      return;
    }
    setScanning(true);
    addLog('Scanning for "KL-GlowFire-Setup"...');
    bleService.scan(
      (d) => {
        setStage('deviceFound');
        setUserMessage('Select the fireplace to load nearby Wi-Fi networks.');
        setDevices((prev) => (prev.find((x) => x.id === d.id) ? prev : [...prev, d]));
      },
      (message) => {
        setStage('error');
        setUserMessage('Bluetooth scan could not start. Please try again.');
        addLog(`Bluetooth scan error: ${message}`);
      },
    );
    setTimeout(() => {
      bleService.stopScan();
      setScanning(false);
      setDevices((prev) => {
        if (prev.length === 0) {
          setStage('idle');
          setUserMessage('No fireplace found yet. Make sure it is powered and in setup mode, then scan again.');
        }
        return prev;
      });
    }, 15000);
  };

  useEffect(() => {
    if (autoScanDelayMs == null) return;
    const timer = setTimeout(() => {
      void startScan();
    }, autoScanDelayMs);
    return () => clearTimeout(timer);
    // startScan intentionally captures the current screen state for this setup session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScanDelayMs]);

  const scanWifiNetworks = async (device = selected) => {
    if (!device) return;
    setWifiScanBusy(true);
    setWifiNetworks([]);
    setSsid('');
    setManualSsid(false);
    setStage('sendingWifi');
    setUserMessage('Loading nearby Wi-Fi networks from the fireplace.');
    addLog('Requesting Wi-Fi network list from fireplace...');
    try {
      const networks = await bleService.scanWifiNetworks(device, (line) => addLog(`Device: ${line}`));
      setWifiNetworks(networks);
      setStage('deviceFound');
      setUserMessage(
        networks.length > 0
          ? 'Choose your Wi-Fi network.'
          : 'No Wi-Fi networks were returned. Enter the Wi-Fi name manually.',
      );
      if (networks.length === 0) setManualSsid(true);
    } catch (e: any) {
      setStage('deviceFound');
      setManualSsid(true);
      setUserMessage('Wi-Fi list could not be loaded. Enter the Wi-Fi name manually or try again.');
      addLog('Wi-Fi scan error: ' + (e?.message ?? String(e)));
    } finally {
      setWifiScanBusy(false);
    }
  };
  const send = async () => {
    const cleanSsid = ssid.trim();
    if (!selected || !cleanSsid) return;
    setBusy(true);
    waitingForMqttRef.current = false;
    mqttConfirmedRef.current = false;
    const deviceLabel = selected.name ?? selected.id;
    setStage('connectingBle');
    setUserMessage('Connecting to the fireplace over Bluetooth.');
    addLog(`Connecting to ${deviceLabel}...`);

    try {
      const provisionOnce = () =>
        bleService.provision(selected, cleanSsid, password, (line) => {
          addLog(`Device: ${line}`);
          if (line.startsWith('SAVED:')) {
            setStage('restarting');
            setUserMessage('Wi-Fi details saved. The fireplace is restarting with Bluetooth off.');
          }
        });

      setStage('sendingWifi');
      setUserMessage('Sending Wi-Fi details securely to the fireplace.');
      try {
        await provisionOnce();
      } catch (e: any) {
        const message = e?.message ?? String(e);
        const canRetry =
          message.toLowerCase().includes('disconnect') ||
          message.toLowerCase().includes('was disconnected');
        if (!canRetry) throw e;

        setStage('connectingBle');
        setUserMessage('Bluetooth dropped during setup. Retrying automatically.');
        addLog(`Bluetooth disconnected during setup: ${message}`);
        await bleService.disconnect();
        await delay(1000);
        addLog(`Connecting to ${deviceLabel} again...`);
        await provisionOnce();
      }

      waitingForMqttRef.current = true;
      setStage('waitingWifi');
      setUserMessage('Waiting for the fireplace to join Wi-Fi and report online.');
      addLog('Wi-Fi sent. Waiting for MQTT confirmation.');
    } catch (e: any) {
      setBusy(false);
      setStage('error');
      setUserMessage('Setup could not complete. Please check the Wi-Fi details and try again.');
      addLog('Error: ' + (e?.message ?? String(e)));
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Set up device</Text>
        {onClose && (
          <TouchableOpacity onPress={onClose} accessibilityRole="button" accessibilityLabel="Close setup">
            <Text style={styles.close}>x</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.statusCard, stage === 'error' && styles.statusError, stage === 'complete' && styles.statusDone]}>
        <View style={styles.statusHeader}>
          <Text style={styles.statusTitle}>{stageText[stage]}</Text>
          {(scanning || busy) && stage !== 'complete' && <ActivityIndicator />}
        </View>
        <Text style={styles.statusMessage}>{userMessage}</Text>
      </View>

      {/* The fireplace is already on Wi-Fi and reporting telemetry — it will not be
          advertising over Bluetooth, so offer a way straight into the app instead of
          trapping the user on a scan that can never succeed (e.g. after reinstalling
          the app on an already-configured fireplace). */}
      {alreadyConnected && (
        <View style={styles.readyCard}>
          <Text style={styles.readyTitle}>Fireplace already connected</Text>
          <Text style={styles.readyText}>
            This fireplace is on Wi-Fi and responding. You can start using it now — Bluetooth setup is
            only needed for a new fireplace or a new Wi-Fi network.
          </Text>
          <TouchableOpacity style={styles.btn} onPress={() => void persistPairing()}>
            <Text style={styles.btnText}>Use this fireplace</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={styles.btn} onPress={startScan} disabled={scanning || busy}>
        <Text style={styles.btnText}>{scanning ? 'Scanning...' : stage === 'error' ? 'Try again' : 'Scan for device'}</Text>
      </TouchableOpacity>

      {devices.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Found devices</Text>
          {devices.map((d) => (
            <TouchableOpacity
              key={d.id}
              style={[styles.deviceRow, selected?.id === d.id && styles.deviceSelected]}
              onPress={() => {
                setSelected(d);
                setStage('deviceFound');
                setUserMessage('Loading nearby Wi-Fi networks from the fireplace.');
                void scanWifiNetworks(d);
              }}
            >
              <Text>{d.name ?? 'Kaminlicht fireplace'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {selected && stage !== 'complete' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{manualSsid ? 'Enter Wi-Fi manually' : ssid ? 'Wi-Fi password' : 'Choose Wi-Fi'}</Text>
          {wifiScanBusy && (
            <View style={styles.loadingRow}>
              <ActivityIndicator />
              <Text style={styles.statusMessage}>Loading Wi-Fi networks...</Text>
            </View>
          )}
          {!wifiScanBusy && !ssid && wifiNetworks.length > 0 && (
            <View style={styles.networkList}>
              {wifiNetworks.map((network) => (
                <TouchableOpacity
                  key={network.ssid}
                  style={styles.networkRow}
                  onPress={() => {
                    setSsid(network.ssid);
                    setManualSsid(false);
                    setUserMessage('Enter the password for the selected Wi-Fi network.');
                  }}
                >
                  <Text style={styles.networkName}>{network.ssid}</Text>
                  <Text style={styles.networkMeta}>{network.secure ? 'Secured' : 'Open'} � {network.rssi} dBm</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {!wifiScanBusy && !ssid && (
            <View style={styles.actionRow}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => scanWifiNetworks()} disabled={busy}>
                <Text style={styles.secondaryBtnText}>Scan again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => {
                  setManualSsid(true);
                  setSsid('');
                  setPassword('');
                  setUserMessage('Type the exact Wi-Fi name, then enter the password.');
                }}
                disabled={busy}
              >
                <Text style={styles.secondaryBtnText}>Enter manually</Text>
              </TouchableOpacity>
            </View>
          )}
          {manualSsid && (
            <TextInput
              style={styles.input}
              placeholder="Wi-Fi name (SSID)"
              value={ssid}
              onChangeText={setSsid}
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}
          {ssid.trim().length > 0 && (
            <>
              {!manualSsid && (
                <View style={styles.selectedNetwork}>
                  <View>
                    <Text style={styles.networkName}>{ssid}</Text>
                    <Text style={styles.networkMeta}>Selected network</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setSsid('');
                      setPassword('');
                      setUserMessage('Choose your Wi-Fi network.');
                    }}
                  >
                    <Text style={styles.changeText}>Change</Text>
                  </TouchableOpacity>
                </View>
              )}
              <View style={styles.passwordRow}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Wi-Fi password"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!passwordVisible}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                />
                <TouchableOpacity
                  style={styles.passwordToggle}
                  onPress={() => setPasswordVisible((visible) => !visible)}
                >
                  <Text style={styles.passwordToggleText}>{passwordVisible ? 'Hide' : 'Show'}</Text>
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={styles.btn} onPress={send} disabled={busy || ssid.trim().length === 0}>
                <Text style={styles.btnText}>{busy ? 'Setting up...' : 'Connect fireplace'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* First-run setup has no close target: RootNavigator swaps to the main app
          on its own once the device is saved. */}
      {stage === 'complete' && onClose && (
        <TouchableOpacity style={styles.btn} onPress={onClose}>
          <Text style={styles.btnText}>Done</Text>
        </TouchableOpacity>
      )}

      {/* Escape hatch for first-run setup. Bluetooth setup is impossible when the
          fireplace already holds Wi-Fi credentials (it stops advertising), so the gate
          must never be the only way in. Pairs against the configured fallback hosts. */}
      {!onClose && stage !== 'complete' && (
        <TouchableOpacity
          style={styles.skipBtn}
          onPress={() => void persistPairing()}
          accessibilityRole="button"
        >
          <Text style={styles.skipText}>Skip setup - my fireplace is already installed</Text>
        </TouchableOpacity>
      )}

      {log.length > 0 && (
        <View style={styles.card}>
          <TouchableOpacity onPress={() => setDetailsOpen((open) => !open)}>
            <Text style={styles.detailsToggle}>{detailsOpen ? 'Hide technical details' : 'Show technical details'}</Text>
          </TouchableOpacity>
          {detailsOpen &&
            log.map((l, i) => (
              <Text key={i} style={styles.logLine}>{l}</Text>
            ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, backgroundColor: '#fff', flexGrow: 1 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '700' },
  close: { fontSize: 22, color: '#666', paddingHorizontal: 8 },
  btn: { backgroundColor: '#ea580c', padding: 14, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
  card: { backgroundColor: '#f4f4f5', borderRadius: 8, padding: 14, gap: 8 },
  statusCard: { backgroundColor: '#f4f4f5', borderRadius: 8, padding: 14, gap: 6, borderWidth: 1, borderColor: '#e4e4e7' },
  statusDone: { backgroundColor: '#ecfdf5', borderColor: '#10b981' },
  statusError: { backgroundColor: '#fef2f2', borderColor: '#ef4444' },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  statusTitle: { fontSize: 16, fontWeight: '700', color: '#18181b' },
  statusMessage: { fontSize: 14, color: '#52525b', lineHeight: 20 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  deviceRow: { padding: 10, borderRadius: 8, backgroundColor: '#e4e4e7' },
  deviceSelected: { backgroundColor: '#fed7aa', borderWidth: 1, borderColor: '#ea580c' },
  secondaryBtn: { borderWidth: 1, borderColor: '#ea580c', padding: 12, borderRadius: 8, alignItems: 'center' },
  secondaryBtnText: { color: '#ea580c', fontWeight: '700' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionRow: { flexDirection: 'row', gap: 8 },
  networkList: { gap: 8 },
  networkRow: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#d4d4d8', borderRadius: 8, padding: 10, gap: 2 },
  networkSelected: { backgroundColor: '#fff7ed', borderColor: '#ea580c' },
  networkName: { color: '#18181b', fontWeight: '700' },
  networkMeta: { color: '#71717a', fontSize: 12 },
  selectedNetwork: { backgroundColor: '#fff7ed', borderWidth: 1, borderColor: '#ea580c', borderRadius: 8, padding: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  changeText: { color: '#ea580c', fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#d4d4d8', borderRadius: 8, padding: 10, fontSize: 15 },
  passwordRow: { flexDirection: 'row', alignItems: 'stretch' },
  passwordInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderRightWidth: 0,
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
    padding: 10,
    fontSize: 15,
  },
  passwordToggle: {
    width: 72,
    borderWidth: 1,
    borderColor: '#d4d4d8',
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff7ed',
  },
  passwordToggleText: { color: '#ea580c', fontWeight: '700' },
  skipBtn: { paddingVertical: 12, alignItems: 'center' },
  skipText: { color: '#71717a', fontWeight: '600', textDecorationLine: 'underline' },
  readyCard: { backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#10b981', borderRadius: 8, padding: 14, gap: 8 },
  readyTitle: { fontSize: 15, fontWeight: '700', color: '#065f46' },
  readyText: { fontSize: 14, color: '#047857', lineHeight: 20 },
  detailsToggle: { color: '#ea580c', fontWeight: '700' },
  logLine: { fontSize: 13, color: '#444' },
});






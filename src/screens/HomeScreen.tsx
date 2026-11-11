/**
 * Home screen - Status Card + Power + Vapour + Blowers + Sleep Timer.
 *
 * ===== HOW THIS SCREEN TALKS TO THE FIREPLACE (Arduino) =====
 * Two kinds of lines connect to the board (firmware: glowfire_production_s3.ino):
 *
 *   1) READ  — the "use...()" hooks below receive the board's live status
 *              (what's on, temperature, etc.) every 2 seconds and show it on screen.
 *   2) SEND  — the "build...Cmd(...)" calls send a command to the board; the board's
 *              onCommand() runs the matching apply...() function and drives a pin.
 *
 *   Button on screen            Command sent          Arduino does -> pin
 *   --------------------------  --------------------  ------------------------
 *   Turn On / Off               system/power          systemPowerOn/Off -> all
 *   Vapour ON/OFF + Intensity   vapor/*               applyMist()       -> GPIO 12
 *   Blower 1/2 on/off + speed   blower/*              applyBlowers()    -> GPIO 14/15
 *   Sleep timer                 timer/set_sleep       software timer
 *
 * The app has NO pins - it only sends messages. Pins live in the .ino firmware.
 */
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useConnectionState, usePublishWithAck, useStableOffline } from '../contexts/DeviceContext';
import { useBlowerCount } from '../contexts/CapabilitiesContext';
import Slider from '../components/Slider';
// READ hooks: these receive the board's live status (telemetry) and show it on screen.
import {
  usePower,            // is the fireplace powered on?
  useVaporOn,          // is the mist/vapour on?
  useWaterLevel,       // water in tank ("—" when no sensor fitted)
  useCurrentTemp,      // temperature ("—" when no sensor fitted)
  useHumidity,         // humidity ("—" when no sensor fitted)
  useWifiRssi,         // Wi-Fi signal strength
  useSleepRemaining,   // sleep-timer countdown
  useBlower1On,        // blower 1 on?
  useBlower1Speed,     // blower 1 speed
  useBlower2On,        // blower 2 on?
  useBlower2Speed,     // blower 2 speed
} from '../hooks/useDeviceTelemetry';
// SEND builders: each makes a command the board understands; sendCommand() delivers it.
import {
  buildPowerCmd,          // -> system/power      (Arduino: systemPowerOn/Off)
  buildSleepTimerCmd,     // -> timer/set_sleep   (Arduino: sleep timer)
  buildVaporPowerCmd,     // -> vapor/power       (Arduino: applyMist -> GPIO 12)
  buildVaporIntensityCmd, // -> vapor/set_intensity (Arduino: applyMist -> GPIO 12)
  buildBlowerPowerCmd,    // -> blower/power      (Arduino: applyBlowers -> GPIO 14/15)
  buildBlowerSpeedCmd,    // -> blower/set_speed  (Arduino: applyBlowers -> GPIO 14/15)
  type BlowerId,
  type MQTTCommand,
} from '../types/commands';

const MAX_TIMER_SECONDS = 8 * 60 * 60;


function formatRemaining(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function TimeUnitControl({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <View style={styles.timeUnit}>
      <TouchableOpacity style={styles.timeAdjust} onPress={() => onChange(clamp(value + 1, 0, max))}>
        <Text style={styles.timeAdjustText}>+</Text>
      </TouchableOpacity>
      <Text style={styles.timeNumber}>{String(value).padStart(2, '0')}</Text>
      <Text style={styles.timeLabel}>{label}</Text>
      <TouchableOpacity style={styles.timeAdjust} onPress={() => onChange(clamp(value - 1, 0, max))}>
        <Text style={styles.timeAdjustText}>-</Text>
      </TouchableOpacity>
    </View>
  );
}

function BlowerRow({
  id,
  on,
  speed,
  disabled,
  onToggle,
  onSpeed,
}: {
  id: BlowerId;
  on: boolean;
  speed: number;
  disabled: boolean;
  onToggle: (next: boolean) => void;
  onSpeed: (pct: number) => void;
}) {
  return (
    <View style={styles.blowerRow}>
      <View style={styles.rowBetween}>
        <Text style={styles.label}>Blower {id}</Text>
        <TouchableOpacity
          disabled={disabled}
          style={[styles.toggle, on && styles.toggleOn, disabled && styles.disabled]}
          onPress={() => onToggle(!on)}
        >
          <Text style={styles.toggleText}>{on ? 'ON' : 'OFF'}</Text>
        </TouchableOpacity>
      </View>
      <Slider
        value={speed}
        min={0}
        max={100}
        disabled={disabled || !on}
        formatValue={(v) => `${Math.round(v)}%`}
        onCommit={onSpeed}
      />
    </View>
  );
}

export default function HomeScreen() {
  const offline = useStableOffline();
  const connectionState = useConnectionState();
  const blowerCount = useBlowerCount();
  const blower1On = useBlower1On();
  const blower1Speed = useBlower1Speed();
  const blower2On = useBlower2On();
  const blower2Speed = useBlower2Speed();
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [timerHours, setTimerHours] = useState(0);
  const [timerMinutes, setTimerMinutes] = useState(15);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [sleepEndsAtMs, setSleepEndsAtMs] = useState<number | null>(null);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());
  const power = usePower();
  const vaporOn = useVaporOn();
  const water = useWaterLevel();
  const tempC = useCurrentTemp();
  const humidity = useHumidity();
  const rssi = useWifiRssi();
  const sleep = useSleepRemaining();
  const publishWithAck = usePublishWithAck();

  useEffect(() => {
    if (sleep == null || sleep <= 0) {
      setSleepEndsAtMs(null);
      return;
    }
    setSleepEndsAtMs(Date.now() + sleep * 1000);
  }, [sleep]);

  useEffect(() => {
    if (sleepEndsAtMs == null) return;
    const timer = setInterval(() => setClockNowMs(Date.now()), 250);
    return () => clearInterval(timer);
  }, [sleepEndsAtMs != null]);

  const waterEmpty = water === 'empty';
  const controlsDisabled = offline || pendingCommand !== null;
  const displaySleep = sleepEndsAtMs == null ? null : Math.max(0, Math.ceil((sleepEndsAtMs - clockNowMs) / 1000));
  const sleepActive = displaySleep != null && displaySleep > 0;
  const selectedTimerSeconds = timerHours * 3600 + timerMinutes * 60 + timerSeconds;
  const canStartTimer = selectedTimerSeconds > 0 && selectedTimerSeconds <= MAX_TIMER_SECONDS;

  // sendCommand: the single door out to the fireplace. Every button below calls this with
  // a build...Cmd(...) message; it is sent over Wi-Fi and we wait for the board to confirm.
  const sendCommand = async (command: MQTTCommand, label: string) => {
    setPendingCommand(label);
    try {
      await publishWithAck(command, 6000);
    } catch (error) {
      Alert.alert(
        'Command not confirmed',
        error instanceof Error ? error.message : 'The fireplace did not confirm the command.',
      );
    } finally {
      setPendingCommand(null);
    }
  };

  const toggleBlower = (id: BlowerId, on: boolean) =>
    void sendCommand(buildBlowerPowerCmd(id, on), `blower ${id} ${on ? 'on' : 'off'}`);
  const setBlowerSpeed = (id: BlowerId, pct: number) =>
    void sendCommand(buildBlowerSpeedCmd(id, pct), `blower ${id} speed`);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {connectionState !== 'connected' && (
        <Text style={styles.offline}>
          {connectionState === 'reconnecting'
            ? 'Reconnecting to fireplace...'
            : 'Fireplace offline. Waiting for Wi-Fi connection...'}
        </Text>
      )}
      {pendingCommand && <Text style={styles.notice}>Sending {pendingCommand}...</Text>}
      {rssi != null && rssi < -70 && <Text style={styles.warn}>Weak Wi-Fi signal.</Text>}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Status</Text>
        <Row label="Connection" value={connectionState} />
        <Row label="Power" value={power ? 'ON' : 'OFF'} />
        <Row label="Water level" value={water ?? '-'} />
        {tempC != null && <Row label="Temperature" value={`${tempC} C`} />}
        {humidity != null && <Row label="Humidity" value={`${humidity} %`} />}
        {rssi != null && <Row label="Wi-Fi" value={`${rssi} dBm`} />}
        <Row label="Sleep timer" value={sleepActive ? formatRemaining(displaySleep) : 'Off'} />
      </View>

      {/* POWER button -> system/power -> Arduino systemPowerOn()/systemPowerOff() */}
      <TouchableOpacity
        disabled={controlsDisabled}
        style={[styles.power, power ? styles.powerOn : styles.powerOff, controlsDisabled && styles.disabled]}
        onPress={() => void sendCommand(buildPowerCmd(!power), power ? 'power off' : 'power on')}
      >
        <Text style={styles.powerText}>{power ? 'Turn Off' : 'Turn On'}</Text>
      </TouchableOpacity>

      <View style={styles.card}>
        <View style={styles.timerHeader}>
          <View>
            <Text style={styles.cardTitle}>Sleep timer</Text>
            <Text style={styles.helperText}>Set any auto-off duration.</Text>
          </View>
          {sleepActive && <Text style={styles.timerPill}>Active</Text>}
        </View>

        {sleepActive ? (
          <View style={styles.countdownPanel}>
            <Text style={styles.countdownLabel}>Time remaining</Text>
            <Text style={styles.countdownValue}>{formatRemaining(displaySleep)}</Text>
            <Text style={styles.helperText}>Power, flame lights, and vapour will turn off automatically.</Text>
          </View>
        ) : (
          <View style={styles.timePickerPanel}>
            <Text style={styles.timerPreview}>{formatRemaining(selectedTimerSeconds)}</Text>
            <View style={styles.timePickerRow}>
              <TimeUnitControl label="hr" value={timerHours} max={8} onChange={setTimerHours} />
              <TimeUnitControl label="min" value={timerMinutes} max={59} onChange={setTimerMinutes} />
              <TimeUnitControl label="sec" value={timerSeconds} max={59} onChange={setTimerSeconds} />
            </View>
          </View>
        )}

        <TouchableOpacity
          disabled={controlsDisabled || (!sleepActive && !canStartTimer)}
          style={[
            sleepActive ? styles.cancelTimerButton : styles.startTimerButton,
            (controlsDisabled || (!sleepActive && !canStartTimer)) && styles.disabled,
          ]}
          onPress={() => {
            if (sleepActive) {
              setSleepEndsAtMs(null);
              void sendCommand(buildSleepTimerCmd(0), 'cancel sleep timer');
              return;
            }
            setSleepEndsAtMs(Date.now() + selectedTimerSeconds * 1000);
            setClockNowMs(Date.now());
            void sendCommand(buildSleepTimerCmd(selectedTimerSeconds), 'sleep timer');
          }}
        >
          <Text style={sleepActive ? styles.cancelTimerText : styles.startTimerText}>
            {sleepActive ? 'Cancel timer' : 'Start timer'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* VAPOUR card -> on/off only. ON runs the mist at full; OFF turns it off.
          ON sends vapor/set_intensity(6) (max); OFF sends vapor/power(false). */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Vapour</Text>
        {waterEmpty && <Text style={styles.warn}>Tank empty - refill to use vapour.</Text>}
        <View style={styles.rowBetween}>
          <Text style={styles.label}>Flame effect</Text>
          <TouchableOpacity
            disabled={waterEmpty || controlsDisabled}
            style={[styles.toggle, vaporOn && styles.toggleOn, (waterEmpty || controlsDisabled) && styles.disabled]}
            onPress={() =>
              vaporOn
                ? void sendCommand(buildVaporPowerCmd(false), 'flame effect off')
                : void sendCommand(buildVaporIntensityCmd(6), 'flame effect on')
            }
          >
            <Text style={styles.toggleText}>{vaporOn ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* BLOWERS card -> blower/power + blower/set_speed -> Arduino applyBlowers() -> GPIO 14/15.
          Only shown when the board reports it has blowers (blowerCount > 0). */}
      {blowerCount > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Blowers</Text>
          <Text style={styles.helperText}>Push the vapour up through the flame. Run one or both.</Text>
          <BlowerRow
            id={1}
            on={blower1On}
            speed={blower1Speed}
            disabled={controlsDisabled}
            onToggle={(v) => toggleBlower(1, v)}
            onSpeed={(p) => setBlowerSpeed(1, p)}
          />
          {blowerCount > 1 && (
            <BlowerRow
              id={2}
              on={blower2On}
              speed={blower2Speed}
              disabled={controlsDisabled}
              onToggle={(v) => toggleBlower(2, v)}
              onSpeed={(p) => setBlowerSpeed(2, p)}
            />
          )}
        </View>
      )}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.rowBetween}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 14, backgroundColor: '#fff', flexGrow: 1 },
  offline: { backgroundColor: '#fee2e2', color: '#991b1b', padding: 10, borderRadius: 8, textAlign: 'center' },
  notice: { backgroundColor: '#eff6ff', color: '#1d4ed8', padding: 10, borderRadius: 8, textAlign: 'center' },
  warn: { color: '#b45309', fontSize: 13 },
  helperText: { color: '#666', fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: '#f4f4f5', borderRadius: 14, padding: 16, gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 15, color: '#444' },
  value: { fontSize: 15, fontWeight: '600' },
  power: { padding: 16, borderRadius: 14, alignItems: 'center' },
  powerOn: { backgroundColor: '#16a34a' },
  powerOff: { backgroundColor: '#71717a' },
  powerText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  timerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  timerPill: { color: '#166534', backgroundColor: '#dcfce7', paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, fontWeight: '700' },
  timePickerPanel: { backgroundColor: '#fff', borderRadius: 12, padding: 14, gap: 12 },
  timerPreview: { textAlign: 'center', fontSize: 38, fontWeight: '800', color: '#111827' },
  timePickerRow: { flexDirection: 'row', gap: 10 },
  timeUnit: { flex: 1, alignItems: 'center', gap: 6, backgroundColor: '#f9fafb', borderRadius: 12, paddingVertical: 10 },
  timeAdjust: { width: 42, height: 34, borderRadius: 17, backgroundColor: '#ffedd5', alignItems: 'center', justifyContent: 'center' },
  timeAdjustText: { color: '#ea580c', fontSize: 22, fontWeight: '800', lineHeight: 24 },
  timeNumber: { color: '#111827', fontSize: 28, fontWeight: '800' },
  timeLabel: { color: '#71717a', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  countdownPanel: { backgroundColor: '#fff', borderRadius: 12, padding: 16, alignItems: 'center', gap: 6 },
  countdownLabel: { color: '#71717a', fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  countdownValue: { color: '#111827', fontSize: 44, fontWeight: '800' },
  startTimerButton: { backgroundColor: '#ea580c', padding: 14, borderRadius: 12, alignItems: 'center' },
  startTimerText: { color: '#fff', fontWeight: '800' },
  cancelTimerButton: { borderWidth: 1, borderColor: '#dc2626', padding: 12, borderRadius: 10, alignItems: 'center' },
  cancelTimerText: { color: '#dc2626', fontWeight: '700' },
  toggle: { paddingVertical: 6, paddingHorizontal: 18, borderRadius: 20, backgroundColor: '#d4d4d8' },
  toggleOn: { backgroundColor: '#ea580c' },
  toggleText: { color: '#fff', fontWeight: '700' },
  blowerRow: { gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#e4e4e7' },
  steps: { flexDirection: 'row', gap: 8, marginTop: 6 },
  step: { flex: 1, aspectRatio: 1, borderRadius: 10, backgroundColor: '#e4e4e7', alignItems: 'center', justifyContent: 'center' },
  stepActive: { backgroundColor: '#ea580c' },
  stepText: { fontWeight: '700', color: '#71717a' },
  stepTextActive: { color: '#fff' },
  disabled: { opacity: 0.4 },
});



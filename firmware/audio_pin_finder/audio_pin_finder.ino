/*
 * audio_pin_finder — TEMPORARY diagnostic sketch. Not part of the product firmware.
 *
 * PURPOSE: find which ESP32 pins the DFPlayer/audio module is actually wired to.
 * It walks a list of candidate RX/TX pin pairs, sends the DFPlayer "query status"
 * frame on each, and reports any pair that answers. A DFPlayer always replies with a
 * 10-byte frame starting 0x7E, so a reply is proof the wiring is correct.
 *
 * HOW TO USE
 *   1. Tools -> Board: "ESP32 Dev Module"   Port: your COM port
 *   2. Upload this sketch
 *   3. Tools -> Serial Monitor, 115200 baud
 *   4. Read the RESULT block at the end and send it back
 *
 * Needs no libraries and no SD card. Afterwards, re-upload glowfire_esp32.ino to
 * restore the real firmware — nothing here is permanent.
 *
 * NOTE: this only detects SERIAL audio modules (DFPlayer Mini and clones). If the
 * speaker is driven by an I2S or analog DAC amplifier instead, nothing will answer
 * and that itself tells us which kind of module is fitted.
 */
#include <Arduino.h>

// Candidate RX/TX pairs. rx = ESP32 receives (module TX), tx = ESP32 sends (module RX).
// Both orders of each pair are tried, because wiring is easy to swap by mistake.
struct PinPair {
  int rx;
  int tx;
  const char* note;
};

PinPair candidates[] = {
  { 14, 27, "teammate's RX + safe TX" },
  { 14, 12, "teammate's original pins" },
  { 16, 17, "common ESP32 UART2 default" },
  { 26, 27, "next to the LED strip" },
  { 25, 26, "the pins you mentioned" },
  { 32, 33, "free pair" },
  { 13, 14, "free pair" },
  {  4,  5, "free pair" },
  { 18, 19, "free pair" },
  { 21, 22, "free pair" },
};
const int CANDIDATE_COUNT = sizeof(candidates) / sizeof(candidates[0]);

// DFPlayer "query current status" frame (CMD 0x42) with checksum.
const uint8_t QUERY[10] = { 0x7E, 0xFF, 0x06, 0x42, 0x00, 0x00, 0x00, 0xFE, 0xB9, 0xEF };

int foundRx[8];
int foundTx[8];
int foundCount = 0;

/** Returns true if something answered with a DFPlayer-shaped frame on this pin pair. */
bool probe(int rxPin, int txPin) {
  Serial2.begin(9600, SERIAL_8N1, rxPin, txPin);
  delay(120);
  while (Serial2.available()) Serial2.read();  // flush noise

  Serial2.write(QUERY, sizeof(QUERY));
  Serial2.flush();

  unsigned long deadline = millis() + 350;
  uint8_t buf[16];
  int n = 0;
  while (millis() < deadline && n < (int)sizeof(buf)) {
    if (Serial2.available()) buf[n++] = Serial2.read();
  }
  Serial2.end();

  if (n == 0) return false;

  Serial.printf("      raw reply (%d bytes):", n);
  for (int i = 0; i < n; i++) Serial.printf(" %02X", buf[i]);
  Serial.println();

  for (int i = 0; i < n; i++) {
    if (buf[i] == 0x7E) return true;  // DFPlayer frame start
  }
  return false;
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println();
  Serial.println("=====================================================");
  Serial.println(" Glow Fire - audio pin finder");
  Serial.println(" Looking for a DFPlayer-style module on each pin pair");
  Serial.println("=====================================================");
  Serial.println();

  for (int i = 0; i < CANDIDATE_COUNT; i++) {
    int rx = candidates[i].rx;
    int tx = candidates[i].tx;

    Serial.printf("[%2d/%d] RX=%d  TX=%d   (%s)\n", i + 1, CANDIDATE_COUNT, rx, tx, candidates[i].note);
    if (probe(rx, tx) && foundCount < 8) {
      Serial.println("      >>> ANSWERED <<<");
      foundRx[foundCount] = rx;
      foundTx[foundCount] = tx;
      foundCount++;
    }

    // Same wires, swapped over — a very common wiring mistake.
    Serial.printf("        ...swapped: RX=%d TX=%d\n", tx, rx);
    if (probe(tx, rx) && foundCount < 8) {
      Serial.println("      >>> ANSWERED (swapped) <<<");
      foundRx[foundCount] = tx;
      foundTx[foundCount] = rx;
      foundCount++;
    }
    delay(60);
  }

  Serial.println();
  Serial.println("===================== RESULT ========================");
  if (foundCount == 0) {
    Serial.println(" No serial audio module answered on any pin pair.");
    Serial.println();
    Serial.println(" This means ONE of the following:");
    Serial.println("   1. The module is NOT a DFPlayer (it may be an I2S or");
    Serial.println("      analog amplifier, which cannot answer back).");
    Serial.println("   2. The module has no power (check 5V and GND).");
    Serial.println("   3. The data wires are not connected to the ESP32 at all.");
    Serial.println("   4. It is wired to a pin pair not in the list above.");
  } else {
    Serial.println(" Audio module FOUND. Use these pins in the firmware:");
    for (int i = 0; i < foundCount; i++) {
      Serial.printf("   DFPLAYER_RX = %d   (ESP32 receives)\n", foundRx[i]);
      Serial.printf("   DFPLAYER_TX = %d   (ESP32 sends)\n", foundTx[i]);
    }
  }
  Serial.println("=====================================================");
  Serial.println(" Copy everything above and send it back.");
  Serial.println(" Then re-upload glowfire_esp32.ino to restore the firmware.");
}

void loop() {
  delay(5000);
}

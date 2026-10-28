/*
  Smart Pillbox AI - ESP32-S3 hardware MVP

  Required Arduino libraries:
  - ArduinoJson 7.x
  - Adafruit GFX Library
  - Adafruit SSD1306

  Copy config.example.h to config.h and update Wi-Fi/server settings first.
  Verify the GPIO map against the exact ESP32-S3 DevKitC board before wiring.
*/

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <Wire.h>

#include "config.h"

constexpr uint8_t SLOT_COUNT = 8;
// Require a reed state to remain unchanged long enough to reject contact
// bounce and brief magnetic-field fluctuations around the lid threshold.
constexpr unsigned long DEBOUNCE_MS = 300;
constexpr unsigned long STATE_POLL_MS = 1500;
constexpr unsigned long TELEMETRY_UPLOAD_MS = 10000;
constexpr unsigned long WIFI_RETRY_MS = 5000;
constexpr unsigned long WIFI_CONNECT_TIMEOUT_MS = 20000;
constexpr unsigned long HTTP_TIMEOUT_MS = 1500;
constexpr unsigned long WRONG_WARNING_MS = 2000;
constexpr unsigned long TEMP_MESSAGE_MS = 2000;
constexpr uint8_t MAX_UPLOAD_ATTEMPTS = 3;
constexpr uint8_t EVENT_QUEUE_SIZE = 12;

// Safe defaults for a common ESP32-S3 DevKitC-1. Change only this block.
const uint8_t REED_PINS[SLOT_COUNT] = {4, 5, 6, 7, 15, 16, 17, 18};
const uint8_t GREEN_LED_PINS[SLOT_COUNT] = {8, 9, 10, 11, 12, 13, 14, 21};
// R1 build package: eight channels enabled; passive piezo driver on GPIO40.
const bool SLOT_ENABLED[SLOT_COUNT] = {
  true, true, true, true, true, true, true, true
};
constexpr uint8_t BUZZER_PIN = 40;
constexpr uint8_t RED_LED_PIN = 39;
constexpr uint8_t OLED_SDA_PIN = 41;
constexpr uint8_t OLED_SCL_PIN = 42;
constexpr unsigned int BUZZER_TONE_HZ = 2200;

// Most 3.3 V reed modules output LOW while the lid magnet is close.
// Change this one value to HIGH if Serial Monitor proves your module is inverted.
// This module drives DO HIGH when the lid magnet is present (lid closed).
constexpr int REED_CLOSED_LEVEL = HIGH;

constexpr uint8_t SCREEN_WIDTH = 128;
constexpr uint8_t SCREEN_HEIGHT = 64;
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

struct QueuedEvent {
  uint8_t slotId;
  String eventType;
  uint8_t attempts;
  unsigned long nextAttemptAt;
  bool correctSlot;
};

bool rawOpenState[SLOT_COUNT];
bool stableOpenState[SLOT_COUNT];
unsigned long rawChangedAt[SLOT_COUNT];

QueuedEvent eventQueue[EVENT_QUEUE_SIZE];
uint8_t queueHead = 0;
uint8_t queueTail = 0;
uint8_t queueCount = 0;

bool oledReady = false;
bool reminderActive = false;
uint8_t activeSlot = 0;
uint8_t reminderStage = 0;
uint8_t locallyAcknowledgedSlot = 0;
unsigned long lastStatePollAt = 0;
unsigned long lastTelemetryUploadAt = 0;
unsigned long lastWifiAttemptAt = 0;
bool wifiConnectionInProgress = false;
unsigned long wrongWarningStartedAt = 0;
unsigned long temporaryMessageUntil = 0;

String stateEndpoint() {
  return String(SERVER_BASE_URL) + "/api/hardware/state?deviceId=" +
         String(DEVICE_ID) + "&heartbeat=1";
}

String eventEndpoint() {
  return String(SERVER_BASE_URL) + "/api/hardware/events";
}

String telemetryEndpoint() {
  return String(SERVER_BASE_URL) + "/api/hardware/telemetry";
}

void showMessage(const String& firstLine, const String& secondLine = "") {
  if (!oledReady) return;

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 10);
  display.println(firstLine);
  display.setTextSize(2);
  display.setCursor(0, 32);
  display.println(secondLine);
  display.display();
}

void showCurrentState() {
  if (reminderActive) {
    showMessage(
      reminderStage >= 2 ? "SECOND REMINDER" : "MEDICATION TIME",
      "OPEN SLOT " + String(activeSlot)
    );
  } else if (WiFi.status() == WL_CONNECTED) {
    showMessage("READY", "NO REMINDER");
  } else {
    showMessage("SMART PILLBOX", "WIFI OFFLINE");
  }
}

bool readSlotOpen(uint8_t index) {
  return digitalRead(REED_PINS[index]) != REED_CLOSED_LEVEL;
}

bool isSlotEnabled(uint8_t slotId) {
  return slotId >= 1 && slotId <= SLOT_COUNT && SLOT_ENABLED[slotId - 1];
}

void setAllSlotLeds(bool enabled) {
  for (uint8_t index = 0; index < SLOT_COUNT; index++) {
    digitalWrite(GREEN_LED_PINS[index], enabled ? HIGH : LOW);
  }
}

void setReminderState(bool enabled, uint8_t slotId = 0, uint8_t stage = 1) {
  reminderActive = enabled;
  activeSlot = enabled ? slotId : 0;
  reminderStage = enabled ? stage : 0;
  setAllSlotLeds(false);

  if (enabled && slotId >= 1 && slotId <= SLOT_COUNT) {
    digitalWrite(GREEN_LED_PINS[slotId - 1], HIGH);
  }

  if (millis() >= temporaryMessageUntil) showCurrentState();
}

void startWifiConnection() {
  lastWifiAttemptAt = millis();
  wifiConnectionInProgress = true;
  Serial.print("[WiFi] Connecting to ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void maintainWifi(unsigned long now) {
  static wl_status_t previousStatus = WL_NO_SHIELD;
  const wl_status_t status = WiFi.status();

  if (status != previousStatus) {
    previousStatus = status;
    if (status == WL_CONNECTED) {
      wifiConnectionInProgress = false;
      Serial.print("[WiFi] Connected. ESP32 IP: ");
      Serial.println(WiFi.localIP());
      if (now >= temporaryMessageUntil) showCurrentState();
    }
  }

  if (status == WL_CONNECTED) return;

  if (wifiConnectionInProgress) {
    if (now - lastWifiAttemptAt < WIFI_CONNECT_TIMEOUT_MS) return;

    Serial.println("[WiFi] Connection timed out; retrying shortly.");
    WiFi.disconnect(false, false);
    wifiConnectionInProgress = false;
    lastWifiAttemptAt = now;
    return;
  }

  if (now - lastWifiAttemptAt >= WIFI_RETRY_MS) {
    startWifiConnection();
  }
}

void addDeviceKeyHeader(HTTPClient& http) {
  if (String(DEVICE_API_KEY).length() > 0) {
    http.addHeader("X-Device-Key", DEVICE_API_KEY);
  }
}

bool enqueueEvent(uint8_t slotId, const String& eventType, bool correctSlot) {
  if (queueCount >= EVENT_QUEUE_SIZE) {
    Serial.println("[Event] Queue full; opening could not be queued.");
    return false;
  }

  eventQueue[queueTail] = {slotId, eventType, 0, 0, correctSlot};
  queueTail = (queueTail + 1) % EVENT_QUEUE_SIZE;
  queueCount++;

  Serial.printf("[Event] Queued %s for Slot %u. Queue=%u\n",
                eventType.c_str(), slotId, queueCount);
  return true;
}

void removeQueuedEvent() {
  if (queueCount == 0) return;
  queueHead = (queueHead + 1) % EVENT_QUEUE_SIZE;
  queueCount--;
}

bool uploadEvent(const QueuedEvent& queuedEvent) {
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.begin(eventEndpoint());
  http.addHeader("Content-Type", "application/json");
  addDeviceKeyHeader(http);

  JsonDocument document;
  document["deviceId"] = DEVICE_ID;
  document["slotId"] = queuedEvent.slotId;
  document["eventType"] = queuedEvent.eventType;
  document["firmwareVersion"] = FIRMWARE_VERSION;
  String body;
  serializeJson(document, body);

  const int statusCode = http.POST(body);
  const String response = http.getString();
  http.end();

  Serial.printf("[HTTP] POST event -> %d %s\n", statusCode, response.c_str());
  return statusCode >= 200 && statusCode < 300;
}

void processEventQueue(unsigned long now) {
  if (queueCount == 0 || WiFi.status() != WL_CONNECTED) return;

  QueuedEvent& queuedEvent = eventQueue[queueHead];
  if (now < queuedEvent.nextAttemptAt) return;

  if (uploadEvent(queuedEvent)) {
    if (queuedEvent.correctSlot) {
      showMessage("SLOT " + String(queuedEvent.slotId) + " OPENED", "UPLOADED");
      temporaryMessageUntil = now + TEMP_MESSAGE_MS;
    }
    removeQueuedEvent();
    return;
  }

  queuedEvent.attempts++;
  if (queuedEvent.attempts >= MAX_UPLOAD_ATTEMPTS) {
    Serial.println("[Event] Upload failed after 3 attempts; event removed.");
    showMessage("UPLOAD FAILED", "CHECK SERVER");
    temporaryMessageUntil = now + TEMP_MESSAGE_MS;
    removeQueuedEvent();
    return;
  }

  queuedEvent.nextAttemptAt = now + 1000UL * queuedEvent.attempts;
  showMessage("UPLOAD FAILED", "RETRYING");
  temporaryMessageUntil = now + 900;
}

void uploadTelemetry(unsigned long now) {
  if (
    WiFi.status() != WL_CONNECTED ||
    now - lastTelemetryUploadAt < TELEMETRY_UPLOAD_MS
  ) {
    return;
  }
  lastTelemetryUploadAt = now;

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.begin(telemetryEndpoint());
  http.addHeader("Content-Type", "application/json");
  addDeviceKeyHeader(http);

  JsonDocument document;
  document["deviceId"] = DEVICE_ID;
  document["firmwareVersion"] = FIRMWARE_VERSION;
  document["ipAddress"] = WiFi.localIP().toString();
  document["wifiRssi"] = WiFi.RSSI();
  document["uptimeMs"] = now;
  document["freeHeapBytes"] = ESP.getFreeHeap();
  document["uploadQueueDepth"] = queueCount;
  document["reminderActive"] = reminderActive;
  if (reminderActive) {
    document["activeSlot"] = activeSlot;
  } else {
    document["activeSlot"] = nullptr;
  }

  String body;
  serializeJson(document, body);
  const int statusCode = http.POST(body);
  http.end();
  Serial.printf("[HTTP] POST telemetry -> %d\n", statusCode);
}

void pollDeviceState(unsigned long now) {
  if (WiFi.status() != WL_CONNECTED || now - lastStatePollAt < STATE_POLL_MS) {
    return;
  }
  lastStatePollAt = now;

  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.begin(stateEndpoint());
  addDeviceKeyHeader(http);
  const int statusCode = http.GET();

  if (statusCode < 200 || statusCode >= 300) {
    Serial.printf("[HTTP] GET state failed -> %d\n", statusCode);
    http.end();
    return;
  }

  const String response = http.getString();
  http.end();

  JsonDocument document;
  const DeserializationError error = deserializeJson(document, response);
  if (error) {
    Serial.printf("[HTTP] Invalid state JSON: %s\n", error.c_str());
    Serial.printf("[HTTP] State response was: %s\n", response.c_str());
    return;
  }

  const String status = document["status"] | "idle";
  const uint8_t nextActiveSlot = document["activeSlot"] | 0;
  const String nextReminderStage = document["reminderStage"] | "first";
  const uint8_t nextStage = nextReminderStage == "second" ? 2 : 1;

  if (
    status == "reminding" &&
    isSlotEnabled(nextActiveSlot) &&
    locallyAcknowledgedSlot != nextActiveSlot
  ) {
    if (
      !reminderActive ||
      activeSlot != nextActiveSlot ||
      reminderStage != nextStage
    ) {
      Serial.printf(
        "[State] Reminder stage %u active for Slot %u.\n",
        nextStage,
        nextActiveSlot
      );
      setReminderState(true, nextActiveSlot, nextStage);
    }
  } else if (status == "idle") {
    locallyAcknowledgedSlot = 0;
    if (reminderActive) {
      Serial.println("[State] Reminder stopped by server.");
      setReminderState(false);
    }
  }
}

void handleOpenedSlot(uint8_t slotId, unsigned long now) {
  const bool isCorrectSlot = reminderActive && slotId == activeSlot;
  const bool isWrongSlot = reminderActive && slotId != activeSlot;
  const String eventType = isWrongSlot ? "wrong_slot_open" : "lid_open";

  Serial.printf("[Sensor] Slot %u opened (%s).\n", slotId, eventType.c_str());
  enqueueEvent(slotId, eventType, isCorrectSlot);

  if (isCorrectSlot) {
    locallyAcknowledgedSlot = slotId;
    setReminderState(false);
    showMessage("SLOT " + String(slotId) + " OPENED", "UPLOADING");
    temporaryMessageUntil = now + TEMP_MESSAGE_MS;
  } else if (isWrongSlot) {
    wrongWarningStartedAt = now;
    showMessage("WRONG SLOT " + String(slotId), "OPEN SLOT " + String(activeSlot));
    temporaryMessageUntil = now + WRONG_WARNING_MS;
  }
}

void scanReedSensors(unsigned long now) {
  for (uint8_t index = 0; index < SLOT_COUNT; index++) {
    if (!SLOT_ENABLED[index]) continue;
    const bool rawIsOpen = readSlotOpen(index);

    if (rawIsOpen != rawOpenState[index]) {
      rawOpenState[index] = rawIsOpen;
      rawChangedAt[index] = now;
    }

    if (
      rawIsOpen != stableOpenState[index] &&
      now - rawChangedAt[index] >= DEBOUNCE_MS
    ) {
      const bool wasOpen = stableOpenState[index];
      stableOpenState[index] = rawIsOpen;
      Serial.printf("[Sensor] Slot %u is now %s.\n", index + 1,
                    rawIsOpen ? "OPEN" : "CLOSED");

      if (!wasOpen && rawIsOpen) {
        handleOpenedSlot(index + 1, now);
      }
    }
  }
}

void updateIndicators(unsigned long now) {
  const bool wrongWarningActive =
    wrongWarningStartedAt > 0 && now - wrongWarningStartedAt < WRONG_WARNING_MS;

  if (wrongWarningActive) {
    digitalWrite(RED_LED_PIN, HIGH);
    setBuzzer(((now - wrongWarningStartedAt) / 100) % 2 == 0);
  } else {
    digitalWrite(RED_LED_PIN, LOW);
    const unsigned long reminderPhase = now % 1600;
    const bool firstReminderBeep = reminderPhase < 220;
    const bool secondReminderBeep =
      reminderPhase < 260 ||
      (reminderPhase >= 480 && reminderPhase < 740);
    const bool reminderBeep =
      reminderActive &&
      (reminderStage >= 2 ? secondReminderBeep : firstReminderBeep);
    setBuzzer(reminderBeep);
  }

  if (temporaryMessageUntil > 0 && now >= temporaryMessageUntil) {
    temporaryMessageUntil = 0;
    showCurrentState();
  }
}

void setBuzzer(bool enabled) {
  if (enabled) {
    tone(BUZZER_PIN, BUZZER_TONE_HZ);
  } else {
    noTone(BUZZER_PIN);
    digitalWrite(BUZZER_PIN, LOW);
  }
}

void setup() {
  Serial.begin(115200);
  const unsigned long serialStartAt = millis();
  while (!Serial && millis() - serialStartAt < 4000) {
    delay(50);
  }
  delay(500);
  Serial.println("\n[Boot] Smart Pillbox AI starting.");

  WiFi.onEvent(
    [](WiFiEvent_t event, WiFiEventInfo_t info) {
      Serial.printf("[WiFi] Disconnected. Reason=%u.\n",
                    info.wifi_sta_disconnected.reason);
    },
    WiFiEvent_t::ARDUINO_EVENT_WIFI_STA_DISCONNECTED
  );

  for (uint8_t index = 0; index < SLOT_COUNT; index++) {
    pinMode(REED_PINS[index], SLOT_ENABLED[index] ? INPUT : INPUT_PULLUP);
    pinMode(GREEN_LED_PINS[index], OUTPUT);
    digitalWrite(GREEN_LED_PINS[index], LOW);
    rawOpenState[index] = SLOT_ENABLED[index] ? readSlotOpen(index) : false;
    stableOpenState[index] = rawOpenState[index];
    rawChangedAt[index] = 0;
    if (SLOT_ENABLED[index]) {
      Serial.printf("[Sensor] Slot %u boot state: %s.\n", index + 1,
                    stableOpenState[index] ? "OPEN" : "CLOSED");
    }
  }

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(RED_LED_PIN, OUTPUT);
  setBuzzer(false);
  digitalWrite(RED_LED_PIN, LOW);
  setBuzzer(true);
  delay(200);
  setBuzzer(false);
  delay(200);
  setBuzzer(true);
  delay(200);
  setBuzzer(false);

  uint8_t oledAddress = 0;
  uint8_t oledSdaPin = OLED_SDA_PIN;
  uint8_t oledSclPin = OLED_SCL_PIN;
  const uint8_t oledPinPairs[2][2] = {
    {OLED_SDA_PIN, OLED_SCL_PIN},
    {OLED_SCL_PIN, OLED_SDA_PIN},
  };
  for (uint8_t pairIndex = 0; pairIndex < 2 && oledAddress == 0; pairIndex++) {
    if (pairIndex > 0) Wire.end();
    Wire.begin(oledPinPairs[pairIndex][0], oledPinPairs[pairIndex][1]);
    delay(10);
    for (uint8_t address = 0x3C; address <= 0x3D; address++) {
      Wire.beginTransmission(address);
      if (Wire.endTransmission() == 0) {
        oledAddress = address;
        oledSdaPin = oledPinPairs[pairIndex][0];
        oledSclPin = oledPinPairs[pairIndex][1];
        break;
      }
    }
  }
  oledReady = oledAddress != 0 &&
              display.begin(SSD1306_SWITCHCAPVCC, oledAddress, true, false);
  if (!oledReady) {
    Serial.println("[OLED] Display unavailable; continuing without it.");
  } else {
    Serial.printf("[OLED] SSD1306 initialized at 0x%02X (SDA=%u, SCL=%u).\n",
                  oledAddress, oledSdaPin, oledSclPin);
    showMessage("SMART PILLBOX", "CONNECTING WIFI");
  }

  startWifiConnection();
  Serial.println("[Boot] Sensor loop ready.");
}

void loop() {
  const unsigned long now = millis();
  scanReedSensors(now);
  maintainWifi(now);
  processEventQueue(now);
  pollDeviceState(now);
  uploadTelemetry(now);
  updateIndicators(now);
  delay(5);
}

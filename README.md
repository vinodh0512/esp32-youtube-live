# YouTube Live Poll Controlled ESP32 Backend

Production-ready Node.js Express backend that controls an ESP32 micro-controller **only through YouTube Live Polls**.

## Features

- 🎥 **YouTube Live Detection**: Automatically checks every 30 seconds for active live streams on your channel without crashing.
- 🗳️ **Live Poll Validation**: Accepts ONLY polls with exact Question `Control ESP32` and Options `ON`, `OFF`.
- 🚫 **Chat Message Filtering**: Completely ignores normal chat text, super chats, and member events.
- 🔒 **Duplicate Prevention**: Stores processed `pollId` in MongoDB to prevent duplicate command executions even across restarts.
- ⚡ **ESP32 API Endpoint**: Provides `GET /api/latest-command` for ESP32 polling every 2–5 seconds.
- ☁️ **Render Ready**: Auto-reconnection, environment port binding, and `/health` healthcheck endpoint.

---

## Installation & Setup

1. **Clone & Install Dependencies**:
   ```bash
   cd youtube-esp32-backend
   npm install
   ```

2. **Configure Environment Variables**:
   Copy `.env.example` to `.env` and fill in your details:
   ```env
   PORT=3000
   MONGODB_URI=mongodb://127.0.0.1:27017/youtube_esp32
   YOUTUBE_API_KEY=YOUR_YOUTUBE_DATA_API_KEY
   YOUTUBE_CHANNEL_ID=YOUR_YOUTUBE_CHANNEL_ID
   ```

3. **Start the Server**:
   ```bash
   npm start
   # or for development mode:
   npm run dev
   ```

---

## ESP32 Integration (C++ Arduino Sketch Snippet)

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";
const char* backendUrl = "https://your-app.onrender.com/api/latest-command";

const int RELAY_PIN = 2; // LED or Relay Pin

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected!");
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(backendUrl);
    int httpCode = http.GET();

    if (httpCode == HTTP_CODE_OK) {
      String payload = http.getString();
      StaticJsonDocument<200> doc;
      deserializeJson(doc, payload);

      const char* command = doc["command"]; // "ON", "OFF", or "NONE"
      if (strcmp(command, "ON") == 0) {
        digitalWrite(RELAY_PIN, HIGH);
      } else if (strcmp(command, "OFF") == 0) {
        digitalWrite(RELAY_PIN, LOW);
      }
    }
    http.end();
  }
  delay(3000); // Poll every 3 seconds
}
```

---

## API Endpoints

- `GET /api/latest-command`: Retrieves the latest command state for ESP32.
- `GET /health`: Health check endpoint for Render monitoring.
- `POST /api/test/trigger-poll`: Simulates a poll execution for testing without an active YouTube Live Stream.

---

## Deploying to Render

1. Create a **Web Service** on Render pointing to your repository.
2. Set Build Command: `npm install`
3. Set Start Command: `npm start`
4. Add Environment Variables:
   - `YOUTUBE_API_KEY`
   - `YOUTUBE_CHANNEL_ID`
   - `MONGODB_URI`

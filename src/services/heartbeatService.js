/**
 * Service for tracking ESP32 heartbeats and device online/offline status.
 */

let lastHeartbeatTimestamp = null;
let lastDeviceInfo = {
  deviceId: 'esp32-001',
  firmware: '1.0.0',
  ip: 'Unknown'
};

/**
 * Record an incoming heartbeat from ESP32.
 */
function recordHeartbeat(deviceData = {}) {
  lastHeartbeatTimestamp = Date.now();
  if (deviceData.deviceId) lastDeviceInfo.deviceId = deviceData.deviceId;
  if (deviceData.firmware) lastDeviceInfo.firmware = deviceData.firmware;
  if (deviceData.ip) lastDeviceInfo.ip = deviceData.ip;

  console.log(`[ESP32 Heartbeat] Heartbeat received from ${lastDeviceInfo.deviceId} (${lastDeviceInfo.ip})`);
}

/**
 * Get current ESP32 online/offline status and last seen duration.
 * Rule: Online if heartbeat received within last 60 seconds (<= 60s).
 *       Offline if > 60 seconds or no heartbeat received.
 */
function getHeartbeatStatus() {
  if (!lastHeartbeatTimestamp) {
    return {
      esp32Online: false,
      lastSeenSeconds: null,
      lastSeenText: 'Never',
      deviceInfo: lastDeviceInfo
    };
  }

  const diffMs = Date.now() - lastHeartbeatTimestamp;
  const secondsAgo = Math.floor(diffMs / 1000);
  const isOnline = secondsAgo <= 60;

  return {
    esp32Online: isOnline,
    lastSeenSeconds: secondsAgo,
    lastSeenText: isOnline ? `${secondsAgo} seconds ago` : `${secondsAgo} seconds ago (Offline)`,
    deviceInfo: lastDeviceInfo
  };
}

module.exports = {
  recordHeartbeat,
  getHeartbeatStatus
};

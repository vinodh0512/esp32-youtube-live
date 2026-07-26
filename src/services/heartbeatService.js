/**
 * Service for tracking ESP32 heartbeats and device online/offline status.
 */

let lastHeartbeatTimestamp = null;

/**
 * Record an incoming heartbeat from ESP32.
 */
function recordHeartbeat() {
  lastHeartbeatTimestamp = Date.now();
  console.log(`[ESP32 Heartbeat] Heartbeat received at ${new Date(lastHeartbeatTimestamp).toISOString()}`);
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
      lastSeenText: 'Never'
    };
  }

  const diffMs = Date.now() - lastHeartbeatTimestamp;
  const secondsAgo = Math.floor(diffMs / 1000);
  const isOnline = secondsAgo <= 60;

  return {
    esp32Online: isOnline,
    lastSeenSeconds: secondsAgo,
    lastSeenText: isOnline ? `${secondsAgo} seconds ago` : `${secondsAgo} seconds ago (Offline)`
  };
}

module.exports = {
  recordHeartbeat,
  getHeartbeatStatus
};

const { getLatestCommandState, getStreamStatus, getDashboardState } = require('../services/pollMonitorService');
const { getApiCallCount } = require('../services/youtubeService');
const { recordHeartbeat, getHeartbeatStatus } = require('../services/heartbeatService');
const { broadcastDashboardUpdate } = require('../services/webSocketService');

let lastLoggedFetchTime = 0;

/**
 * GET /api/latest-command
 */
const getLatestCommand = (req, res) => {
  try {
    const dashboardState = getDashboardState();
    const currentState = getLatestCommandState();

    // Log ESP32 fetch event
    const now = Date.now();
    if (now - lastLoggedFetchTime > 3000) {
      console.log('ESP32 fetched command');
      lastLoggedFetchTime = now;
    }

    // While poll is active, ESP32 receives command: "NONE" with current version
    if (dashboardState.pollActive) {
      return res.status(200).json({
        command: 'NONE',
        version: currentState.version || 0
      });
    }

    // When poll finishes, ESP32 receives final command and version
    return res.status(200).json({
      command: currentState.command || 'NONE',
      version: currentState.version || 1
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to retrieve latest command',
      message: error.message
    });
  }
};

/**
 * GET /api/dashboard
 * Consolidated single endpoint for OBS Overlay and Dashboard monitoring UI.
 */
const getDashboardData = (req, res) => {
  try {
    const dashboardState = getDashboardState();
    return res.status(200).json(dashboardState);
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to retrieve dashboard data',
      message: error.message
    });
  }
};

/**
 * POST /api/heartbeat
 * ESP32 sends a heartbeat every 30 seconds.
 */
const handleHeartbeat = (req, res) => {
  try {
    recordHeartbeat(req.body);
    console.log('Heartbeat received');
    const status = getHeartbeatStatus();
    
    // Broadcast real-time update over WebSocket
    broadcastDashboardUpdate(getDashboardState());

    return res.status(200).json({
      status: 'ok',
      esp32Online: status.esp32Online,
      lastSeenSeconds: status.lastSeenSeconds,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Heartbeat processing failed',
      message: error.message
    });
  }
};

/**
 * GET /api/heartbeat
 * Retrieve ESP32 heartbeat and online/offline status.
 */
const getHeartbeat = (req, res) => {
  try {
    const status = getHeartbeatStatus();
    return res.status(200).json(status);
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to retrieve heartbeat status',
      message: error.message
    });
  }
};

/**
 * GET /api/stats
 * Provides real-time metrics (API request count, stream status).
 */
const getSystemStats = (req, res) => {
  try {
    const currentState = getLatestCommandState();
    return res.status(200).json({
      latestCommand: currentState,
      sessionApiRequests: getApiCallCount(),
      isLiveStreamActive: getStreamStatus(),
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to retrieve system stats',
      message: error.message
    });
  }
};

module.exports = {
  getLatestCommand,
  getDashboardData,
  handleHeartbeat,
  getHeartbeat,
  getSystemStats
};

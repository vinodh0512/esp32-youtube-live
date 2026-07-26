const { getLatestCommandState, getStreamStatus, getDashboardState, setSystemMonitoring, getSystemMonitoring } = require('../services/pollMonitorService');
const { getApiCallCount, setVideoIdOverride, getVideoIdOverride } = require('../services/youtubeService');
const { recordHeartbeat, getHeartbeatStatus } = require('../services/heartbeatService');
const { broadcastDashboardUpdate } = require('../services/webSocketService');

let lastLoggedFetchTime = 0;

/**
 * GET /api/latest-command
 * Always returns the latest executed command ("ON" or "OFF") and its version for the ESP32.
 */
const getLatestCommand = (req, res) => {
  try {
    const currentState = getLatestCommandState();

    // Log ESP32 fetch event
    const now = Date.now();
    if (now - lastLoggedFetchTime > 3000) {
      console.log(`ESP32 fetched command -> ${currentState.command} (Version ${currentState.version || 0})`);
      lastLoggedFetchTime = now;
    }

    return res.status(200).json({
      command: currentState.command || 'NONE',
      version: currentState.version || 0
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
 */
const getDashboardData = (req, res) => {
  try {
    const dashboardState = getDashboardState();
    return res.status(200).json(dashboardState);
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to retrieve dashboard state',
      message: error.message
    });
  }
};

/**
 * POST /api/heartbeat
 */
const handleHeartbeat = (req, res) => {
  try {
    const { deviceId, firmware, ip } = req.body || {};
    const updatedStatus = recordHeartbeat({ deviceId, firmware, ip });

    // Broadcast heartbeat status change via WebSockets
    broadcastDashboardUpdate(getDashboardState());

    return res.status(200).json({
      status: 'ok',
      esp32Online: updatedStatus.esp32Online,
      lastSeenSeconds: updatedStatus.lastSeenSeconds,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to process heartbeat',
      message: error.message
    });
  }
};

/**
 * GET /api/heartbeat
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
 */
const getSystemStats = (req, res) => {
  try {
    return res.status(200).json({
      apiCalls: getApiCallCount(),
      streamLive: getStreamStatus(),
      heartbeat: getHeartbeatStatus()
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to retrieve system stats',
      message: error.message
    });
  }
};

/**
 * POST /api/stream/config
 * Dynamic Video ID override endpoint.
 */
const updateStreamConfig = (req, res) => {
  try {
    const { videoId } = req.body || {};
    setVideoIdOverride(videoId);
    broadcastDashboardUpdate(getDashboardState());
    return res.status(200).json({
      status: 'ok',
      videoId: getVideoIdOverride(),
      message: `Active YouTube Video ID updated to "${getVideoIdOverride()}"`
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to update YouTube stream config',
      message: error.message
    });
  }
};

/**
 * GET /api/stream/config
 */
const getStreamConfig = (req, res) => {
  try {
    return res.status(200).json({
      videoId: getVideoIdOverride()
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to fetch YouTube stream config',
      message: error.message
    });
  }
};

/**
 * POST /api/system/toggle
 * Manual Start/Stop Live Monitoring Button Endpoint
 */
const toggleSystemMonitoring = (req, res) => {
  try {
    const { active } = req.body || {};
    const newState = active !== undefined ? !!active : !getSystemMonitoring();
    setSystemMonitoring(newState);
    return res.status(200).json({
      status: 'ok',
      monitoringActive: getSystemMonitoring(),
      message: `Manual Live Monitoring set to ${getSystemMonitoring() ? 'ACTIVE' : 'STANDBY'}`
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to toggle system monitoring',
      message: error.message
    });
  }
};

/**
 * GET /api/system/status
 */
const getSystemMonitoringState = (req, res) => {
  try {
    return res.status(200).json({
      monitoringActive: getSystemMonitoring()
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to fetch system monitoring state',
      message: error.message
    });
  }
};

module.exports = {
  getLatestCommand,
  getDashboardData,
  handleHeartbeat,
  receiveHeartbeat: handleHeartbeat,
  getHeartbeat,
  getSystemStats,
  updateStreamConfig,
  getStreamConfig,
  toggleSystemMonitoring,
  getSystemMonitoringState
};

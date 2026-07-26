const express = require('express');
const router = express.Router();
const {
  getLatestCommand,
  getDashboardData,
  handleHeartbeat,
  getHeartbeat,
  getSystemStats,
  updateStreamConfig,
  getStreamConfig,
  toggleSystemMonitoring,
  getSystemMonitoringState
} = require('../controllers/commandController');

router.get('/latest-command', getLatestCommand);
router.get('/dashboard', getDashboardData);
router.post('/heartbeat', handleHeartbeat);
router.get('/heartbeat', getHeartbeat);
router.get('/stats', getSystemStats);
router.post('/stream/config', updateStreamConfig);
router.get('/stream/config', getStreamConfig);
router.post('/system/toggle', toggleSystemMonitoring);
router.get('/system/status', getSystemMonitoringState);

module.exports = router;

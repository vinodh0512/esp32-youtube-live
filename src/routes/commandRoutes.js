const express = require('express');
const router = express.Router();
const {
  getLatestCommand,
  getDashboardData,
  handleHeartbeat,
  getHeartbeat,
  getSystemStats
} = require('../controllers/commandController');

router.get('/latest-command', getLatestCommand);
router.get('/dashboard', getDashboardData);
router.post('/heartbeat', handleHeartbeat);
router.get('/heartbeat', getHeartbeat);
router.get('/stats', getSystemStats);

module.exports = router;

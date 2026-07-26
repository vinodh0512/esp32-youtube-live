const express = require('express');
const router = express.Router();
const { run30SecondLivePollSim, getDashboardState } = require('../services/pollMonitorService');
const { recordHeartbeat, getHeartbeatStatus } = require('../services/heartbeatService');

/**
 * POST /api/test/trigger-poll
 * Initiates a 30-second live poll simulation with live vote updates streaming every 1 second.
 */
router.post('/trigger-poll', async (req, res) => {
  try {
    const {
      question = 'Control ESP32',
      votes = { ON: 145, OFF: 132 }
    } = req.body;

    const onVotesTarget = votes.ON !== undefined ? votes.ON : 145;
    const offVotesTarget = votes.OFF !== undefined ? votes.OFF : 132;

    // Start 30-second live poll loop streaming updates every 1s
    run30SecondLivePollSim(onVotesTarget, offVotesTarget, question);

    return res.status(200).json({
      message: '30-second live poll simulation initiated',
      dashboard: getDashboardState()
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Simulation failed',
      message: error.message
    });
  }
});

/**
 * POST /api/test/sim-heartbeat
 * Simulate heartbeat for manual test suite or frontend dev controls.
 */
router.post('/sim-heartbeat', (req, res) => {
  try {
    recordHeartbeat();
    return res.status(200).json({
      message: 'Heartbeat simulated successfully',
      status: getHeartbeatStatus()
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Heartbeat simulation failed',
      message: error.message
    });
  }
});

module.exports = router;

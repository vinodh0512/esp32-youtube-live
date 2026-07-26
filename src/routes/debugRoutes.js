const express = require('express');
const router = express.Router();
const {
  debugYouTubeDiagnostic,
  debugOAuth,
  debugLive,
  debugPoll,
  debugRawYouTubeResponse,
  debugVotes,
  getDebugStatus
} = require('../controllers/debugController');

router.get('/youtube', debugYouTubeDiagnostic);
router.get('/oauth', debugOAuth);
router.get('/live', debugLive);
router.get('/poll', debugPoll);
router.get('/youtube-response', debugRawYouTubeResponse);
router.get('/votes', debugVotes);
router.get('/status', getDebugStatus);

module.exports = router;

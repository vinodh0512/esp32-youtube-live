const {
  verifyOAuthStatus,
  findActiveLiveStream,
  getLiveChatId,
  getLiveChatMessages,
  getRawYouTubeResponses,
  getLastApiCallTimestamp,
  getApiCallCount
} = require('../services/youtubeService');
const {
  getStreamStatus,
  getLiveStreamDetails,
  getCurrentPollDetails,
  getLatestCommandState
} = require('../services/pollMonitorService');
const env = require('../config/env');

/**
 * GET /api/debug/oauth
 * Verifies OAuth token validity, expiration, and authenticated channel details.
 */
const debugOAuth = async (req, res) => {
  try {
    const oauthResult = await verifyOAuthStatus();
    return res.status(200).json(oauthResult);
  } catch (error) {
    return res.status(500).json({
      authenticated: false,
      tokenValid: false,
      error: error.message
    });
  }
};

/**
 * GET /api/debug/live
 * Calls real YouTube Data API v3 to check active broadcast & chat IDs.
 */
const debugLive = async (req, res) => {
  try {
    const liveStream = await findActiveLiveStream(
      env.youtubeChannelId,
      env.youtubeApiKey,
      env.youtubeVideoId
    );

    if (!liveStream) {
      console.log('[Debug Live] No active broadcast found');
      return res.status(200).json({
        liveDetected: false,
        reason: 'No active broadcast found'
      });
    }

    const liveChatId = await getLiveChatId(liveStream.videoId, env.youtubeApiKey);

    const responsePayload = {
      liveDetected: true,
      broadcastId: liveStream.videoId || liveStream.broadcastId,
      liveChatId: liveChatId || 'Not Available',
      title: liveStream.title || 'Live Stream',
      lifeCycleStatus: liveStream.lifeCycleStatus || 'live'
    };

    console.log(`[Debug Live] Live Stream Detected! Broadcast ID: ${responsePayload.broadcastId} | Live Chat ID: ${responsePayload.liveChatId}`);
    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(500).json({
      liveDetected: false,
      error: error.message
    });
  }
};

/**
 * GET /api/debug/poll
 * Verifies if an active YouTube Live poll is detected.
 */
const debugPoll = async (req, res) => {
  try {
    const currentPoll = getCurrentPollDetails();

    if (currentPoll && currentPoll.pollActive) {
      return res.status(200).json({
        pollDetected: true,
        pollId: currentPoll.pollId || `poll-${Date.now()}`,
        question: currentPoll.question || 'Control ESP32',
        options: ['ON', 'OFF'],
        onVotes: currentPoll.onVotes || 0,
        offVotes: currentPoll.offVotes || 0,
        timeRemaining: currentPoll.timeRemaining || 0
      });
    }

    return res.status(200).json({
      pollDetected: false,
      reason: 'No active poll currently running'
    });
  } catch (error) {
    return res.status(500).json({
      pollDetected: false,
      error: error.message
    });
  }
};

/**
 * GET /api/debug/youtube-response
 * Returns the COMPLETE raw JSON received from YouTube Data API v3 without modification.
 */
const debugRawYouTubeResponse = (req, res) => {
  try {
    const rawResponses = getRawYouTubeResponses();
    return res.status(200).json(rawResponses);
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to retrieve raw YouTube API response',
      message: error.message
    });
  }
};

/**
 * GET /api/debug/votes
 * Returns poll options, current vote counts, and calculated winner.
 */
const debugVotes = (req, res) => {
  try {
    const currentPoll = getCurrentPollDetails();
    const latestCmd = getLatestCommandState();

    const onVotes = currentPoll.onVotes || 0;
    const offVotes = currentPoll.offVotes || 0;

    let winner = 'NONE';
    if (onVotes > offVotes) winner = 'ON';
    else if (offVotes > onVotes) winner = 'OFF';

    console.log(`Reading Poll...\nOption 1: ON\nOption 2: OFF\nVotes: ON = ${onVotes}, OFF = ${offVotes}\nWinner = ${winner}`);

    return res.status(200).json({
      option1: 'ON',
      option2: 'OFF',
      option1Votes: onVotes,
      option2Votes: offVotes,
      winner: currentPoll.winner || winner,
      lastCommand: latestCmd.command || 'NONE'
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to retrieve vote telemetry',
      message: error.message
    });
  }
};

/**
 * GET /api/debug/status
 * Consolidated Debug Panel API for the React Dashboard.
 */
const getDebugStatus = async (req, res) => {
  try {
    const oauth = await verifyOAuthStatus();
    const streamDetails = getLiveStreamDetails();
    const currentPoll = getCurrentPollDetails();
    const latestCmd = getLatestCommandState();

    return res.status(200).json({
      oauth: {
        connected: oauth.authenticated,
        channelId: oauth.channelId || 'N/A',
        channelTitle: oauth.channelTitle || 'N/A',
        expiry: oauth.tokenExpiry || 'N/A'
      },
      live: {
        detected: streamDetails.isLive,
        broadcastId: streamDetails.broadcastId || 'N/A',
        liveChatId: streamDetails.liveChatId || 'N/A',
        title: streamDetails.title || 'N/A'
      },
      poll: {
        active: currentPoll.pollActive,
        question: currentPoll.question || 'Control ESP32',
        onVotes: currentPoll.onVotes || 0,
        offVotes: currentPoll.offVotes || 0,
        winner: currentPoll.winner || latestCmd.command || 'NONE'
      },
      lastApiCall: getLastApiCallTimestamp(),
      totalApiCalls: getApiCallCount()
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to retrieve debug status panel data',
      message: error.message
    });
  }
};

module.exports = {
  debugOAuth,
  debugLive,
  debugPoll,
  debugRawYouTubeResponse,
  debugVotes,
  getDebugStatus
};

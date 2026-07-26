const {
  verifyOAuthStatus,
  findActiveLiveStream,
  getLiveChatId,
  getLiveChatMessages,
  getYouTubeDiagnosticData,
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
 * STEP 5: GET /api/debug/youtube
 * Complete YouTube API diagnostic state payload.
 */
const debugYouTubeDiagnostic = async (req, res) => {
  try {
    const oauth = await verifyOAuthStatus();
    const streamDetails = getLiveStreamDetails();
    const diagnostic = getYouTubeDiagnosticData();

    return res.status(200).json({
      oauth: {
        authenticated: oauth.authenticated,
        tokenValid: oauth.tokenValid,
        tokenExpiry: oauth.tokenExpiry || null,
        reason: oauth.reason || null
      },
      channel: {
        channelId: oauth.channelId || 'Unknown',
        channelTitle: oauth.channelTitle || 'Unknown'
      },
      broadcast: {
        detected: streamDetails.isLive,
        broadcastId: streamDetails.broadcastId || null,
        title: streamDetails.title || null
      },
      liveChat: {
        liveChatId: streamDetails.liveChatId || null
      },
      lastApiRequest: diagnostic.lastApiRequest || {},
      lastApiResponse: diagnostic.lastApiResponse || {},
      detectedEventTypes: diagnostic.detectedEventTypes || [],
      rawMessages: diagnostic.rawMessages || [],
      lastDetectedPoll: diagnostic.lastDetectedPoll || null,
      pollWarning: diagnostic.pollWarning || null
    });
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to retrieve YouTube diagnostic payload',
      message: error.message
    });
  }
};

/**
 * GET /api/debug/oauth
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
 */
const debugLive = async (req, res) => {
  try {
    const liveStream = await findActiveLiveStream(
      env.youtubeChannelId,
      env.youtubeApiKey,
      env.youtubeVideoId
    );

    if (!liveStream) {
      return res.status(200).json({
        liveDetected: false,
        reason: 'No active broadcast found'
      });
    }

    const liveChatId = await getLiveChatId(liveStream.videoId, env.youtubeApiKey);

    return res.status(200).json({
      liveDetected: true,
      broadcastId: liveStream.videoId || liveStream.broadcastId,
      liveChatId: liveChatId || 'Not Available',
      title: liveStream.title || 'Live Stream',
      lifeCycleStatus: liveStream.lifeCycleStatus || 'live'
    });
  } catch (error) {
    return res.status(500).json({
      liveDetected: false,
      error: error.message
    });
  }
};

/**
 * GET /api/debug/poll
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
 */
const debugRawYouTubeResponse = (req, res) => {
  try {
    const diagnostic = getYouTubeDiagnosticData();
    return res.status(200).json(diagnostic);
  } catch (error) {
    return res.status(500).json({
      error: 'Failed to retrieve raw YouTube API response',
      message: error.message
    });
  }
};

/**
 * GET /api/debug/votes
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
 */
const getDebugStatus = async (req, res) => {
  try {
    const oauth = await verifyOAuthStatus();
    const streamDetails = getLiveStreamDetails();
    const currentPoll = getCurrentPollDetails();
    const latestCmd = getLatestCommandState();
    const diagnostic = getYouTubeDiagnosticData();

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
      detectedEventTypes: diagnostic.detectedEventTypes || [],
      pollWarning: diagnostic.pollWarning || null,
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
  debugYouTubeDiagnostic,
  debugOAuth,
  debugLive,
  debugPoll,
  debugRawYouTubeResponse,
  debugVotes,
  getDebugStatus
};

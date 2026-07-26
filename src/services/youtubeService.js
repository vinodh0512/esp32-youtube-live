/**
 * Service to interact with YouTube Data API v3 with complete diagnostic logging & event type tracking.
 */
const env = require('../config/env');

let apiCallCounter = 0;
let cachedAccessToken = null;
let tokenExpiresAt = 0;

// Detailed Diagnostics Caches for Debug Endpoints & Dashboard Debug Panel
let lastApiRequestInfo = {};
let lastApiResponseInfo = {};
let detectedEventTypesSet = new Set();
let rawMessagesHistory = [];
let lastDetectedPoll = null;
let pollWarningLogged = false;

function getApiCallCount() {
  return apiCallCounter;
}

function getLastApiCallTimestamp() {
  if (!lastApiRequestInfo.timestamp) return 'Never';
  return new Date(lastApiRequestInfo.timestamp).toLocaleTimeString('en-US', { hour12: false });
}

/**
 * STEP 1: Log every request sent to YouTube.
 */
function logRequest(method, url, headers = {}, params = {}) {
  const timestamp = new Date().toISOString();
  lastApiRequestInfo = {
    timestamp,
    method,
    url,
    hasOAuthToken: !!headers['Authorization'],
    hasApiKey: url.includes('key='),
    params
  };

  console.log('\n====================================');
  console.log(`YOUTUBE API REQUEST [${timestamp}]`);
  console.log(`Method: ${method}`);
  console.log(`URL: ${url}`);
  console.log(`OAuth Authenticated: ${lastApiRequestInfo.hasOAuthToken ? 'YES (Bearer Token)' : 'NO (API Key)'}`);
  console.log('====================================\n');
}

/**
 * STEP 2: Log every response received from YouTube.
 */
function logResponse(status, headers = {}, rawJson = {}) {
  lastApiResponseInfo = {
    timestamp: new Date().toISOString(),
    status,
    headers,
    rawJson
  };

  console.log('====================================');
  console.log(`YOUTUBE API RESPONSE [HTTP ${status}]`);
  console.log('Raw JSON Payload:');
  console.log(JSON.stringify(rawJson, null, 2));
  console.log('====================================\n');
}

/**
 * STEP 3 & STEP 4: Inspect every message item, extract event types, and log details.
 */
function inspectAndTrackChatItems(items) {
  if (!Array.isArray(items)) return;

  for (const item of items) {
    if (!item) continue;

    const messageId = item.id || 'N/A';
    const snippet = item.snippet || {};
    const eventType = snippet.type || 'unknownEventType';
    const publishedAt = snippet.publishedAt || 'N/A';
    const author = (item.authorDetails && item.authorDetails.displayName) || 'Unknown Author';
    const displayMessage = snippet.displayMessage || snippet.textMessageDetails?.messageText || 'N/A';

    // Track event type
    detectedEventTypesSet.add(eventType);

    // Save to history (keep last 50 raw messages)
    rawMessagesHistory.unshift({
      id: messageId,
      type: eventType,
      publishedAt,
      author,
      displayMessage,
      snippet,
      rawItem: item
    });
    if (rawMessagesHistory.length > 50) rawMessagesHistory.pop();

    console.log(`[Chat Event] ID: ${messageId} | Type: ${eventType} | Published: ${publishedAt} | Author: ${author} | Message: "${displayMessage}"`);

    // STEP 6: Immediate logging if a poll event is detected
    if (
      eventType.toLowerCase().includes('poll') ||
      snippet.pollDetails ||
      snippet.pollOpenedDetails ||
      snippet.pollClosedDetails ||
      snippet.pollVotedDetails ||
      item.pollId
    ) {
      lastDetectedPoll = {
        timestamp: new Date().toISOString(),
        eventType,
        id: messageId,
        snippet,
        item
      };

      console.log('\n====================================');
      console.log('POLL DETECTED');
      console.log(`Event Type: ${eventType}`);
      console.log(`Message ID: ${messageId}`);
      console.log(`Question: ${snippet.pollDetails?.questionText || snippet.pollOpenedDetails?.questionText || 'N/A'}`);
      console.log('Complete JSON:', JSON.stringify(item, null, 2));
      console.log('====================================\n');
    }
  }

  // STEP 7: Warning log if NO poll event exists in the chat items array
  const hasPollInBatch = items.some(item => {
    const type = (item.snippet && item.snippet.type) || '';
    return type.toLowerCase().includes('poll') || item.snippet?.pollDetails || item.snippet?.pollOpenedDetails;
  });

  if (!hasPollInBatch && items.length > 0 && !pollWarningLogged) {
    pollWarningLogged = true;
    console.warn('\n----------------------------------------------------');
    console.warn('WARNING: No YouTube Live Poll event exists in the API response.');
    console.warn('This may indicate:');
    console.warn('- Unsupported API feature (YouTube Data API v3 liveChatMessages does not return poll events)');
    console.warn('- Incorrect API endpoint or missing OAuth scopes');
    console.warn('- YouTube Data API v3 platform limitation');
    console.warn('----------------------------------------------------\n');
  }
}

/**
 * Refresh OAuth 2.0 access token.
 */
async function getOAuthAccessToken() {
  if (!env.youtubeRefreshToken || !env.youtubeClientId || !env.youtubeClientSecret) {
    return null;
  }

  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedAccessToken;
  }

  try {
    const url = 'https://oauth2.googleapis.com/token';
    logRequest('POST', url, {}, { grant_type: 'refresh_token' });

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.youtubeClientId,
        client_secret: env.youtubeClientSecret,
        refresh_token: env.youtubeRefreshToken,
        grant_type: 'refresh_token'
      })
    });

    const data = await res.json();
    logResponse(res.status, res.headers, data);

    if (res.ok) {
      cachedAccessToken = data.access_token;
      tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
      console.log('OAuth Success | Access Token Refreshed');
      return cachedAccessToken;
    } else {
      console.error(`OAuth Failed | HTTP ${res.status}:`, data);
    }
  } catch (error) {
    console.error('OAuth Failed | Network error:', error.message);
  }
  return null;
}

/**
 * Verify OAuth status and channel info.
 */
async function verifyOAuthStatus() {
  const token = await getOAuthAccessToken();
  if (!token) {
    return {
      authenticated: false,
      tokenValid: false,
      reason: 'Missing or invalid OAuth refresh token credentials'
    };
  }

  try {
    const rawUrl = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';
    logRequest('GET', rawUrl, { Authorization: `Bearer ${token}` });

    const res = await fetch(rawUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const data = await res.json();
    logResponse(res.status, res.headers, data);
    apiCallCounter++;

    if (res.ok && data.items && data.items.length > 0) {
      const channel = data.items[0];
      return {
        authenticated: true,
        tokenValid: true,
        tokenExpiry: new Date(tokenExpiresAt).toISOString(),
        channelId: channel.id,
        channelTitle: channel.snippet.title
      };
    }

    return {
      authenticated: false,
      tokenValid: false,
      reason: `HTTP ${res.status} - Channel info not found`
    };
  } catch (error) {
    return {
      authenticated: false,
      tokenValid: false,
      reason: error.message
    };
  }
}

/**
 * Helper to build authenticated headers & URL parameters.
 */
async function buildAuthParams(baseUrl) {
  const token = await getOAuthAccessToken();
  const headers = {};
  let fullUrl = baseUrl;

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (env.youtubeApiKey) {
    const separator = baseUrl.includes('?') ? '&' : '?';
    fullUrl += `${separator}key=${encodeURIComponent(env.youtubeApiKey)}`;
  }

  return { fullUrl, headers };
}

/**
 * Detects active live stream.
 */
async function findActiveLiveStream(channelId, apiKey, overrideVideoId = '') {
  if (overrideVideoId && overrideVideoId.trim() !== '') {
    return {
      videoId: overrideVideoId.trim(),
      broadcastId: overrideVideoId.trim(),
      title: 'Configured Video ID Override',
      lifeCycleStatus: 'live'
    };
  }

  try {
    let rawUrl = 'https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status&broadcastStatus=active';
    let { fullUrl, headers } = await buildAuthParams(rawUrl);

    logRequest('GET', fullUrl, headers);
    let res = await fetch(fullUrl, { headers });
    apiCallCounter++;

    let data = {};
    if (res.ok) {
      data = await res.json();
      logResponse(res.status, res.headers, data);
    } else if (channelId) {
      rawUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&type=video&eventType=live`;
      const auth = await buildAuthParams(rawUrl);
      logRequest('GET', auth.fullUrl, auth.headers);
      res = await fetch(auth.fullUrl, { headers: auth.headers });
      if (res.ok) data = await res.json();
      logResponse(res ? res.status : 500, res ? res.headers : {}, data);
    }

    if (data.items && data.items.length > 0) {
      const item = data.items[0];
      const videoId = item.id.videoId || item.id;
      return {
        videoId,
        broadcastId: videoId,
        title: item.snippet ? item.snippet.title : 'Live Broadcast',
        lifeCycleStatus: item.status ? item.status.lifeCycleStatus : 'live'
      };
    }
    return null;
  } catch (error) {
    console.error('Find Active Live Stream Error:', error.message);
    return null;
  }
}

/**
 * Fetches active liveChatId for a video ID.
 */
async function getLiveChatId(videoId, apiKey) {
  if (!videoId) return null;

  try {
    const rawUrl = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}`;
    const { fullUrl, headers } = await buildAuthParams(rawUrl);

    logRequest('GET', fullUrl, headers);
    const res = await fetch(fullUrl, { headers });
    apiCallCounter++;

    const data = await res.json();
    logResponse(res.status, res.headers, data);

    if (data.items && data.items.length > 0) {
      const details = data.items[0].liveStreamingDetails;
      if (details && details.activeLiveChatId) {
        return details.activeLiveChatId;
      }
    }
    return null;
  } catch (error) {
    console.error('Get Live Chat ID Error:', error.message);
    return null;
  }
}

/**
 * Fetches live chat messages using pageToken.
 */
async function getLiveChatMessages(liveChatId, apiKey, pageToken = '') {
  const result = {
    items: [],
    nextPageToken: null,
    pollingIntervalMillis: 5000
  };

  if (!liveChatId) return result;

  try {
    let rawUrl = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${encodeURIComponent(
      liveChatId
    )}&part=snippet,authorDetails`;

    if (pageToken) {
      rawUrl += `&pageToken=${encodeURIComponent(pageToken)}`;
    }

    const { fullUrl, headers } = await buildAuthParams(rawUrl);
    logRequest('GET', fullUrl, headers);

    const res = await fetch(fullUrl, { headers });
    apiCallCounter++;

    const data = await res.json();
    logResponse(res.status, res.headers, data);

    result.items = data.items || [];
    result.nextPageToken = data.nextPageToken || null;
    result.pollingIntervalMillis = data.pollingIntervalMillis || 5000;

    // STEP 3 & STEP 4: Inspect all chat items and track event types
    inspectAndTrackChatItems(result.items);

    return result;
  } catch (error) {
    console.error('Get Live Chat Messages Error:', error.message);
    return result;
  }
}

/**
 * STEP 5: Returns complete diagnostic object for GET /api/debug/youtube
 */
function getYouTubeDiagnosticData() {
  return {
    lastApiRequest: lastApiRequestInfo,
    lastApiResponse: lastApiResponseInfo,
    detectedEventTypes: Array.from(detectedEventTypesSet),
    rawMessages: rawMessagesHistory.slice(0, 20),
    lastDetectedPoll,
    pollWarning: detectedEventTypesSet.size > 0 && !lastDetectedPoll ? 'Live Poll events are not available from the current YouTube API response.' : null
  };
}

module.exports = {
  findActiveLiveStream,
  getLiveChatId,
  getLiveChatMessages,
  getApiCallCount,
  getLastApiCallTimestamp,
  verifyOAuthStatus,
  getYouTubeDiagnosticData
};

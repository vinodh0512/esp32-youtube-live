/**
 * Service to interact with YouTube Data API v3 with diagnostic logging & live chat command parsing.
 */
const env = require('../config/env');

let apiCallCounter = 0;
let cachedAccessToken = null;
let tokenExpiresAt = 0;
let activeVideoIdOverride = env.youtubeVideoId || '';

// Detailed Diagnostics Caches for Debug Endpoints & Dashboard Debug Panel
let lastApiRequestInfo = {};
let lastApiResponseInfo = {};
let detectedEventTypesSet = new Set();
let rawMessagesHistory = [];

function getApiCallCount() {
  return apiCallCounter;
}

function getLastApiCallTimestamp() {
  if (!lastApiRequestInfo.timestamp) return 'Never';
  return new Date(lastApiRequestInfo.timestamp).toLocaleTimeString('en-US', { hour12: false });
}

function setVideoIdOverride(videoId) {
  activeVideoIdOverride = (videoId || '').trim();
  console.log(`[YouTube Config] Active Video ID set to: "${activeVideoIdOverride}"`);
}

function getVideoIdOverride() {
  return activeVideoIdOverride;
}

/**
 * Log every request sent to YouTube.
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
 * Log every response received from YouTube.
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
  console.log('Raw JSON Payload Summary:', rawJson ? (rawJson.items ? `${rawJson.items.length} items` : 'Object') : 'Empty');
  console.log('====================================\n');
}

/**
 * Inspect every message item, extract event types, and log details.
 */
function inspectAndTrackChatItems(items) {
  if (!Array.isArray(items)) return;

  for (const item of items) {
    if (!item) continue;

    const messageId = item.id || 'N/A';
    const snippet = item.snippet || {};
    const eventType = snippet.type || 'textMessageEvent';
    const publishedAt = snippet.publishedAt || 'N/A';
    const author = (item.authorDetails && item.authorDetails.displayName) || 'Unknown Author';
    const displayMessage = snippet.displayMessage || snippet.textMessageDetails?.messageText || 'N/A';

    detectedEventTypesSet.add(eventType);

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
 * Detects active live stream. Verifies whether configured video ID is still live!
 */
async function findActiveLiveStream(channelId, apiKey, overrideVideoId = '') {
  const targetVideoId = activeVideoIdOverride || overrideVideoId;
  if (targetVideoId && targetVideoId.trim() !== '') {
    // Check if the configured video ID is still live via videos.list
    try {
      const rawUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${encodeURIComponent(targetVideoId.trim())}`;
      const { fullUrl, headers } = await buildAuthParams(rawUrl);
      logRequest('GET', fullUrl, headers);
      const res = await fetch(fullUrl, { headers });
      apiCallCounter++;

      if (res.ok) {
        const data = await res.json();
        logResponse(res.status, res.headers, data);
        if (data.items && data.items.length > 0) {
          const item = data.items[0];
          const details = item.liveStreamingDetails;
          
          // Stream has ENDED if actualEndTime exists or liveChatId is missing
          if (details && (details.actualEndTime || !details.activeLiveChatId)) {
            console.log(`[YouTube Stream Check] Video ${targetVideoId.trim()} has ENDED.`);
            return null;
          }

          return {
            videoId: targetVideoId.trim(),
            broadcastId: targetVideoId.trim(),
            title: item.snippet ? item.snippet.title : `Live Broadcast (${targetVideoId.trim()})`,
            lifeCycleStatus: 'live'
          };
        }
      }
    } catch (e) {
      console.warn('[Video Details Verification Error]', e.message);
    }
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
 * Fetches active liveChatId for a video ID. Checks if stream has ended.
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
      if (details) {
        if (details.actualEndTime) {
          console.log(`[YouTube Live Status] Stream ${videoId} has ENDED.`);
          return null;
        }
        if (details.activeLiveChatId) {
          return details.activeLiveChatId;
        }
      }
    }
    return null;
  } catch (error) {
    console.error('Get Live Chat ID Error:', error.message);
    return null;
  }
}

/**
 * Fetches live chat messages using pageToken. Detects if stream/chat has ended.
 */
async function getLiveChatMessages(liveChatId, apiKey, pageToken = '') {
  const result = {
    items: [],
    nextPageToken: null,
    pollingIntervalMillis: 3000,
    isEnded: false
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

    if (!res.ok || (data.error && data.error.code >= 400)) {
      const reason = data.error?.errors?.[0]?.reason || '';
      if (
        reason === 'liveChatEnded' ||
        reason === 'liveChatNotFound' ||
        reason === 'liveChatDisabled' ||
        res.status === 404
      ) {
        console.warn(`[YouTube Live Chat] Chat ended or disabled (Reason: ${reason || res.status})`);
        result.isEnded = true;
        return result;
      }
    }

    result.items = data.items || [];
    result.nextPageToken = data.nextPageToken || null;
    result.pollingIntervalMillis = data.pollingIntervalMillis || 3000;

    inspectAndTrackChatItems(result.items);

    return result;
  } catch (error) {
    console.error('Get Live Chat Messages Error:', error.message);
    return result;
  }
}

/**
 * Returns complete diagnostic object for GET /api/debug/youtube
 */
function getYouTubeDiagnosticData() {
  return {
    lastApiRequest: lastApiRequestInfo,
    lastApiResponse: lastApiResponseInfo,
    detectedEventTypes: Array.from(detectedEventTypesSet),
    rawMessages: rawMessagesHistory.slice(0, 20),
    activeVideoIdOverride
  };
}

module.exports = {
  findActiveLiveStream,
  getLiveChatId,
  getLiveChatMessages,
  getApiCallCount,
  getLastApiCallTimestamp,
  verifyOAuthStatus,
  getYouTubeDiagnosticData,
  setVideoIdOverride,
  getVideoIdOverride
};

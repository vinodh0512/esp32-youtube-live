/**
 * Service to interact with YouTube Data API v3 with quota tracking, OAuth2, logging, and raw response debugging.
 */
const env = require('../config/env');

let apiCallCounter = 0;
let cachedAccessToken = null;
let tokenExpiresAt = 0;
let lastApiCallTimestamp = null;

// Debug Caches for Raw API Responses
let lastRawBroadcastResponse = null;
let lastRawChatResponse = null;
let lastRawPollExtracted = null;

/**
 * Returns total session YouTube API requests.
 */
function getApiCallCount() {
  return apiCallCounter;
}

/**
 * Returns last API call timestamp formatted as HH:MM:SS.
 */
function getLastApiCallTimestamp() {
  if (!lastApiCallTimestamp) return 'Never';
  return new Date(lastApiCallTimestamp).toLocaleTimeString('en-US', { hour12: false });
}

/**
 * Log YouTube API requests with status codes and summary.
 */
function logApiRequest(method, endpoint, statusCode, summary = '', details = '') {
  lastApiCallTimestamp = Date.now();
  const timeStr = new Date().toLocaleTimeString();
  console.log(`[${timeStr}] [YouTube API] ${method} ${endpoint} | HTTP ${statusCode} | ${summary} ${details}`.trim());
}

/**
 * Log error messages clearly.
 */
function logApiError(errorType, message, details = '') {
  console.error(`[YouTube API Error] ${errorType}: ${message} ${details}`.trim());
}

/**
 * Refresh OAuth 2.0 access token if refresh token credentials are provided.
 */
async function getOAuthAccessToken() {
  if (!env.youtubeRefreshToken || !env.youtubeClientId || !env.youtubeClientSecret) {
    return null;
  }

  // Return cached token if valid
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedAccessToken;
  }

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.youtubeClientId,
        client_secret: env.youtubeClientSecret,
        refresh_token: env.youtubeRefreshToken,
        grant_type: 'refresh_token'
      })
    });

    if (res.ok) {
      const data = await res.json();
      cachedAccessToken = data.access_token;
      tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;
      console.log('OAuth Success');
      return cachedAccessToken;
    } else {
      const errText = await res.text();
      logApiError('OAuth Failed', `HTTP ${res.status} - Invalid Refresh Token or Client Credentials`, errText);
    }
  } catch (error) {
    logApiError('OAuth Error', 'Network error refreshing OAuth token:', error.message);
  }
  return null;
}

/**
 * Verify OAuth token status and channel details.
 */
async function verifyOAuthStatus() {
  const token = await getOAuthAccessToken();
  if (!token) {
    return {
      authenticated: false,
      tokenValid: false,
      reason: 'Missing or invalid OAuth credentials (YOUTUBE_REFRESH_TOKEN / CLIENT_ID / CLIENT_SECRET)'
    };
  }

  try {
    const rawUrl = 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';
    const res = await fetch(rawUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    apiCallCounter++;
    if (res.ok) {
      const data = await res.json();
      const channel = data.items && data.items[0];
      const result = {
        authenticated: true,
        tokenValid: true,
        tokenExpiry: new Date(tokenExpiresAt).toISOString(),
        channelId: channel ? channel.id : 'Unknown',
        channelTitle: channel ? channel.snippet.title : 'Unknown'
      };

      console.log(`OAuth Success | Authenticated Channel: ${result.channelTitle} | Channel ID: ${result.channelId} | Token Expiry: ${result.tokenExpiry}`);
      return result;
    } else {
      logApiError('OAuth Verification Failed', `HTTP ${res.status}`);
      return {
        authenticated: false,
        tokenValid: false,
        reason: `HTTP ${res.status} - ${res.statusText}`
      };
    }
  } catch (error) {
    logApiError('OAuth Verification Error', error.message);
    return {
      authenticated: false,
      tokenValid: false,
      reason: error.message
    };
  }
}

/**
 * Executes fetch with exponential backoff for 429, 403 quota, and 5xx errors.
 */
async function fetchWithBackoff(url, options = {}, maxRetries = 3) {
  let attempt = 0;

  while (attempt <= maxRetries) {
    apiCallCounter++;
    lastApiCallTimestamp = Date.now();

    try {
      const response = await fetch(url, options);

      if (response.ok) {
        return response;
      }

      if (response.status === 403) {
        logApiError('403 Forbidden', 'Quota Exceeded or Invalid API Key / OAuth Scope');
      }

      if (response.status === 429 || response.status === 403 || response.status >= 500) {
        attempt++;
        if (attempt > maxRetries) return response;
        const backoffMs = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 1000);
        console.warn(`[YouTube Backoff] HTTP ${response.status}. Retrying in ${backoffMs}ms...`);
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }

      return response;
    } catch (error) {
      attempt++;
      if (attempt > maxRetries) throw error;
      await new Promise(r => setTimeout(r, 2000));
    }
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
 * Detects active live stream and returns broadcast metadata.
 */
async function findActiveLiveStream(channelId, apiKey, overrideVideoId = '') {
  if (overrideVideoId && overrideVideoId.trim() !== '') {
    const result = {
      videoId: overrideVideoId.trim(),
      broadcastId: overrideVideoId.trim(),
      title: 'Configured Video ID Override',
      lifeCycleStatus: 'live'
    };
    lastRawBroadcastResponse = result;
    return result;
  }

  try {
    // Try mine=true first if OAuth is active, or search by channelId
    let rawUrl = 'https://www.googleapis.com/youtube/v3/liveBroadcasts?part=snippet,status&broadcastStatus=active';
    let { fullUrl, headers } = await buildAuthParams(rawUrl);

    let res = await fetchWithBackoff(fullUrl, { headers });

    if (!res || !res.ok) {
      // Fallback to video search if liveBroadcasts fails
      if (channelId) {
        rawUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&type=video&eventType=live`;
        const auth = await buildAuthParams(rawUrl);
        res = await fetchWithBackoff(auth.fullUrl, { headers: auth.headers });
      }
    }

    if (!res || !res.ok) {
      logApiError('No Active Broadcast', 'Failed to fetch live broadcast status');
      return null;
    }

    const data = await res.json();
    lastRawBroadcastResponse = data;

    if (data.items && data.items.length > 0) {
      const item = data.items[0];
      const videoId = item.id.videoId || item.id;
      const title = item.snippet ? item.snippet.title : 'Live Broadcast';
      const status = item.status ? item.status.lifeCycleStatus : 'live';

      logApiRequest('GET', 'liveBroadcasts', 200, 'Broadcast Found', `Broadcast ID: ${videoId}`);
      return {
        videoId,
        broadcastId: videoId,
        title,
        lifeCycleStatus: status
      };
    }

    logApiRequest('GET', 'liveBroadcasts', 200, 'No Active Broadcast', 'No live stream items returned');
    return null;
  } catch (error) {
    logApiError('Live Detection Error', error.message);
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

    const res = await fetchWithBackoff(fullUrl, { headers });
    if (!res || !res.ok) {
      logApiError('No Live Chat', `HTTP ${res ? res.status : 'Unknown'} for videoId ${videoId}`);
      return null;
    }

    const data = await res.json();
    if (data.items && data.items.length > 0) {
      const details = data.items[0].liveStreamingDetails;
      if (details && details.activeLiveChatId) {
        logApiRequest('GET', 'videos', 200, 'Live Chat ID Found', `liveChatId: ${details.activeLiveChatId}`);
        return details.activeLiveChatId;
      }
    }
    logApiError('No Live Chat', `Video ID ${videoId} does not have an active liveChatId`);
    return null;
  } catch (error) {
    logApiError('Live Chat Error', error.message);
    return null;
  }
}

/**
 * Fetches live chat messages using pageToken and extracts raw poll responses.
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
    const res = await fetchWithBackoff(fullUrl, { headers });

    if (!res || !res.ok) {
      logApiError('Live Chat Messages Failed', `HTTP ${res ? res.status : 'Unknown'}`);
      return result;
    }

    const data = await res.json();
    lastRawChatResponse = data;
    result.items = data.items || [];
    result.nextPageToken = data.nextPageToken || null;
    result.pollingIntervalMillis = data.pollingIntervalMillis || 5000;

    logApiRequest('GET', 'liveChatMessages', 200, `Fetched ${result.items.length} items`, `Next poll interval: ${result.pollingIntervalMillis}ms`);
    return result;
  } catch (error) {
    logApiError('Live Chat Error', error.message);
    return result;
  }
}

/**
 * Cache raw poll JSON extracted from chat.
 */
function setLastRawPollExtracted(poll) {
  lastRawPollExtracted = poll;
}

/**
 * Get cached raw YouTube responses for debug endpoint.
 */
function getRawYouTubeResponses() {
  return {
    lastBroadcastResponse: lastRawBroadcastResponse,
    lastChatResponse: lastRawChatResponse,
    lastPollExtracted: lastRawPollExtracted,
    lastApiCallTimestamp: getLastApiCallTimestamp()
  };
}

module.exports = {
  findActiveLiveStream,
  getLiveChatId,
  getLiveChatMessages,
  getApiCallCount,
  getLastApiCallTimestamp,
  verifyOAuthStatus,
  setLastRawPollExtracted,
  getRawYouTubeResponses,
  logApiError,
  logApiRequest
};

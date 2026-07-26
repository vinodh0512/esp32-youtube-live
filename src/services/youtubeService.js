/**
 * Service to interact with YouTube Data API v3 with quota tracking, OAuth2, and Exponential Backoff
 */
const env = require('../config/env');

let apiCallCounter = 0;
let cachedAccessToken = null;
let tokenExpiresAt = 0;

/**
 * Returns the total YouTube API calls made in the current session.
 */
function getApiCallCount() {
  return apiCallCounter;
}

/**
 * Increment API request counter and log status.
 * @param {string} endpoint 
 */
function trackApiCall(endpoint) {
  apiCallCounter++;
  if (apiCallCounter % 10 === 0) {
    console.log(`[YouTube API Quota] Total Session Requests: ${apiCallCounter} (Last call: ${endpoint})`);
  }
}

/**
 * Sleep helper for backoff delays.
 * @param {number} ms 
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
      console.log('[YouTube OAuth2] Access token refreshed successfully.');
      return cachedAccessToken;
    } else {
      console.warn('[YouTube OAuth2 Warning] Failed to refresh access token:', res.statusText);
    }
  } catch (error) {
    console.warn('[YouTube OAuth2 Warning] Network error refreshing token:', error.message);
  }
  return null;
}

/**
 * Executes fetch with exponential backoff for 429, 403 quota, and 5xx errors.
 * @param {string} url 
 * @param {Object} options 
 * @param {number} maxRetries 
 */
async function fetchWithBackoff(url, options = {}, maxRetries = 4) {
  let attempt = 0;

  while (attempt <= maxRetries) {
    trackApiCall(new URL(url).pathname);

    try {
      const response = await fetch(url, options);

      // Success
      if (response.ok) {
        return response;
      }

      // Handle Rate Limit / Quota / Server Errors
      if (response.status === 429 || response.status === 403 || response.status >= 500) {
        attempt++;
        if (attempt > maxRetries) {
          return response;
        }

        const backoffMs = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 1000);
        console.warn(`[YouTube API Backoff] HTTP ${response.status} detected. Retrying in ${backoffMs}ms (Attempt ${attempt}/${maxRetries})...`);
        await sleep(backoffMs);
        continue;
      }

      return response;
    } catch (error) {
      attempt++;
      if (attempt > maxRetries) throw error;
      const backoffMs = Math.pow(2, attempt) * 1000 + Math.floor(Math.random() * 1000);
      console.warn(`[YouTube API Backoff] Network error: ${error.message}. Retrying in ${backoffMs}ms...`);
      await sleep(backoffMs);
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
 * Detects active live stream ONCE and caches until stream ends.
 */
async function findActiveLiveStream(channelId, apiKey, overrideVideoId = '') {
  if (overrideVideoId && overrideVideoId.trim() !== '') {
    return {
      videoId: overrideVideoId.trim(),
      title: 'Configured Video ID Override'
    };
  }

  if (!channelId && !env.youtubeRefreshToken) {
    return null;
  }

  try {
    const rawUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(
      channelId
    )}&type=video&eventType=live`;

    const { fullUrl, headers } = await buildAuthParams(rawUrl);
    const res = await fetchWithBackoff(fullUrl, { headers });

    if (!res || !res.ok) {
      return null;
    }

    const data = await res.json();
    if (data.items && data.items.length > 0) {
      const liveItem = data.items[0];
      return {
        videoId: liveItem.id.videoId,
        title: liveItem.snippet.title
      };
    }
    return null;
  } catch (error) {
    console.warn(`[YouTube API Warning] Error checking live stream: ${error.message}`);
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
    if (!res || !res.ok) return null;

    const data = await res.json();
    if (data.items && data.items.length > 0) {
      const details = data.items[0].liveStreamingDetails;
      if (details && details.activeLiveChatId) {
        return details.activeLiveChatId;
      }
    }
    return null;
  } catch (error) {
    console.warn(`[YouTube API Warning] Error getting liveChatId: ${error.message}`);
    return null;
  }
}

/**
 * Fetches live chat messages using pageToken and returns pollingIntervalMillis.
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
      return result;
    }

    const data = await res.json();
    result.items = data.items || [];
    result.nextPageToken = data.nextPageToken || null;
    result.pollingIntervalMillis = data.pollingIntervalMillis || 5000;
    return result;
  } catch (error) {
    console.warn(`[YouTube API Warning] Error fetching live chat: ${error.message}`);
    return result;
  }
}

module.exports = {
  findActiveLiveStream,
  getLiveChatId,
  getLiveChatMessages,
  getApiCallCount
};

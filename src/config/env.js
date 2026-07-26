const dotenv = require('dotenv');
dotenv.config();

module.exports = {
  // Direct default values in code for Render production
  port: process.env.PORT || 10000,
  nodeEnv: process.env.NODE_ENV || 'production',

  // YouTube API & OAuth Credentials from environment variables / .env
  youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
  youtubeClientId: process.env.YOUTUBE_CLIENT_ID || '',
  youtubeClientSecret: process.env.YOUTUBE_CLIENT_SECRET || '',
  youtubeRefreshToken: process.env.YOUTUBE_REFRESH_TOKEN || '',
  youtubeChannelId: process.env.YOUTUBE_CHANNEL_ID || '',
  youtubeVideoId: process.env.YOUTUBE_VIDEO_ID || '',

  mongoUri: process.env.MONGODB_URI || '',
  liveCheckIntervalMs: (parseInt(process.env.LIVE_CHECK_INTERVAL_SECONDS, 10) || 30) * 1000
};

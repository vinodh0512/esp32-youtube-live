const { findActiveLiveStream, getLiveChatId, getLiveChatMessages, getApiCallCount } = require('./youtubeService');
const { extractChatVotesFromItems } = require('./pollParserService');
const { getHeartbeatStatus } = require('./heartbeatService');
const { broadcastDashboardUpdate, broadcastCommandUpdate } = require('./webSocketService');
const Command = require('../models/Command');
const ProcessedPoll = require('../models/ProcessedPoll');
const env = require('../config/env');

let commandVersion = 0;

let latestCommandState = {
  command: 'NONE',
  version: 0,
  pollId: null,
  timestamp: new Date().toISOString(),
  status: 'completed'
};

let currentPollDetails = {
  pollActive: true,
  question: 'Control ESP32',
  onVotes: 0,
  offVotes: 0,
  winner: 'PENDING',
  timeRemaining: 60
};

let activeSimTimer = null;
let liveChat1MinTimer = null;

// Map storing 1-minute window votes per YouTube viewer (userId => 'ON' | 'OFF')
const active1MinUserVotesMap = new Map();
let isStreamActiveFlag = false;

function getLatestCommandState() {
  return latestCommandState;
}

function getStreamStatus() {
  return isStreamActiveFlag;
}

function updateActivePollDetails(details) {
  currentPollDetails = { ...currentPollDetails, ...details };
  broadcastDashboardUpdate(getDashboardState());
}

function getDashboardState() {
  const heartbeat = getHeartbeatStatus();
  const latestCmd = getLatestCommandState();

  return {
    live: isStreamActiveFlag,
    pollActive: currentPollDetails.pollActive,
    question: currentPollDetails.question || 'Control ESP32',
    onVotes: currentPollDetails.onVotes || 0,
    offVotes: currentPollDetails.offVotes || 0,
    winner: currentPollDetails.winner || latestCmd.command || 'NONE',
    timeRemaining: Math.max(0, currentPollDetails.timeRemaining || 0),
    commandVersion: latestCmd.version || commandVersion || 0,
    lastCommand: latestCmd.command || 'NONE',
    esp32Online: heartbeat.esp32Online,
    apiCalls: getApiCallCount(),
    lastSeenSeconds: heartbeat.lastSeenSeconds,
    lastSeenText: heartbeat.lastSeenText
  };
}

/**
 * Record executed command into DB and update state.
 */
async function recordCommand(command, pollId, votes) {
  commandVersion += 1;
  latestCommandState = {
    command: command,
    version: commandVersion,
    pollId: pollId || `poll-${Date.now()}`,
    timestamp: new Date().toISOString(),
    status: 'completed'
  };

  currentPollDetails = {
    ...currentPollDetails,
    pollActive: false,
    winner: command,
    timeRemaining: 0
  };

  broadcastCommandUpdate(latestCommandState);
  broadcastDashboardUpdate(getDashboardState());

  try {
    const cmdDoc = new Command({
      command: command,
      pollId: latestCommandState.pollId,
      votes: votes || { ON: currentPollDetails.onVotes, OFF: currentPollDetails.offVotes }
    });
    await cmdDoc.save();
  } catch (err) {
    // Non-blocking DB fallback
  }
}

/**
 * Finalizes 1-minute live poll winner and updates command version.
 */
async function finalizePollWinner(pollState) {
  const votes = pollState.votes || { ON: currentPollDetails.onVotes, OFF: currentPollDetails.offVotes };
  const onVotes = votes.ON || 0;
  const offVotes = votes.OFF || 0;

  let winner = 'NONE';
  if (onVotes > offVotes) {
    winner = 'ON';
  } else if (offVotes > onVotes) {
    winner = 'OFF';
  } else {
    winner = 'NONE';
  }

  currentPollDetails = {
    pollActive: false,
    question: pollState.question || 'Control ESP32',
    onVotes: onVotes,
    offVotes: offVotes,
    winner: winner,
    timeRemaining: 0
  };

  await recordCommand(winner, pollState.pollId, votes);

  console.log('\n====================================');
  console.log('1-MINUTE LIVE CHAT POLL COMPLETE');
  console.log(`Question: Control ESP32`);
  console.log(`Total ON Votes: ${onVotes}`);
  console.log(`Total OFF Votes: ${offVotes}`);
  console.log(`Winner = ${winner}`);
  console.log(`Command Version = ${commandVersion}`);
  console.log('Latest Command Updated -> Sent to ESP32');
  console.log('Starting next 1-minute live chat cycle...');
  console.log('====================================\n');

  // Reset 1-minute window user votes map for next cycle
  active1MinUserVotesMap.clear();
}

/**
 * Main YouTube Live Monitoring Loop:
 * Analyzes live chat text messages (`textMessageEvent`) every 1 minute.
 * Viewers type `!on`, `on`, `ON` / `!off`, `off`, `OFF`.
 * Tallies highest votes every 60s and controls ESP32!
 */
async function startMonitoringLoop() {
  console.log('Checking YouTube Live...\n');

  // 1-Second Live Countdown & Ticker Loop (60s to 0s)
  let currentSecond = 0;
  const totalDuration = 60; // 1 minute cycle

  setInterval(async () => {
    currentSecond += 1;
    const remaining = Math.max(0, totalDuration - currentSecond);

    // Calculate current live tallies from user votes map
    let onTally = 0;
    let offTally = 0;
    for (const vote of active1MinUserVotesMap.values()) {
      if (vote === 'ON') onTally++;
      if (vote === 'OFF') offTally++;
    }

    currentPollDetails.pollActive = true;
    currentPollDetails.question = 'Control ESP32';
    currentPollDetails.onVotes = onTally;
    currentPollDetails.offVotes = offTally;
    currentPollDetails.timeRemaining = remaining;
    currentPollDetails.winner = 'PENDING';

    broadcastDashboardUpdate(getDashboardState());

    // Every 60 seconds (1 minute complete)
    if (currentSecond >= totalDuration) {
      currentSecond = 0; // Reset ticker for next 1-minute cycle

      await finalizePollWinner({
        pollId: `chat-poll-${Date.now()}`,
        question: 'Control ESP32',
        votes: { ON: onTally, OFF: offTally }
      });
    }
  }, 1000);

  // Main YouTube Data API Chat Polling Loop
  while (true) {
    try {
      const liveStream = await findActiveLiveStream(
        env.youtubeChannelId,
        env.youtubeApiKey,
        env.youtubeVideoId
      );

      if (!liveStream) {
        isStreamActiveFlag = false;
        broadcastDashboardUpdate(getDashboardState());
        console.log('No active YouTube Live');
        console.log('Checking YouTube Live...');
        await sleep(env.liveCheckIntervalMs);
        continue;
      }

      isStreamActiveFlag = true;
      cachedBroadcastId = liveStream.videoId || liveStream.broadcastId;
      cachedBroadcastTitle = liveStream.title;
      broadcastDashboardUpdate(getDashboardState());
      console.log(`Live Found | Broadcast ID: ${cachedBroadcastId} | Title: ${cachedBroadcastTitle}`);

      const liveChatId = await getLiveChatId(liveStream.videoId, env.youtubeApiKey);
      cachedLiveChatId = liveChatId;
      if (!liveChatId) {
        isStreamActiveFlag = false;
        broadcastDashboardUpdate(getDashboardState());
        await sleep(env.liveCheckIntervalMs);
        continue;
      }

      let pageToken = '';
      let isChatActive = true;

      while (isChatActive) {
        const chatResponse = await getLiveChatMessages(liveChatId, env.youtubeApiKey, pageToken);

        if (chatResponse.isEnded) {
          console.log('[Live Monitor] Live chat has ended. Switching stream status to OFFLINE.');
          isStreamActiveFlag = false;
          broadcastDashboardUpdate(getDashboardState());
          isChatActive = false;
          break;
        }

        pageToken = chatResponse.nextPageToken || pageToken;

        // Parse Live Chat Text Messages for !on / on / !off / off commands
        const chatVotes = extractChatVotesFromItems(chatResponse.items);
        if (chatVotes.length > 0) {
          for (const voteItem of chatVotes) {
            active1MinUserVotesMap.set(voteItem.userId, voteItem.vote);
            console.log(`[Live Chat Command] Viewer "${voteItem.author}" voted: ${voteItem.vote} (Message: "${voteItem.message}")`);
          }
          broadcastDashboardUpdate(getDashboardState());
        }

        chatResponse.items = null;
        await sleep(1000);
      }
    } catch (error) {
      await sleep(10000);
    }
  }
}

/**
 * Runs a dynamic 60-second poll simulation
 */
function run30SecondLivePollSim(targetOn = 145, targetOff = 132, question = 'Control ESP32') {
  if (activeSimTimer) {
    clearInterval(activeSimTimer);
  }

  const pollId = `sim-poll-${Date.now()}`;
  let currentSecond = 0;
  const totalDuration = 60;

  currentPollDetails = {
    pollActive: true,
    question: question,
    onVotes: 0,
    offVotes: 0,
    winner: 'PENDING',
    timeRemaining: totalDuration
  };

  broadcastDashboardUpdate(getDashboardState());

  activeSimTimer = setInterval(async () => {
    currentSecond += 1;
    const remaining = Math.max(0, totalDuration - currentSecond);

    const progressRatio = Math.min(1, currentSecond / totalDuration);
    const onVotesNow = Math.round(targetOn * Math.pow(progressRatio, 0.95));
    const offVotesNow = Math.round(targetOff * Math.pow(progressRatio, 0.95));

    currentPollDetails.onVotes = onVotesNow;
    currentPollDetails.offVotes = offVotesNow;
    currentPollDetails.timeRemaining = remaining;

    broadcastDashboardUpdate(getDashboardState());

    if (currentSecond >= totalDuration) {
      clearInterval(activeSimTimer);
      activeSimTimer = null;

      await finalizePollWinner({
        pollId,
        question,
        votes: { ON: targetOn, OFF: targetOff }
      });
    }
  }, 1000);
}

let cachedBroadcastId = null;
let cachedLiveChatId = null;
let cachedBroadcastTitle = null;

function getLiveStreamDetails() {
  return {
    isLive: isStreamActiveFlag,
    broadcastId: cachedBroadcastId,
    liveChatId: cachedLiveChatId,
    title: cachedBroadcastTitle
  };
}

function getCurrentPollDetails() {
  return currentPollDetails;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  startMonitoringLoop,
  getLatestCommandState,
  getStreamStatus,
  recordCommand,
  getDashboardState,
  updateActivePollDetails,
  run30SecondLivePollSim,
  getLiveStreamDetails,
  getCurrentPollDetails
};

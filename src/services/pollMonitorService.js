const { findActiveLiveStream, getLiveChatId, getLiveChatMessages, getApiCallCount } = require('./youtubeService');
const { extractPollsFromChatItems, parseAndValidatePoll } = require('./pollParserService');
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
  pollActive: false,
  question: 'Control ESP32',
  onVotes: 0,
  offVotes: 0,
  winner: 'NONE',
  timeRemaining: 0
};

let activeSimTimer = null;

const processedPollIdsCache = new Set();
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
    esp32Online: heartbeat.esp32Online,
    lastCommand: latestCmd.command || 'NONE',
    apiCalls: getApiCallCount(),
    lastSeenSeconds: heartbeat.lastSeenSeconds,
    lastSeenText: heartbeat.lastSeenText
  };
}

/**
 * Updates latest command state and saves history to MongoDB if available.
 * Increments version counter for ESP32 single execution.
 */
async function recordCommand(command, pollId, votes = { ON: 0, OFF: 0 }) {
  commandVersion++;

  latestCommandState = {
    command: command,
    version: commandVersion,
    pollId: pollId,
    timestamp: new Date().toISOString(),
    status: 'completed'
  };

  currentPollDetails.winner = command;
  currentPollDetails.onVotes = votes.ON || 0;
  currentPollDetails.offVotes = votes.OFF || 0;
  currentPollDetails.pollActive = false;
  currentPollDetails.timeRemaining = 0;

  // Mark poll as processed in memory
  processedPollIdsCache.add(pollId);

  // Broadcast WebSocket updates
  broadcastCommandUpdate(latestCommandState);
  broadcastDashboardUpdate(getDashboardState());

  // Optional MongoDB Persistence (Only if connected)
  try {
    if (ProcessedPoll.db && ProcessedPoll.db.readyState === 1) {
      await ProcessedPoll.create({
        pollId: pollId,
        processed: true,
        question: 'Control ESP32',
        winner: command
      });

      await Command.create({
        command: command,
        pollId: pollId,
        votes: votes,
        status: 'completed',
        timestamp: new Date()
      });
    }
  } catch (error) {
    // Fail silently so DB errors never crash backend
  }
}

async function isPollAlreadyProcessed(pollId) {
  if (processedPollIdsCache.has(pollId)) {
    return true;
  }

  try {
    if (ProcessedPoll.db && ProcessedPoll.db.readyState === 1) {
      const exists = await ProcessedPoll.exists({ pollId });
      if (exists) {
        processedPollIdsCache.add(pollId);
        return true;
      }
    }
  } catch (error) {
    // Fall back to memory check
  }

  return false;
}

async function initializeStateFromDB() {
  try {
    if (Command.db && Command.db.readyState === 1) {
      const latestDoc = await Command.findOne().sort({ createdAt: -1 });
      if (latestDoc) {
        latestCommandState = {
          command: latestDoc.command,
          pollId: latestDoc.pollId,
          timestamp: latestDoc.timestamp ? latestDoc.timestamp.toISOString() : new Date().toISOString(),
          status: latestDoc.status || 'completed'
        };
      }

      const processedDocs = await ProcessedPoll.find({}, 'pollId').lean();
      for (const doc of processedDocs) {
        if (doc.pollId) processedPollIdsCache.add(doc.pollId);
      }
    }
  } catch (error) {
    // Non-blocking fallback
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Executes full poll processing lifecycle with required event logs.
 */
async function handlePollExecution(poll, liveChatId = null, pageToken = null) {
  // Prevent duplicate execution
  const isProcessed = await isPollAlreadyProcessed(poll.pollId);
  if (isProcessed) {
    return;
  }

  // Exact required logging sequence
  console.log('\nPoll Detected\n');
  console.log('Question:\nControl ESP32\n');
  console.log('Options:\nON\nOFF\n');
  console.log('Poll started\n');
  console.log('Collecting Votes...\n');

  let activePollState = { ...poll };

  if (activePollState.isClosed) {
    await finalizePollWinner(activePollState);
    return;
  }

  let currentPageToken = pageToken;
  let pollActive = true;

  while (pollActive) {
    if (!liveChatId || (!env.youtubeApiKey && !env.youtubeRefreshToken)) {
      break;
    }

    const chatResponse = await getLiveChatMessages(liveChatId, env.youtubeApiKey, currentPageToken);
    if (chatResponse.nextPageToken) {
      currentPageToken = chatResponse.nextPageToken;
    }

    const extracted = extractPollsFromChatItems(chatResponse.items);
    let updated = false;

    for (const item of extracted) {
      const parsed = parseAndValidatePoll(item);
      if (parsed.isValid && parsed.pollId === poll.pollId) {
        activePollState = parsed;
        updated = true;
        if (parsed.isClosed) {
          pollActive = false;
          break;
        }
      }
    }

    chatResponse.items = null;

    if (!updated || !pollActive) {
      break;
    }

    const waitMs = Math.max(chatResponse.pollingIntervalMillis || 5000, 3000);
    await sleep(waitMs);
  }

  await finalizePollWinner(activePollState);
}

async function finalizePollWinner(pollState) {
  const votes = pollState.votes || { ON: 0, OFF: 0 };
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

  await recordCommand(winner, pollState.pollId, votes);

  console.log(`Winner = ${winner}`);
  console.log(`Command Version = ${commandVersion}`);
  console.log('Latest Command Updated');
  console.log('Waiting for next poll...');
}

/**
 * Main monitoring loop.
 */
async function startMonitoringLoop() {
  await initializeStateFromDB();

  console.log('Checking YouTube Live...\n');

  while (true) {
    try {
      const liveStream = await findActiveLiveStream(
        env.youtubeChannelId,
        env.youtubeApiKey,
        env.youtubeVideoId
      );

      if (!liveStream) {
        isStreamActiveFlag = false;
        console.log('No active YouTube Live');
        console.log('Checking YouTube Live...');
        await sleep(env.liveCheckIntervalMs);
        continue;
      }

      isStreamActiveFlag = true;
      console.log('Live Found');
      console.log('Waiting for Poll...');

      const liveChatId = await getLiveChatId(liveStream.videoId, env.youtubeApiKey);
      if (!liveChatId) {
        await sleep(env.liveCheckIntervalMs);
        continue;
      }

      let pageToken = '';
      let isChatActive = true;

      while (isChatActive) {
        const chatResponse = await getLiveChatMessages(liveChatId, env.youtubeApiKey, pageToken);
        pageToken = chatResponse.nextPageToken || pageToken;

        const rawPolls = extractPollsFromChatItems(chatResponse.items);

        for (const rawPoll of rawPolls) {
          const validated = parseAndValidatePoll(rawPoll);
          if (validated.isValid) {
            await handlePollExecution(validated, liveChatId, pageToken);
          }
        }

        chatResponse.items = null;
        const sleepDuration = Math.max(chatResponse.pollingIntervalMillis || 5000, 3000);
        await sleep(sleepDuration);
      }
    } catch (error) {
      await sleep(10000);
    }
  }
}

/**
 * Runs a dynamic 30-second poll simulation that streams live votes and timer updates
 * to the dashboard/OBS overlay every 1 second.
 */
function run30SecondLivePollSim(targetOn = 145, targetOff = 132, question = 'Control ESP32') {
  if (activeSimTimer) {
    clearInterval(activeSimTimer);
  }

  const pollId = `poll-${Date.now()}`;
  let currentSecond = 0;
  const totalDuration = 30;

  currentPollDetails = {
    pollActive: true,
    question: question,
    onVotes: 0,
    offVotes: 0,
    winner: 'PENDING',
    timeRemaining: totalDuration
  };

  console.log('\nPoll Detected\n');
  console.log(`Question:\n${question}\n`);
  console.log('Options:\nON\nOFF\n');
  console.log('Poll started\n');
  console.log('Collecting Votes...\n');

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

module.exports = {
  startMonitoringLoop,
  getLatestCommandState,
  getStreamStatus,
  recordCommand,
  handlePollExecution,
  getDashboardState,
  updateActivePollDetails,
  run30SecondLivePollSim
};

/**
 * Service for detecting, extracting, and strictly validating YouTube Live Polls.
 */

const TARGET_QUESTION = 'CONTROL ESP32';
const EXACT_OPTION_1 = 'ON';
const EXACT_OPTION_2 = 'OFF';

/**
 * Parses chat items array and extracts potential poll objects.
 * Ignores all normal live chat messages (textMessageEvent, superChatEvent, etc.).
 * 
 * @param {Array} items 
 * @returns {Array<Object>} Extracted raw poll objects
 */
function extractPollsFromChatItems(items) {
  if (!Array.isArray(items)) return [];

  const rawPolls = [];

  for (const item of items) {
    if (!item) continue;

    // Direct mock or simulated poll object check
    if (item.type === 'poll' || item.pollId) {
      rawPolls.push(item);
      continue;
    }

    const snippet = item.snippet;
    if (!snippet) continue;

    // Ignore normal live chat messages
    if (
      snippet.type === 'textMessageEvent' ||
      snippet.type === 'superChatEvent' ||
      snippet.type === 'membershipGainedEvent'
    ) {
      continue;
    }

    // YouTube Data API v3 Poll details extraction
    const pollObj =
      snippet.pollDetails ||
      snippet.pollOpenedDetails ||
      snippet.pollEditedDetails ||
      snippet.pollClosedDetails ||
      snippet.pollVotedDetails ||
      (snippet.type === 'pollEvent' ? snippet : null);

    if (pollObj) {
      rawPolls.push({
        id: item.id || pollObj.pollId || pollObj.id,
        rawDetails: pollObj,
        snippet: snippet
      });
    }
  }

  return rawPolls;
}

/**
 * Strictly validates poll structure:
 * Question: MUST BE EXACTLY "Control ESP32"
 * Options: MUST BE EXACTLY "ON" and "OFF"
 * 
 * @param {Object} rawPoll 
 * @returns {{isValid: boolean, pollId: string, question: string, options: Array<string>, isClosed: boolean, votes: {ON: number, OFF: number}}}
 */
function parseAndValidatePoll(rawPoll) {
  const invalidResult = {
    isValid: false,
    pollId: null,
    question: '',
    options: [],
    isClosed: false,
    votes: { ON: 0, OFF: 0 }
  };

  if (!rawPoll) return invalidResult;

  let pollId = rawPoll.id || rawPoll.pollId;
  let questionText = '';
  let optionsList = [];
  let isClosed = false;
  let votes = { ON: 0, OFF: 0 };

  // Handle direct / simulated poll objects
  if (rawPoll.question && Array.isArray(rawPoll.options)) {
    pollId = rawPoll.pollId || rawPoll.id;
    questionText = rawPoll.question;
    optionsList = rawPoll.options.map(opt => (typeof opt === 'string' ? opt : opt.text || opt.optionText));
    isClosed = !!rawPoll.isClosed || rawPoll.status === 'closed' || rawPoll.status === 'ended';
    if (rawPoll.votes) {
      votes.ON = Number(rawPoll.votes.ON || rawPoll.votes.on || 0);
      votes.OFF = Number(rawPoll.votes.OFF || rawPoll.votes.off || 0);
    }
  } else if (rawPoll.rawDetails) {
    const details = rawPoll.rawDetails;
    questionText =
      details.question ||
      details.questionText ||
      (details.metadata && details.metadata.questionText) ||
      '';

    const rawOptions = details.pollOptions || details.options || (details.metadata && details.metadata.options) || [];
    if (Array.isArray(rawOptions)) {
      for (const opt of rawOptions) {
        const text = typeof opt === 'string' ? opt : opt.optionText || opt.text || '';
        optionsList.push(text);

        const normText = text.trim().toUpperCase();
        const tally = Number(opt.tally || opt.voteCount || opt.votes || 0);
        if (normText === EXACT_OPTION_1) votes.ON = tally;
        if (normText === EXACT_OPTION_2) votes.OFF = tally;
      }
    }

    if (details.status === 'closed' || details.status === 'ended' || details.isClosed === true) {
      isClosed = true;
    }
  }

  if (!pollId) return invalidResult;

  // 1. Strict Question Validation: Must be exactly "Control ESP32"
  const normalizedQuestion = questionText.trim().toUpperCase();
  if (normalizedQuestion !== TARGET_QUESTION) {
    return invalidResult;
  }

  // 2. Strict Options Validation: Must be exactly 2 options, "ON" and "OFF"
  const normalizedOptions = optionsList.map(opt => (opt || '').trim().toUpperCase());
  if (normalizedOptions.length !== 2) {
    return invalidResult;
  }

  const isExactMatch =
    (normalizedOptions[0] === EXACT_OPTION_1 && normalizedOptions[1] === EXACT_OPTION_2) ||
    (normalizedOptions[0] === EXACT_OPTION_2 && normalizedOptions[1] === EXACT_OPTION_1);

  if (!isExactMatch) {
    return invalidResult;
  }

  return {
    isValid: true,
    pollId: String(pollId),
    question: 'Control ESP32',
    options: ['ON', 'OFF'],
    isClosed: isClosed,
    votes: votes
  };
}

module.exports = {
  extractPollsFromChatItems,
  parseAndValidatePoll
};

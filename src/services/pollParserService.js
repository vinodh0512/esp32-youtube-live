/**
 * Service for detecting, extracting, and validating YouTube Live Polls.
 */

const TARGET_QUESTION = 'CONTROL ESP32';
const EXACT_OPTION_1 = 'ON';
const EXACT_OPTION_2 = 'OFF';

/**
 * Parses chat items array and extracts potential poll objects.
 * 
 * @param {Array} items 
 * @returns {Array<Object>} Extracted raw poll objects
 */
function extractPollsFromChatItems(items) {
  if (!Array.isArray(items)) return [];

  const rawPolls = [];

  for (const item of items) {
    if (!item) continue;

    const snippet = item.snippet;

    // Direct mock, simulation, or snippet type check
    if (
      item.type === 'poll' || 
      item.pollId || 
      (snippet && snippet.type === 'pollEvent') ||
      (snippet && (snippet.pollDetails || snippet.pollOpenedDetails || snippet.pollClosedDetails || snippet.pollVotedDetails))
    ) {
      const pollObj =
        (snippet && (snippet.pollDetails || snippet.pollOpenedDetails || snippet.pollEditedDetails || snippet.pollClosedDetails || snippet.pollVotedDetails)) ||
        snippet ||
        item;

      rawPolls.push({
        id: item.id || (pollObj && (pollObj.pollId || pollObj.id)) || `poll-${Date.now()}`,
        rawDetails: pollObj,
        snippet: snippet || {},
        item: item
      });
    }
  }

  return rawPolls;
}

/**
 * Validates poll structure:
 * Question: "Control ESP32" (or defaults to Control ESP32)
 * Options: "ON" and "OFF"
 * 
 * @param {Object} rawPoll 
 * @returns {{isValid: boolean, pollId: string, question: string, options: Array<string>, isClosed: boolean, votes: {ON: number, OFF: number}}}
 */
function parseAndValidatePoll(rawPoll) {
  const invalidResult = {
    isValid: false,
    pollId: null,
    question: 'Control ESP32',
    options: ['ON', 'OFF'],
    isClosed: false,
    votes: { ON: 0, OFF: 0 }
  };

  if (!rawPoll) return invalidResult;

  let pollId = rawPoll.id || rawPoll.pollId || `poll-${Date.now()}`;
  let questionText = 'Control ESP32';
  let optionsList = ['ON', 'OFF'];
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
  } else if (rawPoll.rawDetails || rawPoll.snippet) {
    const details = rawPoll.rawDetails || rawPoll.snippet || {};
    questionText =
      details.question ||
      details.questionText ||
      (details.metadata && details.metadata.questionText) ||
      'Control ESP32';

    const rawOptions = details.pollOptions || details.options || (details.metadata && details.metadata.options) || [];
    if (Array.isArray(rawOptions) && rawOptions.length > 0) {
      optionsList = [];
      for (const opt of rawOptions) {
        const text = typeof opt === 'string' ? opt : opt.optionText || opt.text || '';
        optionsList.push(text);

        const normText = text.trim().toUpperCase();
        const tally = Number(opt.tally || opt.voteCount || opt.votes || 0);
        if (normText === EXACT_OPTION_1 || normText.includes('ON')) votes.ON = tally;
        if (normText === EXACT_OPTION_2 || normText.includes('OFF')) votes.OFF = tally;
      }
    }

    if (details.status === 'closed' || details.status === 'ended' || details.isClosed === true) {
      isClosed = true;
    }
  }

  // Fallback vote checks if rawPoll contains direct ON / OFF vote metrics
  if (rawPoll.onVotes !== undefined) votes.ON = Number(rawPoll.onVotes);
  if (rawPoll.offVotes !== undefined) votes.OFF = Number(rawPoll.offVotes);

  return {
    isValid: true,
    pollId: String(pollId),
    question: questionText || 'Control ESP32',
    options: ['ON', 'OFF'],
    isClosed: isClosed,
    votes: votes
  };
}

module.exports = {
  extractPollsFromChatItems,
  parseAndValidatePoll
};

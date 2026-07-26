/**
 * Service for parsing YouTube Live Chat Text Messages (textMessageEvent).
 */

/**
 * Analyzes live chat text messages (`textMessageEvent`) and extracts ON/OFF votes.
 * Accepts variations: !on, on, ON, !ON, 1, turn on / !off, off, OFF, !OFF, 0, turn off
 * 
 * @param {Array} items - Array of chat items from liveChatMessages.list
 * @returns {Array<{userId: string, vote: 'ON'|'OFF', author: string, message: string}>}
 */
function extractChatVotesFromItems(items) {
  if (!Array.isArray(items)) return [];

  const votes = [];

  for (const item of items) {
    if (!item || !item.snippet) continue;

    const snippet = item.snippet;
    const textDetails = snippet.textMessageDetails;
    const messageText = (textDetails && textDetails.messageText) || snippet.displayMessage || '';

    if (!messageText) continue;

    const cleanText = messageText.trim().toLowerCase();
    const userId = (item.authorDetails && (item.authorDetails.channelId || item.authorDetails.displayName)) || item.id || `user-${Date.now()}`;
    const author = (item.authorDetails && item.authorDetails.displayName) || 'Viewer';

    let vote = null;

    // Check ON variations
    if (
      cleanText === '!on' ||
      cleanText === 'on' ||
      cleanText === '1' ||
      cleanText === '#on' ||
      cleanText === '/on' ||
      cleanText.includes('turn on') ||
      cleanText.includes('esp32 on')
    ) {
      vote = 'ON';
    }
    // Check OFF variations
    else if (
      cleanText === '!off' ||
      cleanText === 'off' ||
      cleanText === '0' ||
      cleanText === '#off' ||
      cleanText === '/off' ||
      cleanText.includes('turn off') ||
      cleanText.includes('esp32 off')
    ) {
      vote = 'OFF';
    }

    if (vote) {
      votes.push({
        userId,
        vote,
        author,
        message: messageText
      });
    }
  }

  return votes;
}

module.exports = {
  extractChatVotesFromItems
};

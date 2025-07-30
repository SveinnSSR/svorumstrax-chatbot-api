// dataModels.js - Standardized structures compatible with your PostgreSQL schema

/**
 * Standard Conversation Data Structure
 * @typedef {Object} ConversationData
 * @property {string} id - Unique conversation ID
 * @property {string} sessionId - Client session ID
 * @property {string} clientId - Customer identifier (e.g., 'svorum-strax')
 * @property {Array<MessageData>} messages - Array of message objects
 * @property {string} startedAt - ISO timestamp when conversation started
 * @property {string} endedAt - ISO timestamp when conversation ended
 * @property {string} language - Primary language code ('en', 'is')
 * @property {string} [topic] - Optional conversation topic
 * @property {string} [status] - Conversation status
 */

/**
 * Standard Message Data Structure
 * @typedef {Object} MessageData
 * @property {string} id - Unique message ID
 * @property {string} content - Message content
 * @property {'user'|'assistant'} role - Message role (only these two values)
 * @property {'user'|'bot'} type - Message type for compatibility (user/bot) 
 * @property {string} timestamp - ISO timestamp
 * @property {string} [language] - Message language code
 * @property {string} [postgresqlId] - Reference to analytics system ID
 */

/**
 * Validates and normalizes a conversation object
 * @param {Object} conversation - Raw conversation data
 * @returns {ConversationData} - Normalized conversation data
 */
export function normalizeConversation(conversation) {
  if (!conversation) {
    throw new Error("Cannot normalize undefined conversation");
  }
  
  // Ensure we have required fields
  const id = conversation.id || `conv_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  const sessionId = conversation.sessionId || conversation.chatId || id;
  const clientId = conversation.clientId || 'svorum-strax';
  const startedAt = conversation.startedAt || conversation.startTime || new Date().toISOString();
  const endedAt = conversation.endedAt || new Date().toISOString();
  const language = conversation.language || 'en';
  const topic = conversation.topic || 'general';
  const status = conversation.status || 'active';
  
  // Normalize messages
  const messages = Array.isArray(conversation.messages) 
    ? conversation.messages.map(normalizeMessage)
    : [];
    
  // Handle legacy format with userMessage/botResponse fields
  if (conversation.userMessage && !messages.some(m => m.role === 'user')) {
    messages.push(normalizeMessage({
      content: conversation.userMessage,
      role: 'user',
      timestamp: startedAt
    }));
  }
  
  if (conversation.botResponse && !messages.some(m => m.role === 'assistant')) {
    messages.push(normalizeMessage({
      content: conversation.botResponse,
      role: 'assistant',
      timestamp: new Date(new Date(startedAt).getTime() + 1).toISOString()
    }));
  }
  
  // Sort messages by timestamp
  messages.sort((a, b) => {
    return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
  });
  
  return {
    id,
    sessionId,
    clientId,
    messages,
    startedAt,
    endedAt,
    language,
    topic,
    status
  };
}

/**
 * Validates and normalizes a message object - compatible with your schema
 * @param {Object} message - Raw message data
 * @returns {MessageData} - Normalized message data
 */
export function normalizeMessage(message) {
  if (!message) {
    throw new Error("Cannot normalize undefined message");
  }
  
  // Generate ID if not present
  const id = message.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  
  // Get content, defaulting to empty string
  const content = message.content || '';
  
  // Determine role - the most critical part for fixing UI issues
  let role;
  if (message.role === 'user' || message.sender === 'user' || message.type === 'user') {
    role = 'user';
  } else if (message.role === 'assistant' || message.sender === 'bot' || message.type === 'bot') {
    role = 'assistant';
  } else {
    // Default based on position - even indices are user, odd are assistant
    // This is a last resort and should be avoided
    console.warn(`Couldn't determine role for message: ${id}, defaulting based on position`);
    role = message.defaultRole || 'user';
  }
  
  // Set type to match your PostgreSQL schema - 'user' or 'bot' mapping
  const type = role === 'user' ? 'user' : 'bot';
  
  // Timestamp with fallback
  const timestamp = message.timestamp || new Date().toISOString();
  
  // Language with fallback
  const language = message.language || 'en';
  
  // PostgreSQL ID if available
  const postgresqlId = message.postgresqlId || null;
  
  return {
    id,
    content,
    role,   // 'user' or 'assistant' - for UI rendering
    type,   // 'user' or 'bot' - for database compatibility
    timestamp,
    language,
    postgresqlId
  };
}

/**
 * Create a mapping between MongoDB and PostgreSQL message IDs
 * @param {string} mongodbId - MongoDB message ID
 * @param {string} postgresqlId - PostgreSQL message ID
 * @param {string} contentHash - Optional content hash for validation
 * @returns {Object} - Mapping object
 */
export function createMessageIdMapping(mongodbId, postgresqlId, contentHash = null) {
  return {
    mongodbId,
    postgresqlId,
    contentHash: contentHash,
    createdAt: new Date().toISOString()
  };
}

// Export models for use across the system
export default {
  normalizeConversation,
  normalizeMessage,
  createMessageIdMapping
};

import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import Pusher from "pusher";
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

// Import analytics modules
import { connectToDatabase } from "./database.js";
import { getOrCreateSession } from "./sessionManager.js";
import { processMessagePair } from "./messageProcessor.js";

// Import the new prompt system
import { getSystemPrompt } from "./prompts/svorumstrax-prompt.js";

// NEW: Import file processor
import { processFiles } from './utils/fileProcessor.js';

// Configuration
const PORT = process.env.PORT || 8080;
const API_KEY = process.env.API_KEY || "svorum2025_sk3j8k4j5k6j7k8j9k0j1k2";

// Initialize Express
const app = express();
app.set("trust proxy", 1);

// Create HTTP server for WebSocket support
const server = createServer(app);

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Pusher
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});

// WebSocket server for streaming responses
const wss = new WebSocketServer({ server });

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  console.log('🔌 WebSocket client connected');
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('📨 WebSocket message received:', {
        type: data.type,
        sessionId: data.sessionId,
        hasMessage: !!data.message,
        hasImages: !!data.images?.length,
        hasFiles: !!data.files?.length
      });
      
      if (data.type === 'chat' && data.message) {
        await handleStreamingChat(ws, data);
      }
    } catch (error) {
      console.error('❌ WebSocket message error:', error);
      ws.send(JSON.stringify({ 
        type: 'error', 
        message: 'Invalid message format' 
      }));
    }
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
  });

  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  }); 
});

// Streaming chat handler - WITH IMAGE AND FILE SUPPORT
async function handleStreamingChat(ws, data) {
  const { message: userMessage, sessionId, images, files } = data;
  const streamId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  
  try {
    console.log('📨 WebSocket streaming chat:', {
      sessionId,
      hasImages: !!images?.length,
      hasFiles: !!files?.length,
      imageCount: images?.length || 0,
      fileCount: files?.length || 0
    });

    // Send connection confirmation
    ws.send(JSON.stringify({
      type: 'stream-connected',
      streamId: streamId,
      sessionId: sessionId
    }));

    // Detect language
    const detectedLanguage = userMessage.match(/[áéíóúýþæðöÁÉÍÓÚÝÞÆÐÖ]/i) ? "is" : "en";
    
    // Get session and conversation history
    const sessionInfo = await getOrCreateSession(sessionId);
    
    // Get session for conversation history
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        messages: [],
        createdAt: new Date(),
      });
    }
    const session = sessions.get(sessionId);

    // NEW: Extract text from files if present
    let fileContext = '';
    if (files && files.length > 0) {
      console.log(`📄 WebSocket: Processing ${files.length} files...`);
      fileContext = await processFiles(files);
      console.log(`✅ WebSocket: File text extracted: ${fileContext.length} chars`);
    }

    // Add user message to session
    session.messages.push({
      role: "user",
      content: userMessage,
    });

    // Get dynamic system prompt based on language
    const systemPrompt = getSystemPrompt(detectedLanguage);

    // Build messages array with file context if present
    const messages = [
      {
        role: "system",
        content: systemPrompt,
      },
      ...session.messages.slice(-10), // Keep last 10 messages
    ];

    // NEW: Build the current user message content properly with images and files
    let finalUserMessage;
    
    if (fileContext && images && images.length > 0) {
      // BOTH files and images
      const contentParts = [
        {
          type: 'text',
          text: `${userMessage || 'Vinsamlegast greindu þessi gögn.'}\n\nDOCUMENT CONTENT:\n${fileContext.slice(0, 8000)}`
        }
      ];
      
      // Add images
      for (const image of images) {
        contentParts.push({
          type: 'image_url',
          image_url: {
            url: `data:${image.mimeType};base64,${image.data}`,
            detail: 'high'
          }
        });
      }
      
      // Replace last message with multipart content
      messages[messages.length - 1] = { role: "user", content: contentParts };
      console.log('🖼️ WebSocket: Adding images and files to prompt');
      
    } else if (fileContext) {
      // ONLY files
      messages[messages.length - 1] = {
        role: "user",
        content: `${userMessage || 'Vinsamlegast greindu þetta skjal og gefðu álit.'}\n\nDOCUMENT CONTENT:\n${fileContext.slice(0, 8000)}`
      };
      
    } else if (images && images.length > 0) {
      // ONLY images
      const contentParts = [
        {
          type: 'text',
          text: userMessage || 'Hvað er þetta á myndinni?'
        }
      ];
      
      for (const image of images) {
        contentParts.push({
          type: 'image_url',
          image_url: {
            url: `data:${image.mimeType};base64,${image.data}`,
            detail: 'high'
          }
        });
      }
      
      messages[messages.length - 1] = { role: "user", content: contentParts };
      console.log('🖼️ WebSocket: Adding images to prompt');
    }

    // Create streaming completion
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      temperature: 0.7,
      max_tokens: 800,
      stream: true
    });

    let fullResponse = '';
    let chunkNumber = 0;

    // Stream the response
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      
      if (content) {
        fullResponse += content;
        chunkNumber++;
        
        // Send chunk via WebSocket
        ws.send(JSON.stringify({
          type: 'stream-chunk',
          streamId: streamId,
          sessionId: sessionId,
          content: content,
          chunkNumber: chunkNumber
        }));
      }
    }

    // Add assistant response to session
    session.messages.push({
      role: "assistant",
      content: fullResponse,
    });

    // Send completion signal
    ws.send(JSON.stringify({
      type: 'stream-complete',
      streamId: streamId,
      sessionId: sessionId,
      completeContent: fullResponse
    }));

    // Fire-and-forget analytics
    setImmediate(async () => {
      try {
        const detectedTopic = detectTopic(userMessage || 'file upload');
        await broadcastConversation(
          userMessage || (files && files.length > 0 ? '📄 [Skjal sent]' : '🖼️ [Mynd send]'),
          fullResponse,
          detectedLanguage,
          detectedTopic,
          "streaming_chat",
          sessionId,
          "active"
        );
        console.log('📊 Streaming analytics sent');
      } catch (error) {
        console.error('❌ Error in streaming analytics:', error);
      }
    });

  } catch (error) {
    console.error('❌ Streaming error:', error);
    ws.send(JSON.stringify({
      type: 'stream-error',
      streamId: streamId,
      sessionId: sessionId,
      error: error.message
    }));
  }
}

// Topic detection for Svörum Strax
function detectTopic(message) {
  const msg = message.toLowerCase();
  
  if (/\b(job|work|employment|störf|vinna|barcelona|spánn|spain)\b/i.test(msg)) {
    return "employment";
  } else if (/\b(service|þjónusta|símsvörun|tölvupóstur|phone|email)\b/i.test(msg)) {
    return "services";
  } else if (/\b(price|verð|cost|kostnaður|tilboð|quote)\b/i.test(msg)) {
    return "pricing";
  } else if (/\b(ai|gervigreind|chatbot|automation)\b/i.test(msg)) {
    return "ai_services";
  } else if (/\b(contact|tengiliður|information|upplýsingar|samband)\b/i.test(msg)) {
    return "contact";
  } else if (/\b(bókhald|accounting|reikningur|invoice)\b/i.test(msg)) {
    return "accounting";
  }
  
  return "general";
}

// Broadcast conversation function
const broadcastConversation = async (
  userMessage,
  botResponse,
  language,
  topic = "general",
  type = "chat",
  clientSessionId = null,
  status = "active",
) => {
  try {
    if (!userMessage || !botResponse) {
      console.log("Skipping broadcast for empty message");
      return { success: false, reason: "empty_message" };
    }

    // Use message processor
    const processResult = await processMessagePair(userMessage, botResponse, {
      sessionId: clientSessionId,
      language: language,
      topic: topic,
      type: type,
      clientId: "svorum-strax",
      status: status,
    });

    if (processResult.success) {
      const sessionInfo = await getOrCreateSession(clientSessionId);

      const conversationData = {
        id: sessionInfo.conversationId,
        sessionId: sessionInfo.sessionId,
        clientId: "svorum-strax",
        userMessage: userMessage,
        botResponse: botResponse,
        messages: [
          {
            id: processResult.userMessageId,
            content: userMessage,
            role: "user",
            type: "user",
          },
          {
            id: processResult.botMessageId,
            content: botResponse,
            role: "assistant",
            type: "bot",
          },
        ],
        startedAt: sessionInfo.startedAt,
        endedAt: new Date().toISOString(),
        language: language,
        topic: topic,
      };

      // Pusher broadcast
      await pusher.trigger(
        "svorum-strax-chat-channel",
        "conversation-update",
        conversationData,
      );

      return {
        success: true,
        postgresqlId: processResult.postgresqlId,
      };
    } else {
      return {
        success: false,
        error: processResult.error || "processing_error",
      };
    }
  } catch (error) {
    console.error("Error in broadcastConversation:", error.message);
    return { success: false, postgresqlId: null };
  }
};

// CORS
const corsOptions = {
  origin: [
    "http://localhost:3000",
    "http://localhost:8080", 
    "https://svorumstrax-website.vercel.app",
    "https://svorumstrax.is",
    "https://www.svorumstrax.is",
    "https://hysing.svorumstrax.is",
    // Add any other Svörum Strax domains here
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key"],
  credentials: true,
};

// Middleware
app.use(cors(corsOptions));

// NEW: Increase body size limit for images (10MB limit)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

console.log('📦 Body parser configured with 10MB limit for image/file uploads');

// Simple session storage
const sessions = new Map();

// API Key verification
const verifyApiKey = (req, res, next) => {
  const apiKey = req.header("x-api-key");

  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
};

// Health check
app.get("/", (_req, res) => {
  res.json({
    status: "OK",
    service: "Svörum strax AI Backend",
    timestamp: new Date().toISOString(),
    features: ["HTTP API", "WebSocket Streaming", "SSE Streaming", "Dynamic Prompts", "Image Analysis", "File Processing", "Voice Transcription", "Text-to-Speech"]
  });
});

// MongoDB test endpoint
app.get("/mongo-test", async (_req, res) => {
  try {
    console.log("MongoDB test endpoint accessed");
    const { db } = await connectToDatabase();

    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map((c) => c.name);

    res.status(200).json({
      success: true,
      message: "MongoDB connected successfully",
      collections: collectionNames,
      clientId: "svorum-strax",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("MongoDB test endpoint error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to connect to MongoDB",
      error: error.message,
    });
  }
});

// Response cache
const responseCache = new Map();

// ============================================================================
// VOICE TRANSCRIPTION ENDPOINT
// ============================================================================
app.post('/transcribe-audio', verifyApiKey, async (req, res) => {
  const startTime = Date.now();

  try {
    console.log('🎤 Voice transcription request received');

    const { audio, mimeType, language } = req.body;

    if (!audio) {
      console.error('❌ No audio data provided');
      return res.status(400).json({ error: 'Audio data is required' });
    }

    console.log('📦 Converting base64 audio to buffer...');
    const audioBuffer = Buffer.from(audio, 'base64');
    const audioSizeMB = (audioBuffer.length / (1024 * 1024)).toFixed(2);
    console.log(`📊 Audio size: ${audioSizeMB}MB`);

    const getExtension = (mime) => {
      if (!mime) return 'webm';
      if (mime.includes('webm')) return 'webm';
      if (mime.includes('mp3')) return 'mp3';
      if (mime.includes('wav')) return 'wav';
      if (mime.includes('m4a')) return 'm4a';
      if (mime.includes('ogg')) return 'ogg';
      return 'webm';
    };

    const extension = getExtension(mimeType);
    console.log(`🎵 Audio format: ${extension} (${mimeType || 'audio/webm'})`);

    // Create proper File object
    const audioFile = new File(
      [audioBuffer],
      `audio.${extension}`,
      { type: mimeType || 'audio/webm' }
    );

    console.log('🚀 Sending audio to OpenAI Transcription API...');
    console.log(`⚙️ Settings: whisper-1, language: ${language || 'AUTO'}`);

    const transcriptionArgs = {
      file: audioFile,
      model: 'whisper-1',
      ...(language ? { language } : {}),
    };

    const transcription = await openai.audio.transcriptions.create(transcriptionArgs);

    const transcribedText = transcription.text || transcription;

    const totalTime = Date.now() - startTime;
    console.log(`✅ Transcription complete in ${totalTime}ms`);
    console.log(`📝 Text (${transcribedText.length} chars): "${transcribedText.substring(0, 100)}..."`);
    
    res.json({
      success: true,
      text: transcribedText,
      duration: totalTime,
      audioSize: audioSizeMB
    });

  } catch (error) {
    console.error('❌ Voice transcription error:', error);
    console.error('Error details:', error.message);

    const totalTime = Date.now() - startTime;
    console.log(`⏱️ Error after: ${totalTime}ms`);

    res.status(500).json({
      success: false,
      error: 'Transcription failed',
      message: error.message
    });
  }
});

// ============================================================================
// TEXT-TO-SPEECH ENDPOINT
// ============================================================================
app.post('/text-to-speech', verifyApiKey, async (req, res) => {
  const startTime = Date.now();

  try {
    console.log('🔊 Text-to-speech request received');

    const { text, voice = 'nova', language } = req.body;

    if (!text) {
      console.error('❌ No text provided');
      return res.status(400).json({ error: 'Text is required' });
    }

    console.log(`🗣️ Generating speech: "${text.substring(0, 70)}..." (voice: ${voice})`);

    const mp3 = await openai.audio.speech.create({
      model: 'tts-1-hd',
      voice,
      input: text,
      speed: 1.0
    });
    
    // Convert response to buffer
    const buffer = Buffer.from(await mp3.arrayBuffer());

    const totalTime = Date.now() - startTime;
    console.log(`✅ Speech generated in ${totalTime}ms (${(buffer.length / 1024).toFixed(1)}KB)`);
    
    // Return audio as base64
    res.json({
      success: true,
      audio: buffer.toString('base64'),
      mimeType: 'audio/mpeg',
      duration: totalTime,
      size: buffer.length
    });

  } catch (error) {
    console.error('❌ TTS error:', error);
    console.error('Error details:', error.message);

    const totalTime = Date.now() - startTime;
    console.log(`⏱️ Error after: ${totalTime}ms`);

    res.status(500).json({
      success: false,
      error: 'TTS failed',
      message: error.message
    });
  }
});

console.log('🎤 Voice endpoints initialized:');
console.log('   - /transcribe-audio (Whisper)');
console.log('   - /text-to-speech (TTS)');

// SSE Streaming endpoint - WITH IMAGE AND FILE SUPPORT
app.post("/chat-stream", verifyApiKey, async (req, res) => {
  const startTime = Date.now();

  try {
    let userMessage, sessionId, language;
    
    if (req.body.messages && Array.isArray(req.body.messages)) {
      // OLD FORMAT: { messages: [...], threadId: "..." }
      const lastMessage = req.body.messages[req.body.messages.length - 1];
      userMessage = lastMessage?.content || "";
      sessionId = req.body.threadId || `session_${Date.now()}`;
      language = req.body.language;
      console.log("📥 Using OLD request format");
    } else {
      // NEW FORMAT: { message: "...", sessionId: "..." }
      userMessage = req.body.message;
      sessionId = req.body.sessionId || `session_${Date.now()}`;
      language = req.body.language;
      console.log("📥 Using NEW request format");
    }

    // NEW: Accept images and files in request
    const { images, files } = req.body;

    if (!userMessage && (!images || images.length === 0) && (!files || files.length === 0)) {
      return res.status(400).json({ error: 'Message, images, or files required' });
    }

    console.log("📡 SSE Stream Request:", userMessage);
    console.log("🔑 Session:", sessionId);
    console.log("🖼️ Images:", images?.length || 0);
    console.log("📄 Files:", files?.length || 0);

    // Set up Server-Sent Events headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    });

    // Send connection confirmation
    const streamId = `stream_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    res.write(`data: ${JSON.stringify({
      type: 'stream-connected',
      streamId: streamId,
      sessionId: sessionId
    })}\n\n`);

    // Get session and detect language
    const sessionInfo = await getOrCreateSession(sessionId);
    const detectedLanguage = language || (userMessage.match(/[áéíóúýþæðöÁÉÍÓÚÝÞÆÐÖ]/i) ? "is" : "en");
    
    // Session management
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        messages: [],
        createdAt: new Date(),
      });
    }
    const session = sessions.get(sessionId);

    // NEW: Extract text from files
    let fileContext = '';
    if (files && files.length > 0) {
      console.log(`📄 SSE: Processing ${files.length} files...`);
      fileContext = await processFiles(files);
      console.log(`✅ SSE: File text extracted: ${fileContext.length} chars`);
    }

    session.messages.push({
      role: "user",
      content: userMessage || (files && files.length > 0 ? '📄 [Skjal sent]' : '🖼️ [Mynd send]'),
    });

    // Get dynamic system prompt
    const systemPrompt = getSystemPrompt(detectedLanguage);

    // Prepare messages
    const messages = [
      {
        role: "system",
        content: systemPrompt,
      },
      ...session.messages.slice(-10),
    ];

    // NEW: Build the current user message content properly
    let finalUserMessage;
    
    if (fileContext && images && images.length > 0) {
      // BOTH files and images
      const contentParts = [
        {
          type: 'text',
          text: `${userMessage || 'Vinsamlegast greindu þessi gögn.'}\n\nDOCUMENT CONTENT:\n${fileContext.slice(0, 8000)}`
        }
      ];
      
      for (const image of images) {
        contentParts.push({
          type: 'image_url',
          image_url: {
            url: `data:${image.mimeType};base64,${image.data}`,
            detail: 'high'
          }
        });
      }
      
      messages[messages.length - 1] = { role: "user", content: contentParts };
      console.log('🖼️ SSE: Adding images and files to prompt');
      
    } else if (fileContext) {
      // ONLY files
      messages[messages.length - 1] = {
        role: "user",
        content: `${userMessage || 'Vinsamlegast greindu þetta skjal og gefðu álit.'}\n\nDOCUMENT CONTENT:\n${fileContext.slice(0, 8000)}`
      };
      
    } else if (images && images.length > 0) {
      // ONLY images
      const contentParts = [
        {
          type: 'text',
          text: userMessage || 'Hvað er þetta á myndinni?'
        }
      ];
      
      for (const image of images) {
        contentParts.push({
          type: 'image_url',
          image_url: {
            url: `data:${image.mimeType};base64,${image.data}`,
            detail: 'high'
          }
        });
      }
      
      messages[messages.length - 1] = { role: "user", content: contentParts };
      console.log('🖼️ SSE: Adding images to prompt');
    }

    // Create streaming completion
    const stream = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      temperature: 0.7,
      max_tokens: 800,
      stream: true
    });

    let fullResponse = '';
    let chunkNumber = 0;

    // Stream the response via SSE
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      
      if (content) {
        fullResponse += content;
        chunkNumber++;
        
        // Send chunk via SSE (same data as WebSocket)
        res.write(`data: ${JSON.stringify({
          type: 'stream-chunk',
          streamId: streamId,
          sessionId: sessionId,
          content: content,
          chunkNumber: chunkNumber
        })}\n\n`);
      }
    }

    // Add assistant response to session
    session.messages.push({
      role: "assistant",
      content: fullResponse,
    });

    // Send completion signal
    res.write(`data: ${JSON.stringify({
      type: 'stream-complete',
      streamId: streamId,
      sessionId: sessionId,
      completeContent: fullResponse
    })}\n\n`);

    // End the stream
    res.write(`data: [DONE]\n\n`);
    res.end();

    // Fire-and-forget analytics
    setImmediate(async () => {
      try {
        const detectedTopic = detectTopic(userMessage || 'file upload');
        await broadcastConversation(
          userMessage || (files && files.length > 0 ? '📄 [Skjal sent]' : '🖼️ [Mynd send]'),
          fullResponse,
          detectedLanguage,
          detectedTopic,
          "sse_streaming",
          sessionId,
          "active"
        );
        console.log('📊 SSE analytics sent');
      } catch (error) {
        console.error('❌ Error in SSE analytics:', error);
      }
    });

    const totalTime = Date.now() - startTime;
    console.log(`⏱️ SSE Stream completed in: ${totalTime}ms`);

  } catch (error) {
    console.error('❌ SSE Stream error:', error);
    
    try {
      res.write(`data: ${JSON.stringify({
        type: 'stream-error',
        error: error.message
      })}\n\n`);
      res.end();
    } catch (writeError) {
      console.error('❌ Could not send error response:', writeError);
    }
  }
});

// Main chat endpoint - WITH IMAGE AND FILE SUPPORT
app.post("/chat", verifyApiKey, async (req, res) => {
  const startTime = Date.now();

  try {
    let userMessage, sessionId, language;
    
    if (req.body.messages && Array.isArray(req.body.messages)) {
      // OLD FORMAT: { messages: [...], threadId: "..." }
      const lastMessage = req.body.messages[req.body.messages.length - 1];
      userMessage = lastMessage?.content || "";
      sessionId = req.body.threadId || `session_${Date.now()}`;
      language = req.body.language;
      console.log("📥 Using OLD request format");
    } else {
      // NEW FORMAT: { message: "...", sessionId: "..." }
      userMessage = req.body.message;
      sessionId = req.body.sessionId || `session_${Date.now()}`;
      language = req.body.language;
      console.log("📥 Using NEW request format");
    }

    // NEW: Accept images and files
    const { images, files } = req.body;

    if (!userMessage && (!images || images.length === 0) && (!files || files.length === 0)) {
      return res.status(400).json({ error: 'Message, images, or files required' });
    }

    console.log("📥 Message:", userMessage);
    console.log("🔑 Session:", sessionId);
    console.log("🖼️ Images:", images?.length || 0);
    console.log("📄 Files:", files?.length || 0);

    // Simple language detection
    const detectedLanguage = language || (userMessage?.match(/[áéíóúýþæðöÁÉÍÓÚÝÞÆÐÖ]/i) ? "is" : "en");
    console.log("🌐 Language detected:", detectedLanguage);

    // Check cache
    const cacheKey = `${sessionId}:${userMessage?.toLowerCase().trim()}:${detectedLanguage}:${images?.length || 0}:${files?.length || 0}`;
    const cached = responseCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < 3600000) {
      // 1 hour cache
      console.log("📦 Using cached response");
      return res.json(cached.response);
    }

    // Get session
    const sessionInfo = await getOrCreateSession(sessionId);
    console.log("📊 Using conversation ID:", sessionInfo.conversationId);

    // Session management
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        messages: [],
        createdAt: new Date(),
      });
    }
    const session = sessions.get(sessionId);

    // NEW: Extract text from files
    let fileContext = '';
    if (files && files.length > 0) {
      console.log(`📄 HTTP: Processing ${files.length} files...`);
      fileContext = await processFiles(files);
      console.log(`✅ HTTP: File text extracted: ${fileContext.length} chars`);
    }

    session.messages.push({
      role: "user",
      content: userMessage || (files && files.length > 0 ? '📄 [Skjal sent]' : '🖼️ [Mynd send]'),
    });

    // Keep only last 10 messages
    if (session.messages.length > 10) {
      session.messages = session.messages.slice(-10);
    }

    // Get system prompt
    const systemPrompt = getSystemPrompt(detectedLanguage);

    // Build messages
    const messages = [
      {
        role: "system",
        content: systemPrompt,
      },
      ...session.messages,
    ];

    // Handle images/files in HTTP mode (non-streaming)
    if (images && images.length > 0) {
      // Replace last message with image content
      const contentParts = [
        {
          type: 'text',
          text: userMessage || 'Hvað er þetta á myndinni?'
        }
      ];
      
      for (const image of images) {
        contentParts.push({
          type: 'image_url',
          image_url: {
            url: `data:${image.mimeType};base64,${image.data}`,
            detail: 'high'
          }
        });
      }
      
      messages[messages.length - 1] = { role: "user", content: contentParts };
    } else if (fileContext) {
      messages[messages.length - 1] = {
        role: "user",
        content: `${userMessage || 'Vinsamlegast greindu þetta skjal.'}\n\nDOCUMENT CONTENT:\n${fileContext.slice(0, 8000)}`
      };
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      temperature: 0.7,
      max_tokens: 800,
    });

    const response = completion.choices[0].message.content;

    session.messages.push({
      role: "assistant",
      content: response,
    });

    // Topic detection
    const detectedTopic = detectTopic(userMessage || 'file upload');

    // Cache the response  
    const responseData = {
      message: response,
      sessionId: sessionId,
      threadId: sessionId,
      postgresqlMessageId: null,
      language: {
        detected: detectedLanguage,
        isIcelandic: detectedLanguage === "is"
      },
      topic: detectedTopic,
      debugInfo:
        process.env.NODE_ENV === "development"
          ? {
              topic: detectedTopic,
              promptLength: systemPrompt.length,
            }
          : undefined,
    };

    responseCache.set(cacheKey, {
      response: responseData,
      timestamp: Date.now(),
    });

    // Fire-and-forget broadcasting
    setImmediate(async () => {
      try {
        const broadcastResult = await broadcastConversation(
          userMessage || (files && files.length > 0 ? '📄 [Skjal sent]' : '🖼️ [Mynd send]'),
          response,
          detectedLanguage,
          detectedTopic,
          "chat",
          sessionId,
          "active",
        );

        // Update cache with PostgreSQL ID if available
        if (broadcastResult.postgresqlId && cached) {
          cached.response.postgresqlMessageId = broadcastResult.postgresqlId;
        }

        console.log("📊 Analytics broadcast result:", broadcastResult);
        console.log("📈 Topic categorized as:", detectedTopic);
        console.log("🌍 Language sent:", detectedLanguage);
      } catch (error) {
        console.error("❌ Error in broadcast function:", error);
      }
    });

    // Log performance
    const totalTime = Date.now() - startTime;
    console.log(`⏱️ Response time: ${totalTime}ms`);

    // Send response immediately
    res.json(responseData);
  } catch (error) {
    console.error("❌ Error:", error);
    const totalTime = Date.now() - startTime;
    console.log(`⏱️ Error after: ${totalTime}ms`);

    res.status(500).json({
      message: "Fyrirgefðu, eitthvað fór úrskeiðis. Vinsamlegast reyndu aftur. / Sorry, something went wrong. Please try again.",
      error: error.message,
    });
  }
});

// Feedback endpoint
app.post('/feedback', verifyApiKey, async (req, res) => {
  try {
    const { messageId, isPositive, messageContent, timestamp, chatId, language, postgresqlId } = req.body;
    
    console.log('📝 Feedback received:', {
      messageId,
      postgresqlId,
      isPositive,
      hasContent: !!messageContent
    });
    
    const { db } = await connectToDatabase();
    
    await db.collection('message_feedback').insertOne({
      messageId,
      postgresqlId,
      isPositive,
      messageContent,
      timestamp: new Date(timestamp),
      chatId,
      language,
      createdAt: new Date(),
      source: 'svorum-strax-chatbot'
    });
    
    console.log('💾 Feedback saved to MongoDB');

    // Forward to analytics
    try {
      const analyticsResponse = await fetch('https://hysing.svorumstrax.is/api/public-feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messageId: messageId,
          postgresqlId: postgresqlId,
          rating: isPositive,
          comment: messageContent,
          source: 'svorum-strax-chatbot'
        })
      });  
      
      if (analyticsResponse.ok) {
        console.log('✅ Feedback successfully forwarded to analytics');
      }
    } catch (forwardError) {
      console.error('❌ Error forwarding feedback:', forwardError);
    }
    
    return res.status(200).json({
      success: true,
      message: 'Feedback stored successfully'
    });
  } catch (error) {
    console.error('❌ Error storing feedback:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to store feedback'
    });
  }
});

// Cleanup cache periodically
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  for (const [key, value] of responseCache.entries()) {
    if (value.timestamp < oneHourAgo) {
      responseCache.delete(key);
    }
  }
}, 3600000);

// Start server with WebSocket support
server.listen(PORT, () => {
  console.log(`\n🌊 Svörum strax Backend Started`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`🔌 WebSocket server ready for streaming`);
  console.log(`✅ Ready for connections\n`);
  
  // Performance features loaded
  console.log(`📚 Performance Features Loaded:`);
  console.log(`   - Dynamic system prompts (IS/EN)`);
  console.log(`   - Response caching (1 hour TTL)`);
  console.log(`   - Fire-and-forget analytics`);
  console.log(`   - Performance logging`);
  console.log(`   - Cache cleanup intervals`);
  console.log(`   - WebSocket streaming support`);
  console.log(`   - SSE streaming support`);
  console.log(`   - 🖼️ Image analysis (GPT-4o vision)`);
  console.log(`   - 📄 File processing (PDF, Word, Excel)`);
  console.log(`   - 🎤 Voice transcription (Whisper API)`);
  console.log(`   - 🔊 Text-to-speech (TTS)\n`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
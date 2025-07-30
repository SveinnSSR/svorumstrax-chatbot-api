import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import OpenAI from "openai";
import Pusher from "pusher";

// Import the analytics modules (same as ELKO/Sky Lagoon)
import { connectToDatabase } from "../database.js";
import { getOrCreateSession } from "../sessionManager.js";
import { processMessagePair } from "../messageProcessor.js";

// Configuration
const PORT = process.env.PORT || 8080;
const API_KEY = process.env.API_KEY || "svorum2025_sk3j8k4j5k6j7k8j9k0j1k2";

// Initialize Express
const app = express();
app.set("trust proxy", 1);

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Pusher (same as ELKO/Sky Lagoon)
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});

// Broadcast conversation function (same pattern as ELKO/Sky Lagoon)
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
    // Skip processing for empty messages
    if (!userMessage || !botResponse) {
      console.log("Skipping broadcast for empty message");
      return { success: false, reason: "empty_message" };
    }

    // Use the message processor for MongoDB and analytics
    const processResult = await processMessagePair(userMessage, botResponse, {
      sessionId: clientSessionId,
      language: language,
      topic: topic,
      type: type,
      clientId: "svorum-strax", // IMPORTANT: This identifies Svörum strax conversations
      status: status,
    });

    // Check if processing was successful
    if (processResult.success) {
      // Get session info
      const sessionInfo = await getOrCreateSession(clientSessionId);

      // Create conversation data for Pusher
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

      // Broadcast via Pusher (use svorum-strax channel)
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

// CORS - Simple setup (same as ELKO)
const corsOptions = {
  origin: [
    "http://localhost:3000",
    "http://localhost:8080",
    "https://svorumstrax-website.vercel.app",
    "https://svorumstrax.is",
    "https://hysing.svorumstrax.is",
  ],
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "x-api-key"],
  credentials: true,
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json());

// Simple session storage (same as ELKO)
const sessions = new Map();

// Response cache for speed optimization
const responseCache = new Map();

// API Key verification (same as ELKO)
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
  });
});

// MongoDB test endpoint (same as ELKO)
app.get("/mongo-test", async (_req, res) => {
  try {
    console.log("MongoDB test endpoint accessed");
    const { db } = await connectToDatabase();

    // Check if connection works
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

// System prompt for Svörum strax
const SYSTEM_PROMPT = `You are a helpful AI assistant for Svörum strax, an Icelandic customer service outsourcing company based in Barcelona, Spain. You should be friendly, professional, and knowledgeable about all aspects of the company.

COMPANY INFORMATION:
- Name: Svörum strax
- Location: Barcelona, Spain
- Founded: 2019
- Employees: 35+ Icelandic specialists
- Services 100+ Icelandic companies
- Owner: El MUNDO BUENO DE ISLANDIA, SOCIEDAD LIMITADA

SERVICES:
1. Phone Answering (Símsvörun):
   - General receptionist services
   - Specialized customer service with fully trained staff
   - Answer in company's name, take messages, forward calls

2. Email Service (Tölvupóstþjónusta):
   - Professional email responses
   - Categorize and prioritize inquiries
   - Forward complex matters to appropriate departments

3. AI Chat Service:
   - 24/7 availability
   - Learns from every conversation
   - Provides instant information
   - Escalates complex issues to human specialists

4. AI Voice Service:
   - Advanced voice recognition
   - Natural voice responses in Icelandic and 100+ languages
   - Emotion detection and adaptive conversations

5. Business Analytics (Viðskiptagreining):
   - AI analyzes all interactions
   - Identifies patterns and sales opportunities
   - Demand forecasting
   - Operational insights

6. Outbound Calling (Úthringiþjónusta):
   - Experienced B2B and B2C sales teams
   - Modern CRM systems
   - Performance tracking

7. Staff Leasing (Stöðugildi til leigu):
   - Dedicated employees without administrative overhead
   - Fully trained staff working exclusively for client

8. Custom Solutions:
   - Tailored to client's environment and needs
   - Process design and technology implementation

KEY BENEFITS:
- Up to 40% more cost-effective than similar services in Iceland
- Smart integration of human expertise and AI technology
- Measurable results: 500,000+ calls and emails per year
- Real-time business insights through AI analysis
- Setup within 15-30 days

WORKING AT SVÖRUM STRAX:
For Icelanders interested in working in Barcelona:
- Always looking for dynamic individuals for remote work and office positions
- Good income opportunities (NIE Spanish ID required for remote work)
- Flexible working hours - both day and evening shifts
- Help with accommodation, Spanish ID, and relocation
- Great opportunity to experience new culture and learn Spanish
- One of the largest Icelandic workplaces in Spain

Job Requirements:
- Experience in phone service (preferred)
- Sales experience (preferred)
- Good Icelandic skills in writing and speaking
- Positive attitude and service mindset
- Good communication skills
- Resourcefulness

Benefits:
- Fixed salary plus performance bonuses
- Living in one of Europe's most exciting cities
- Sunny weather and Mediterranean lifestyle
- Lower cost of living
- International work environment
- Career development opportunities

To apply: Send CV to svorumstrax@svorumstrax.is

PHILOSOPHY:
"We believe competitive advantage comes from employee satisfaction. We help Icelandic companies grow by improving their service without increasing their staff count."

When answering questions:
- Be helpful and informative
- Emphasize both AI and human services equally
- Highlight cost savings and efficiency
- Encourage interested job seekers
- Provide contact information when relevant
- Use a warm, professional tone
- Answer in the same language as the question (Icelandic or English)`;

// OPTIMIZED CHAT ENDPOINT - Speed optimized like Sky Lagoon and ELKO
app.post("/chat", verifyApiKey, async (req, res) => {
  const startTime = Date.now();

  try {
    const { message, sessionId } = req.body;

    console.log("📥 Message:", message);
    console.log("🔑 Session:", sessionId);

    // OPTIMIZATION 1: Early cache check (like ELKO and Sky Lagoon)
    const detectedLanguage = message.match(/[áéíóúýþæðöÁÉÍÓÚÝÞÆÐÖ]/i) ? "is" : "en";
    const cacheKey = `${sessionId}:${message.toLowerCase().trim()}:${detectedLanguage}`;
    const cached = responseCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < 3600000) {
      // 1 hour cache (can be extended for production)
      console.log("📦 Using cached response");
      const totalTime = Date.now() - startTime;
      console.log(`⏱️ Response time (cached): ${totalTime}ms`);
      return res.json(cached.response);
    }

    console.log("🌐 Language detected:", detectedLanguage);

    // OPTIMIZATION 2: Get session info early
    const sessionInfo = await getOrCreateSession(sessionId);
    console.log("📊 Using conversation ID:", sessionInfo.conversationId);

    // Get or create local session for chat history
    if (!sessions.has(sessionId)) {
      sessions.set(sessionId, {
        messages: [],
        createdAt: new Date(),
      });
    }
    const session = sessions.get(sessionId);

    // Add user message to session
    session.messages.push({
      role: "user",
      content: message,
    });

    // Keep only last 10 messages
    if (session.messages.length > 10) {
      session.messages = session.messages.slice(-10);
    }

    // Prepare messages for OpenAI
    const messages = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
      ...session.messages,
    ];

    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: messages,
      temperature: 0.7,
      max_tokens: 500,
    });

    const response = completion.choices[0].message.content;

    // Add assistant response to session
    session.messages.push({
      role: "assistant",
      content: response,
    });

    // Simple topic detection
    const detectedTopic = /\b(job|work|employment|störf|vinna)\b/i.test(message)
      ? "employment"
      : /\b(service|þjónusta|símsvörun|tölvupóstur)\b/i.test(message)
        ? "services"
        : /\b(price|verð|cost|kostnaður)\b/i.test(message)
          ? "pricing"
          : /\b(contact|tengiliður|information|upplýsingar)\b/i.test(message)
            ? "contact"
            : "general";

    // OPTIMIZATION 3: Prepare response data
    const responseData = {
      message: response,
      sessionId: sessionId,
      postgresqlMessageId: null, // Will be updated asynchronously if needed
      language: {
        detected: detectedLanguage,
        isIcelandic: detectedLanguage === "is"
      },
      topic: detectedTopic
    };

    // OPTIMIZATION 4: Cache the response
    responseCache.set(cacheKey, {
      response: responseData,
      timestamp: Date.now(),
    });

    // OPTIMIZATION 5: Performance logging (like Sky Lagoon and ELKO)
    const totalTime = Date.now() - startTime;
    console.log(`⏱️ Response time: ${totalTime}ms`);

    // OPTIMIZATION 6: Send response immediately (FIRE-AND-FORGET ANALYTICS)
    res.json(responseData);

    // FIRE-AND-FORGET: Analytics happen in background - DON'T WAIT!
    // This is the KEY optimization that makes it fast like Sky Lagoon and ELKO
    setImmediate(async () => {
      try {
        console.log("📨 Broadcasting response in background for session:", sessionId);
        
        const broadcastResult = await broadcastConversation(
          message,
          response,
          detectedLanguage,
          detectedTopic,
          "chat",
          sessionId,
          "active"
        );

        // Update cache with PostgreSQL ID if available (for feedback functionality)
        if (broadcastResult.postgresqlId && cached) {
          cached.response.postgresqlMessageId = broadcastResult.postgresqlId;
        }

        console.log("📊 Analytics broadcast result:", broadcastResult);
        console.log("📈 Topic categorized as:", detectedTopic);
        console.log("🌍 Language sent:", detectedLanguage);
        console.log("✅ Analytics saved successfully in background");
      } catch (error) {
        console.error("❌ Error in background analytics (user already has response):", error);
      }
    });

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

// Feedback endpoint (same as ELKO pattern with Svörum strax branding)
app.post('/feedback', verifyApiKey, async (req, res) => {
  try {
    const { messageId, isPositive, messageContent, timestamp, chatId, language, postgresqlId } = req.body;
    
    console.log('\n📝 Feedback received:', {
      messageId,
      postgresqlId,
      isPositive,
      hasContent: !!messageContent
    });
    
    // Connect to MongoDB  
    const { db } = await connectToDatabase();
    
    // Store feedback in MongoDB
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

    // Forward feedback to analytics system
    try {
      console.log('📤 Forwarding feedback to analytics system');
      
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
      } else {
        const responseText = await analyticsResponse.text();
        console.error('❌ Error from analytics:', responseText);
      }
    } catch (forwardError) {
      console.error('❌ Error forwarding feedback:', forwardError);
    }
    
    return res.status(200).json({
      success: true,
      message: 'Feedback stored successfully'
    });
  } catch (error) {
    console.error('\n❌ Error storing feedback:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to store feedback'
    });
  }
});

// Response cache cleanup (like Sky Lagoon and ELKO)
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  for (const [key, value] of responseCache.entries()) {
    if (value.timestamp < oneHourAgo) {
      responseCache.delete(key);
    }
  }
}, 3600000); // Clean every hour

// Start server (same as ELKO)
const server = app.listen(PORT, () => {
  console.log(`\n🚀 Svörum strax Backend Started (OPTIMIZED)`);
  console.log(`📍 Port: ${PORT}`);
  console.log(`✅ Ready for connections`);
  console.log(`⚡ Speed optimizations enabled:`);
  console.log(`   - Fire-and-forget analytics`);
  console.log(`   - Response caching (1 hour TTL)`);
  console.log(`   - Performance logging`);
  console.log(`   - Early cache checking\n`);
});

// Graceful shutdown (same as ELKO)
process.on("SIGTERM", () => {
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});
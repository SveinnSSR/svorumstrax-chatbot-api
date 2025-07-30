// Enhanced Svörum strax Chatbot API with Analytics Integration
import dotenv from "dotenv";
dotenv.config();

// Core dependencies
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import Pusher from "pusher";

// Analytics Integration Imports
import { connectToDatabase } from "../database.js";
import { processMessagePair } from "../messageProcessor.js";
import { getOrCreateSession } from "../sessionManager.js";

console.log("🚀 SVÖRUM STRAX SERVER STARTING - " + new Date().toISOString());
console.log("Environment check - NODE_ENV:", process.env.NODE_ENV);
console.log("MONGODB_URI exists:", !!process.env.MONGODB_URI);
console.log("ANALYTICS_API_KEY exists:", !!process.env.ANALYTICS_API_KEY);

// Initialize Pusher with your credentials
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});

// Enhanced broadcastConversation function that integrates with analytics
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
      clientId: "svorum-strax", // Set to Svörum strax client ID
      status: status,
    });

    // Check if processing was successful
    if (processResult.success) {
      // Handle Pusher broadcasting for real-time updates
      try {
        const sessionInfo = await getOrCreateSession(clientSessionId);

        // Create minimal conversation data for Pusher
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
          "chat-channel",
          "conversation-update",
          conversationData,
        );
        console.log("✅ Pusher broadcast sent successfully");
      } catch (pusherError) {
        console.error("Pusher error:", pusherError.message);
        // Continue even if Pusher fails - critical data is already saved
      }

      return {
        success: true,
        postgresqlId: processResult.postgresqlId,
      };
    } else if (processResult.error === "duplicate_message") {
      return {
        success: true,
        postgresqlId: null,
        deduplicated: true,
      };
    } else {
      console.log(
        "Message processor error:",
        processResult.error,
        processResult.reason,
      );
      return {
        success: false,
        postgresqlId: null,
        error: processResult.error || "processing_error",
      };
    }
  } catch (error) {
    console.error("Error in broadcastConversation:", error.message);
    return { success: false, postgresqlId: null };
  }
};

// Configuration
const config = {
  PORT: process.env.PORT || "8080",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  API_KEY: process.env.API_KEY,
};

// Initialize Express
const app = express();
app.set("trust proxy", 1);

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

// CORS Configuration - Enhanced for analytics integration
const corsOptions = {
  origin: [
    "http://localhost:3000",
    "http://localhost:8000",
    "http://localhost:8080",
    "https://svorumstrax-website.vercel.app",
    "https://svorumstrax.is",
    "https://hysing.svorumstrax.is", // Analytics dashboard
  ],
  methods: ["GET", "POST", "OPTIONS", "HEAD"],
  allowedHeaders: ["Content-Type", "x-api-key", "Authorization"],
  credentials: true,
};

// Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: { error: "Too many requests. Please try again later." },
});

// System prompt for Svörum strax chatbot
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

// API Key verification middleware
const verifyApiKey = (req, res, next) => {
  const apiKey = req.header("x-api-key");
  console.log("\n🔑 API Key Check:", {
    receivedKey: apiKey,
    configuredKey: process.env.API_KEY,
    matches: apiKey === process.env.API_KEY,
  });

  if (!apiKey || apiKey !== process.env.API_KEY) {
    console.error("❌ Invalid or missing API key");
    return res.status(401).json({ error: "Unauthorized request" });
  }
  next();
};

// Middleware
app.use(cors(corsOptions));
app.use(limiter);
app.use(express.json());

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`⚡ REQUEST: ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    status: "OK",
    service: "Svörum strax Chatbot API",
    timestamp: new Date().toISOString(),
    config: {
      openaiConfigured: !!config.OPENAI_API_KEY,
      apiKeyConfigured: !!config.API_KEY,
      mongodbConfigured: !!process.env.MONGODB_URI,
      analyticsEnabled: true,
    },
  });
});

// MongoDB test endpoint
app.get("/mongo-test", async (req, res) => {
  try {
    console.log("MongoDB test endpoint accessed");
    const { db } = await connectToDatabase();

    // Check if connection works by listing collections
    const collections = await db.listCollections().toArray();
    const collectionNames = collections.map((c) => c.name);

    res.status(200).json({
      success: true,
      message: "MongoDB connected successfully",
      collections: collectionNames,
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

// Enhanced chat endpoint with analytics integration
app.post("/chat", verifyApiKey, async (req, res) => {
  const startTime = Date.now();

  try {
    const { messages, threadId, sessionId } = req.body;
    const clientSessionId =
      sessionId ||
      threadId ||
      `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    console.log("\n📥 Incoming Request:", {
      sessionId: clientSessionId,
      messageCount: messages?.length || 0,
      hasMessages: !!messages,
    });

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Messages array is required" });
    }

    // Get the user's last message
    const userMessage = messages[messages.length - 1]?.content || "";
    console.log("\n💬 User Message:", userMessage);

    // Create chat completion with enhanced system prompt
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      temperature: 0.7,
      max_tokens: 500,
    });

    const botResponse = completion.choices[0].message.content;
    console.log("\n🤖 Bot Response:", botResponse);

    // Detect language (simple detection based on common patterns)
    const isIcelandic =
      /[þæðöáíúéó]/.test(userMessage) ||
      /\b(og|að|er|það|við|ekki|ég|þú|hann|hún|hvað|hvar|hvenær)\b/i.test(
        userMessage,
      );
    const language = isIcelandic ? "is" : "en";

    // Determine topic based on message content
    let topic = "general";
    if (/\b(job|work|employment|störf|vinna)\b/i.test(userMessage)) {
      topic = "employment";
    } else if (
      /\b(service|þjónusta|símsvörun|tölvupóstur)\b/i.test(userMessage)
    ) {
      topic = "services";
    } else if (/\b(price|verð|cost|kostnaður)\b/i.test(userMessage)) {
      topic = "pricing";
    } else if (
      /\b(contact|tengiliður|information|upplýsingar)\b/i.test(userMessage)
    ) {
      topic = "contact";
    }

    // Broadcast conversation to analytics system
    let postgresqlMessageId = null;
    try {
      const broadcastResult = await broadcastConversation(
        userMessage,
        botResponse,
        language,
        topic,
        "chat",
        clientSessionId,
        "active",
      );

      if (broadcastResult.success) {
        postgresqlMessageId = broadcastResult.postgresqlId;
        console.log("✅ Conversation successfully sent to analytics");
      } else {
        console.log("⚠️ Analytics broadcast failed:", broadcastResult.error);
      }
    } catch (analyticsError) {
      console.error("❌ Analytics integration error:", analyticsError);
      // Continue without failing the main response
    }

    const processingTime = Date.now() - startTime;
    console.log(`\n⏱️ Total processing time: ${processingTime}ms`);

    // Return response to client
    res.status(200).json({
      message: botResponse,
      threadId: clientSessionId,
      postgresqlMessageId: postgresqlMessageId,
      language: {
        detected: language,
        isIcelandic: isIcelandic,
      },
      topic: topic,
      processingTime: processingTime,
    });
  } catch (error) {
    console.error("OpenAI API error:", error);

    const processingTime = Date.now() - startTime;

    // Send user-friendly error message
    let errorMessage = "An error occurred processing your request.";
    if (error.response?.status === 401) {
      errorMessage = "Authentication error. Please check API configuration.";
    } else if (error.response?.status === 429) {
      errorMessage = "Too many requests. Please try again later.";
    }

    // Try to broadcast error to analytics
    try {
      await broadcastConversation(
        req.body.messages?.[req.body.messages.length - 1]?.content || "unknown",
        errorMessage,
        "en",
        "error",
        "error",
        req.body.sessionId || req.body.threadId,
        "error",
      );
    } catch (analyticsError) {
      console.error(
        "❌ Error broadcasting error to analytics:",
        analyticsError,
      );
    }

    res.status(500).json({
      error: errorMessage,
      processingTime: processingTime,
    });
  }
});

// Feedback endpoint for analytics integration
app.post("/feedback", verifyApiKey, async (req, res) => {
  try {
    const {
      messageId,
      isPositive,
      messageContent,
      timestamp,
      chatId,
      language,
      postgresqlId,
    } = req.body;

    console.log("\n📝 Feedback received:", {
      messageId,
      postgresqlId,
      isPositive,
      hasContent: !!messageContent,
    });

    // Connect to MongoDB
    const { db } = await connectToDatabase();

    // Store feedback in MongoDB
    await db.collection("message_feedback").insertOne({
      messageId,
      postgresqlId,
      isPositive,
      messageContent,
      timestamp: new Date(timestamp),
      chatId,
      language,
      createdAt: new Date(),
      source: "svorum-strax-chatbot",
    });

    console.log("💾 Feedback saved to MongoDB");

    // Forward feedback to analytics system
    try {
      console.log("📤 Forwarding feedback to analytics system");

      const analyticsResponse = await fetch(
        "https://hysing.svorumstrax.is/api/public-feedback",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messageId: messageId,
            postgresqlId: postgresqlId,
            rating: isPositive,
            comment: messageContent,
            source: "svorum-strax-chatbot",
          }),
        },
      );

      if (analyticsResponse.ok) {
        console.log("✅ Feedback successfully forwarded to analytics");
      } else {
        const responseText = await analyticsResponse.text();
        console.error("❌ Error from analytics:", responseText);
      }
    } catch (forwardError) {
      console.error("❌ Error forwarding feedback:", forwardError);
    }

    return res.status(200).json({
      success: true,
      message: "Feedback stored successfully",
    });
  } catch (error) {
    console.error("\n❌ Error storing feedback:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to store feedback",
    });
  }
});

// Analytics proxy endpoint to handle CORS issues
app.post("/analytics-proxy", async (req, res) => {
  console.log("📤 Analytics proxy request received:", req.body);
  try {
    const response = await fetch(
      "https://hysing.svorumstrax.is/api/public-feedback",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
      },
    );

    const data = await response.json();
    console.log("✅ Analytics system response:", data);
    res.json(data);
  } catch (error) {
    console.error("❌ Analytics proxy error:", error);
    res.status(500).json({ error: "Proxy error", message: error.message });
  }
});

// Start server
const PORT = config.PORT;
const server = app.listen(PORT, () => {
  console.log("\n🚀 Svörum strax Server Status:");
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  console.log(`Port: ${PORT}`);
  console.log(`Time: ${new Date().toLocaleString()}`);
  console.log("\n⚙️ Configuration:");
  console.log(`OpenAI API Key configured: ${!!config.OPENAI_API_KEY}`);
  console.log(`API Key configured: ${!!config.API_KEY}`);
  console.log(`MongoDB URI configured: ${!!process.env.MONGODB_URI}`);
  console.log(`Analytics integration: ENABLED`);
  console.log(`Pusher configured: ${!!process.env.PUSHER_APP_ID}`);
});

// Enhanced error handling
server.on("error", (error) => {
  console.error("❌ Server startup error:", error);
  process.exit(1);
});

process.on("uncaughtException", (error) => {
  console.error("❌ Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("❌ Unhandled Rejection:", reason);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\n⚠️ SIGTERM received: closing HTTP server");
  server.close(() => {
    console.log("✅ HTTP server closed");
    process.exit(0);
  });
});

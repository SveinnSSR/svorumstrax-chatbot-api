const OpenAI = require('openai');
const cors = require('cors');

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || allowedOrigins.includes('*')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
};

// System prompt with all Svörum strax information
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

// Helper function to handle CORS
const corsMiddleware = (handler) => {
  return async (req, res) => {
    // Handle CORS
    await new Promise((resolve, reject) => {
      cors(corsOptions)(req, res, (result) => {
        if (result instanceof Error) {
          return reject(result);
        }
        return resolve(result);
      });
    });

    // Handle OPTIONS request
    if (req.method === 'OPTIONS') {
      return res.status(200).end();
    }

    // Call the actual handler
    return handler(req, res);
  };
};

// Main handler
async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages, threadId } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    // Create chat completion
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview', // or 'gpt-4-0125-preview' for latest
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const reply = completion.choices[0].message.content;

    res.status(200).json({
      message: reply,
      threadId: threadId || 'default',
    });

  } catch (error) {
    console.error('OpenAI API error:', error);
    
    // Send user-friendly error message
    if (error.response?.status === 401) {
      res.status(500).json({ error: 'Authentication error. Please check API configuration.' });
    } else if (error.response?.status === 429) {
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
    } else {
      res.status(500).json({ error: 'An error occurred processing your request.' });
    }
  }
}

// Export the handler with CORS middleware
module.exports = corsMiddleware(handler);

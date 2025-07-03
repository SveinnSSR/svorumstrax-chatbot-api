Svörum strax Chatbot API
AI-powered chatbot API for Svörum strax website using OpenAI GPT-4.

Features
🤖 Powered by GPT-4 for intelligent conversations
🌐 Full knowledge about Svörum strax services and employment
🔐 CORS protection for secure API access
💬 Bilingual support (Icelandic/English)
📊 Conversation context management
⚡ Serverless deployment on Vercel
Setup
1. Environment Variables
Add these to your Vercel project settings:

OPENAI_API_KEY=sk-...your-openai-api-key
ALLOWED_ORIGINS=https://svorumstrax.is,https://svorumstrax-website.vercel.app,http://localhost:8000
2. Local Development
bash
# Install dependencies
npm install

# Create .env file for local development
cp .env.example .env
# Edit .env and add your OpenAI API key

# Run locally
vercel dev
3. Deployment
bash
# Deploy to Vercel
vercel --prod
API Endpoints
POST /api/chat
Send a message to the chatbot and receive a response.

Request Body:

json
{
  "messages": [
    {
      "role": "user",
      "content": "Hvað kostar símsvörun?"
    }
  ],
  "threadId": "optional-conversation-id"
}
Response:

json
{
  "message": "Símsvörun hjá Svörum strax er allt að 40% hagstæðari en sambærileg þjónusta á Íslandi...",
  "threadId": "optional-conversation-id"
}
Integration Example
javascript
const response = await fetch('https://svorumstrax-chatbot-api.vercel.app/api/chat', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    messages: [
      { role: 'user', content: 'Tell me about your services' }
    ]
  })
});

const data = await response.json();
console.log(data.message);
Chatbot Knowledge Base
The chatbot knows about:

All Svörum strax services (phone, email, AI chat, voice, analytics, etc.)
Pricing information (40% more cost-effective than Iceland)
Employment opportunities in Barcelona
Company history and philosophy
Setup timeframes (15-30 days)
Contact information
Security
CORS protection ensures only authorized domains can access the API
API key is securely stored in environment variables
Rate limiting handled by Vercel
Support
For issues or questions, contact: svorumstrax@svorumstrax.is



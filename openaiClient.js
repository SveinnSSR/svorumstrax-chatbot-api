// openaiClient.js
// ============================================================================================
// SHARED OpenAI / Azure OpenAI CLIENT FACTORY for the Svörum strax website chatbot.
//
// Fourth and last of the live chatbots to move onto our Azure OpenAI resource (Sweden Central,
// EUR Data Zone) for GDPR. Same factory as sky-lagoon-chat-2024, drifa-chatbot and
// svorumstrax-assistant, so all four behave identically and there is one pattern to maintain.
//
// This one is the simplest of the four: chat only. There is no vector search and no embeddings
// anywhere in this repo, so there is no index to keep compatible — the risk that dominated the
// Drífa and Sky Lagoon migrations does not exist here.
//
// DEPLOYMENT NAME = MODEL ID on Azure: the `model` string passed to the SDK IS the Azure deployment
// name. Our resource deploys gpt-5.1, gpt-5-mini and text-embedding-3-small.
//
// AUDIO STAYS OPENAI-DIRECT: whisper-1 (transcription) and tts-1-hd (speech) are not on our Azure
// resource, so they use the separate `audioOpenai` client and still depend on the OpenAI account.
//
// ROLLBACK: unset AZURE_OPENAI_ENDPOINT → everything returns to OpenAI-direct with gpt-4o.

import OpenAI, { AzureOpenAI } from "openai";
// Load .env HERE as well as in index.js: this module reads process.env at import time, and ES module
// imports are evaluated BEFORE the importing module's body runs, so index.js's own dotenv.config()
// would be too late. (Exactly the trap that broke local dev in the Sky Lagoon repo.)
import dotenv from "dotenv";
dotenv.config();

const AZURE = !!process.env.AZURE_OPENAI_ENDPOINT;

// ── Chat client — Azure (EU/GDPR) when configured, else OpenAI direct ─────────────────────────
export const openai = AZURE
  ? new AzureOpenAI({
      endpoint: process.env.AZURE_OPENAI_ENDPOINT,
      apiKey: process.env.AZURE_OPENAI_KEY,
      // GPT-5 reasoning params (reasoning_effort, max_completion_tokens) need a recent api-version.
      apiVersion: process.env.AZURE_OPENAI_API_VERSION || "2024-12-01-preview",
    })
  : new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Audio client — ALWAYS OpenAI direct (whisper-1 transcription + tts-1-hd speech) ───────────
export const audioOpenai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Reasoning-model parameter adaptation (GPT-5 on the EUR Data Zone) ─────────────────────────
// GPT-5 models are REASONING models and differ from gpt-4o in three params:
//   • temperature — only the default is accepted (a custom value 400s) → stripped.
//   • max_tokens  — renamed to max_completion_tokens + headroom, since reasoning tokens draw from
//                   the same budget and a tight cap would be spent before any visible output.
//   • reasoning_effort — defaulted to 'minimal' to keep this customer-facing chat fast and cheap.
// Applied ONLY to reasoning models, so gpt-4o passes through untouched and OpenAI-mode is a pure
// no-op. Call sites keep passing temperature/max_tokens exactly as before.
const REASONING_EFFORT = process.env.AZURE_OPENAI_REASONING_EFFORT || "minimal";
const REASONING_TOKEN_HEADROOM = Number(process.env.AZURE_OPENAI_REASONING_HEADROOM || 2000);

export function isReasoningModel(name) {
  if (typeof name !== "string") return false;
  const n = name.toLowerCase();
  if (n.includes("-chat")) return false;   // gpt-5-chat / gpt-5.1-chat are non-reasoning
  if (n.includes("embedding")) return false;
  return n.startsWith("gpt-5") || /^o[1345]\b/.test(n);
}

export function adaptChatParamsForReasoning(params) {
  if (!params || typeof params !== "object" || !isReasoningModel(params.model)) return params;
  const p = { ...params };
  if ("temperature" in p) delete p.temperature;
  if ("max_tokens" in p) {
    p.max_completion_tokens = p.max_tokens + REASONING_TOKEN_HEADROOM;
    delete p.max_tokens;
  }
  if (!("reasoning_effort" in p)) p.reasoning_effort = REASONING_EFFORT;
  return p;
}

// Patch chat.completions.create so the adaptation is automatic and centralised. Streaming vs
// non-streaming is transparent — we only rewrite params and forward the original return value.
const _origChatCreate = openai.chat.completions.create.bind(openai.chat.completions);
openai.chat.completions.create = (params, options) => {
  // Per-request visibility: prints provider + model on EVERY completion, so the logs always show
  // what is live rather than only on cold starts.
  console.log(`🤖 LLM: ${PROVIDER} · model=${params?.model}${isReasoningModel(params?.model) ? ` (reasoning, effort=${REASONING_EFFORT})` : ""}`);
  return _origChatCreate(adaptChatParamsForReasoning(params), options);
};

// ── Model name ────────────────────────────────────────────────────────────────────────────────
// On Azure this resolves to the DEPLOYMENT name. Off Azure it stays gpt-4o, so unsetting
// AZURE_OPENAI_ENDPOINT restores exactly the previous behaviour.
export const CHAT_MODEL = AZURE
  ? (process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5.1")
  : "gpt-4o";

export const PROVIDER = AZURE ? "Azure (GDPR)" : "OpenAI";

console.log(
  `🤖 Svörum strax chatbot LLM provider: ${PROVIDER}` +
  (AZURE ? ` — chat=${CHAT_MODEL}` : "") +
  (AZURE && isReasoningModel(CHAT_MODEL) ? ` · reasoning-adapt ON (effort=${REASONING_EFFORT})` : "")
);

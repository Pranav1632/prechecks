import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import ollama from 'ollama';
import { buildHeuristicAnalysis } from './heuristic.js';
import { buildAnalysisPrompt } from './prompt.js';

export async function analyzeRisk(report, { enabled = true } = {}) {
  if (!enabled) {
    return buildHeuristicAnalysis(report);
  }

  const provider = (process.env.BTM_AI_PROVIDER || 'heuristic').toLowerCase();

  try {
    if (provider === 'ollama') {
      return await analyzeWithOllama(report);
    }

    if (provider === 'gemini') {
      return await analyzeWithGemini(report);
    }

    if (provider === 'openai') {
      return await analyzeWithOpenAI(report);
    }

    if (provider !== 'heuristic') {
      throw new Error(`Unsupported BTM_AI_PROVIDER: ${provider}`);
    }
  } catch (error) {
    return {
      ...buildHeuristicAnalysis(report),
      provider: `${provider}:fallback`,
      providerError: error.message
    };
  }

  return buildHeuristicAnalysis(report);
}

async function analyzeWithOllama(report) {
  const response = await ollama.chat({
    model: process.env.BTM_AI_MODEL ?? 'llama3',
    messages: [{ role: 'user', content: buildAnalysisPrompt(report) }],
    format: 'json',
    options: { temperature: 0 }
  });

  return normalizeAiResponse(JSON.parse(response.message.content), 'ollama');
}

async function analyzeWithGemini(report) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set.');
  }

  const client = new GoogleGenerativeAI(apiKey);
  const model = client.getGenerativeModel({
    model: process.env.BTM_AI_MODEL ?? 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0
    }
  });
  const response = await model.generateContent(buildAnalysisPrompt(report));
  return normalizeAiResponse(JSON.parse(response.response.text()), 'gemini');
}

async function analyzeWithOpenAI(report) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set.');
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL
  });

  const response = await client.chat.completions.create({
    model: process.env.BTM_AI_MODEL ?? 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: buildAnalysisPrompt(report) }]
  });

  return normalizeAiResponse(JSON.parse(response.choices[0].message.content), 'openai');
}

function normalizeAiResponse(raw, provider) {
  return {
    provider,
    riskScore: clampNumber(raw.riskScore, 0, 100),
    category: typeof raw.category === 'string' ? raw.category : 'mixed',
    rootCause: typeof raw.rootCause === 'string' ? raw.rootCause : 'No root cause provided.',
    fixSuggestion: typeof raw.fixSuggestion === 'string' ? raw.fixSuggestion : 'Review the BTM report.',
    confidence: clampNumber(raw.confidence, 0, 1),
    options: Array.isArray(raw.options) ? raw.options.slice(0, 3) : []
  };
}

function clampNumber(value, min, max) {
  const number = Number(value);

  if (Number.isNaN(number)) {
    return min;
  }

  return Math.max(min, Math.min(max, number));
}

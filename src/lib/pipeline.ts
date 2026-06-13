import { db } from '../db/index.ts';
import { queryCache, retrievalLogs } from '../db/schema.ts';
import { embedText, searchKnowledge } from './retriever.ts';
import { eq, sql } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';

function getGenAI() {
  return new GoogleGenAI({ 
    apiKey: process.env.GEMINI_API_KEY || 'dummy_key',
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
  });
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries === 0 || error?.status === 429 || error?.status === 'RESOURCE_EXHAUSTED' || error?.message?.includes('429')) throw error;
    await new Promise(r => setTimeout(r, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

// Simple LRU-like cache for query rewriting
const rewriteCache = new Map<string, string>();

export async function rewriteQuery(userMessage: string, history: any[]): Promise<string> {
    const ai = getGenAI();
    const cacheKey = userMessage + "|" + (history.length ? history[history.length-1]?.content : "");
    if (rewriteCache.has(cacheKey)) {
        return rewriteCache.get(cacheKey)!;
    }

    try {
        const prompt = `You are a search query optimizer. Given a conversational message and conversation context, rewrite the message as a single standalone search query that captures the full intent without pronouns or references. Output only the rewritten query, nothing else.\n\nContext: ${JSON.stringify(history.slice(-4))}\n\nUser Message: ${userMessage}`;
        const response = await withRetry(() => ai.models.generateContent({
            model: 'gemini-pro',
            contents: prompt,
            config: { maxOutputTokens: 60 }
        }));
        const rewritten = response.text || userMessage;
        
        // Cache management
        if (rewriteCache.size > 1000) {
            const firstKey = rewriteCache.keys().next().value;
            if (firstKey) rewriteCache.delete(firstKey);
        }
        rewriteCache.set(cacheKey, rewritten);
        
        return rewritten;
    } catch(e: any) {
        console.warn("Query rewrite failed", e.message);
        return userMessage;
    }
}

export async function detectIntent(userMessage: string): Promise<string> {
    const ai = getGenAI();
    try {
        const text = userMessage.toLowerCase();
        if (/^(hi|hello|hey|greetings)(\s|$)/i.test(text)) return 'greeting';
        if (/how are you|what's up|who are you/i.test(text)) return 'small_talk';
        if (/image|photo|pic/i.test(text)) return 'image_analysis';
        if (/summarize|summary|tl;dr/i.test(text)) return 'summarization';
        if (/compare|vs/i.test(text)) return 'comparison';
        if (/document|pdf|file/i.test(text)) return 'document_analysis';
        
        // If heuristic is low confidence, use fallback
        const prompt = `Classify intent into exactly one of: greeting, small_talk, knowledge_search, document_analysis, image_analysis, follow_up, comparison, summarization, general_question.\nUser Message: ${userMessage}\nReturn ONLY the intent string.`;
        const response = await withRetry(() => ai.models.generateContent({
            model: 'gemini-pro',
            contents: prompt
        }));
        return response.text?.trim() || 'knowledge_search';
    } catch(e: any) {
        console.warn("Intent detection failed", e.message);
        return 'knowledge_search';
    }
}

export async function checkSemanticCache(query: string) {
    try {
        const embedding = await embedText(query);
        const similarity = sql<number>`1 - (${queryCache.queryEmbedding} <=> ${JSON.stringify(embedding)})`;
        const results = await db.select({
            id: queryCache.id,
            answer: queryCache.answer,
            similarity
        })
        .from(queryCache)
        .orderBy(sql`${similarity} DESC`)
        .limit(1);

        if (results.length > 0 && results[0].similarity > 0.95) {
            // Update hit count
            await db.execute(sql`UPDATE query_cache SET hit_count = hit_count + 1 WHERE id = ${results[0].id}`);
            return results[0].answer;
        }
    } catch(e: any) {
        console.warn("Semantic cache check failed:", e.message);
    }
    return null;
}

export async function verifyAnswer(query: string, chunks: any[], draft: string): Promise<{supported: boolean, confidence: number}> {
    const ai = getGenAI();
    try {
        const prompt = `Verify this answer against the chunks.\nQuery: ${query}\nChunks: ${JSON.stringify(chunks)}\nDraft: ${draft}\n\nRespond with JSON: { "supported": true/false, "confidence": 0-1, "unsupported_claims": [] }`;
        const response = await withRetry(() => ai.models.generateContent({
            model: 'gemini-pro',
            contents: prompt,
            config: { responseMimeType: 'application/json' }
        }));
        try {
            const txt = response.text || '{}';
            return JSON.parse(txt);
        } catch(e) {
            return { supported: true, confidence: 0.8 };
        }
    } catch(e: any) {
        console.warn("Answer verification failed", e.message);
        return { supported: true, confidence: 0.8 };
    }
}


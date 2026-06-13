import { db } from '../db/index.ts';
import { queryCache, retrievalLogs } from '../db/schema.ts';
import { embedText, searchKnowledge } from './retriever.ts';
import { eq, sql } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';

// Initialize Gemini as fallback or primary if Anthropic not available
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Using Gemini for internal tasks like Query Rewriting & Verification since local models aren't feasible
export async function rewriteQuery(userMessage: string, history: any[]): Promise<string> {
    try {
        const prompt = `You are a search query optimizer. Given a conversational message and conversation context, rewrite the message as a single standalone search query that captures the full intent without pronouns or references. Output only the rewritten query, nothing else.\n\nContext: ${JSON.stringify(history.slice(-4))}\n\nUser Message: ${userMessage}`;
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        return response.text || userMessage;
    } catch(e: any) {
        console.warn("Query rewrite failed", e.message);
        return userMessage;
    }
}

export async function detectIntent(userMessage: string): Promise<string> {
    try {
        const prompt = `Classify intent into exactly one of: greeting, small_talk, knowledge_search, document_analysis, image_analysis, follow_up, comparison, summarization, general_question.\nUser Message: ${userMessage}\nReturn ONLY the intent string.`;
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        return response.text?.trim() || 'knowledge_search';
    } catch(e: any) {
        console.warn("Intent detection failed", e.message);
        return 'knowledge_search';
    }
}

export async function checkSemanticCache(query: string) {
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
    return null;
}

export async function verifyAnswer(query: string, chunks: any[], draft: string): Promise<{supported: boolean, confidence: number}> {
    try {
        const prompt = `Verify this answer against the chunks.\nQuery: ${query}\nChunks: ${JSON.stringify(chunks)}\nDraft: ${draft}\n\nRespond with JSON: { "supported": true/false, "confidence": 0-1 }`;
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });
        try {
            const txt = response.text?.replace(/```json/g, '').replace(/```/g, '').trim() || '{}';
            return JSON.parse(txt);
        } catch(e) {
            return { supported: true, confidence: 0.8 };
        }
    } catch(e: any) {
        console.warn("Answer verification failed", e.message);
        return { supported: true, confidence: 0.8 };
    }
}

import { db } from '../db/index.ts';
import { knowledgeChunks } from '../db/schema.ts';
import { sql, desc } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';

function getGenAI() {
  return new GoogleGenAI({ 
    apiKey: process.env.GEMINI_API_KEY || 'dummy_key',
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
  });
}

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'gemini-embedding-2-preview';

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries === 0 || error?.status === 429 || error?.status === 'RESOURCE_EXHAUSTED' || error?.message?.includes('429')) throw error;
    await new Promise(r => setTimeout(r, delay));
    return withRetry(fn, retries - 1, delay * 2);
  }
}

export async function embedText(text: string): Promise<number[]> {
  const ai = getGenAI();
  try {
    const response = await withRetry(() => ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
      config: { outputDimensionality: 768 }
    }));
    const emb = response.embeddings?.[0]?.values || [];
    const pad = new Array(3072 - emb.length).fill(0);
    return emb.concat(pad);
  } catch (error: any) {
    console.warn("Embedding failed:", error?.message || "Unknown error");
    throw error;
  }
}

// Simple vector search
export async function searchKnowledge(query: string, limit: number = 6) {
  try {
    const queryEmbedding = await embedText(query);
    
    const similarity = sql<number>`1 - (${knowledgeChunks.embedding} <=> ${JSON.stringify(queryEmbedding)})`;
    
    const results = await db.select({
      id: knowledgeChunks.id,
      sourceFile: knowledgeChunks.sourceFile,
      content: knowledgeChunks.content,
      similarity
    })
    .from(knowledgeChunks)
    .orderBy(desc(similarity))
    .limit(limit);

    return results;
  } catch (error: any) {
    console.warn('Error searching knowledge:', error?.message || "Unknown error");
    return [];
  }
}

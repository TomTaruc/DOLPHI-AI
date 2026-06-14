import { db } from '../db/index.ts';
import { knowledgeChunks } from '../db/schema.ts';
import { sql, desc } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';
import { VECTOR_DIM, MIN_VECTOR_SIMILARITY, MAX_CONTEXT_CHUNKS } from './constants.ts';

const CHAT_MODEL = process.env.CHAT_MODEL || 'gemini-3.5-flash';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'gemini-embedding-2-preview';

const rerankCache = new Map<string, { results: any[], expires: number }>();

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

export async function embedText(text: string): Promise<number[]> {
  const ai = getGenAI();
  try {
    const response = await withRetry(() => ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: text,
      config: { outputDimensionality: VECTOR_DIM }
    }));
    return response.embeddings?.[0]?.values || [];
  } catch (error: any) {
    console.error("Embedding failed:", error?.message || error);
    throw error;
  }
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const ai = getGenAI();
  try {
    const response = await withRetry(() => ai.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: texts,
      config: { outputDimensionality: VECTOR_DIM }
    }));
    return response.embeddings?.map(e => e.values || []) || [];
  } catch (error: any) {
    console.error("Batch embedding failed:", error?.message || error);
    throw error;
  }
}

async function bm25Retriever(query: string, limit: number) {
   const results = await db.execute(sql`
   SELECT id, source_file, content, 
          ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${query})) AS similarity
   FROM knowledge_chunks
   WHERE to_tsvector('english', content) @@ plainto_tsquery('english', ${query})
   ORDER BY similarity DESC LIMIT ${limit}
   `);
   return (results.rows || []).map((r: any) => ({
      id: r.id,
      sourceFile: r.source_file,
      content: r.content,
      similarity: r.similarity
   }));
}

export async function searchKnowledge(query: string, limit: number = MAX_CONTEXT_CHUNKS) {
  let candidates: any[] = [];
  
  try {
    // 1. Vector Search
    const queryEmbedding = await embedText(query);
    
    if (queryEmbedding && queryEmbedding.length > 0) {
      const similarity = sql<number>`1 - (${knowledgeChunks.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector(${VECTOR_DIM}))`;
      
      candidates = await db.select({
        id: knowledgeChunks.id,
        sourceFile: knowledgeChunks.sourceFile,
        content: knowledgeChunks.content,
        similarity
      })
      .from(knowledgeChunks)
      .where(sql`1 - (${knowledgeChunks.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector(${VECTOR_DIM})) > ${MIN_VECTOR_SIMILARITY}`)
      .orderBy(desc(similarity))
      .limit(12);
    }
  } catch (error: any) {
    console.warn('Vector search failed (pgvector missing or error), falling back to BM25:', error?.message);
    // candidates remain empty, automatically triggering BM25 hybrid logic below
  }

  try {
    // 2. Fallback to BM25 if very few results or we want hybrid
    if (candidates.length < 2) {
       const bm25Results = await bm25Retriever(query, 12);
       // Merge & Deduplicate
       const seen = new Set(candidates.map(c => c.id));
       for (const b of bm25Results) {
           if (!seen.has(b.id)) {
               candidates.push(b);
               seen.add(b.id);
           }
       }
    }
    
    if (candidates.length === 0) return { results: [], error: false };

    candidates.sort((a, b) => b.similarity - a.similarity);
    candidates = candidates.slice(0, limit);

    return { results: candidates, error: false };
  } catch (error: any) {
    console.error('Error searching knowledge:', error?.message || error);
    return { results: [], error: true };
  }
}


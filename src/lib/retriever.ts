import { db } from '../db/index.ts';
import { knowledgeChunks } from '../db/schema.ts';
import { sql, desc } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';
import { VECTOR_DIM, MIN_VECTOR_SIMILARITY, MAX_CONTEXT_CHUNKS } from './constants.ts';

const CHAT_MODEL = process.env.CHAT_MODEL || 'gemini-2.0-flash';
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
  try {
    // 1. Vector Search
    const queryEmbedding = await embedText(query);
    
    // Explicitly cast the query embedding to vector(VECTOR_DIM) to match the schema
    const similarity = sql<number>`1 - (${knowledgeChunks.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector(${VECTOR_DIM}))`;
    
    let candidates = await db.select({
      id: knowledgeChunks.id,
      sourceFile: knowledgeChunks.sourceFile,
      content: knowledgeChunks.content,
      similarity
    })
    .from(knowledgeChunks)
    .where(sql`1 - (${knowledgeChunks.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector(${VECTOR_DIM})) > ${MIN_VECTOR_SIMILARITY}`)
    .orderBy(desc(similarity))
    .limit(12);

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

    // 3. Rerank
    const cacheKey = query;
    if (rerankCache.has(cacheKey) && rerankCache.get(cacheKey)!.expires > Date.now()) {
        return { results: rerankCache.get(cacheKey)!.results, error: false };
    }

    const ai = getGenAI();
    candidates = candidates.slice(0, 12); // take top 12 at most
    const passagesPayload = candidates.map(c => `[ID: ${c.id}] ${c.content.substring(0, 500)}`).join('\n\n');
    
    try {
        const rerankPrompt = `Given query: "${query}"\nScore each passage 0-10 for relevance. Return JSON array of {id, score}.\nPassages:\n${passagesPayload}`;
        const response = await withRetry(() => ai.models.generateContent({
           model: CHAT_MODEL,
           contents: rerankPrompt,
           config: { responseMimeType: "application/json" }
        }));
        
        try {
           const scores: {id: string, score: number}[] = JSON.parse(response.text || "[]");
           const scoreMap = new Map<string, number>();
           for (const s of scores) scoreMap.set(s.id, s.score);
           
           candidates.sort((a, b) => {
               const sA = scoreMap.get(a.id) ?? 0;
               const sB = scoreMap.get(b.id) ?? 0;
               return sB - sA;
           });
           
           // Apply rerank score as similarity if available, else keep generic sort
           candidates = candidates.map(c => ({
              ...c,
              similarity: scoreMap.has(c.id) ? scoreMap.get(c.id)! / 10 : c.similarity
           }));
           
        } catch(e) {}
    } catch(e: any) {
        console.warn("Reranking failed:", e?.message);
    }

    candidates = candidates.slice(0, limit);
    
    rerankCache.set(cacheKey, { results: candidates, expires: Date.now() + 5 * 60 * 1000 });
    
    // Auto-clean rerank cache
    if (rerankCache.size > 200) {
       for (const [k, v] of rerankCache.entries()) {
           if (v.expires < Date.now()) rerankCache.delete(k);
       }
    }

    return { results: candidates, error: false };
  } catch (error: any) {
    console.error('Error searching knowledge:', error?.message || error);
    return { results: [], error: true };
  }
}


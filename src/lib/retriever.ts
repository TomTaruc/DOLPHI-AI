import { db } from '../db/index.ts';
import { knowledgeChunks } from '../db/schema.ts';
import { sql, desc } from 'drizzle-orm';
import { GoogleGenAI } from '@google/genai';
import {
  VECTOR_DIM,
  MIN_VECTOR_SIMILARITY,
  MAX_CONTEXT_CHUNKS,
  SEMANTIC_TOP_K,
  BM25_TOP_K,
  SEMANTIC_WEIGHT,
  BM25_WEIGHT,
  MIN_HYBRID_RELEVANCE
} from './constants.ts';

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'gemini-embedding-2-preview';

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
    const isRateLimit = error?.status === 429 || error?.status === 'RESOURCE_EXHAUSTED' || error?.message?.includes('429');
    if (retries === 0) throw error;
    
    if (!isRateLimit && retries > 1) {
       retries = 1;
       delay = 500;
    }
    
    if (isRateLimit && error?.message) {
       const match = error.message.match(/retry in (\d+\.?\d*)s/i);
       if (match && match[1]) {
           const parsedDelay = parseFloat(match[1]) * 1000;
           if (!isNaN(parsedDelay) && parsedDelay > delay) {
               delay = parsedDelay + 500;
           }
       }
    }
    
    await new Promise(r => setTimeout(r, delay));
    return withRetry(fn, retries - 1, isRateLimit ? delay * 1.5 : delay * 2);
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
    console.info("Embedding failed:", error?.message || error);
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
    console.info("Batch embedding failed:", error?.message || error);
    throw error;
  }
}

// ─── BM25 / Full-Text Retrieval ─────────────────────────────────────────────

interface RawBM25Result {
  id: string;
  sourceFile: string;
  chunkIndex: number;
  content: string;
  bm25Score: number;
}

async function bm25Retriever(query: string, limit: number): Promise<RawBM25Result[]> {
   const results = await db.execute(sql`
   SELECT id, source_file, chunk_index, content, 
          ts_rank(to_tsvector('english', content), plainto_tsquery('english', ${query})) AS bm25_score
   FROM knowledge_chunks
   WHERE to_tsvector('english', content) @@ plainto_tsquery('english', ${query})
   ORDER BY bm25_score DESC LIMIT ${limit}
   `);
   return ((results as any).rows || []).map((r: any) => ({
      id: r.id,
      sourceFile: r.source_file,
      chunkIndex: r.chunk_index ?? 0,
      content: r.content,
      bm25Score: parseFloat(r.bm25_score) || 0
   }));
}

// ─── Semantic / Vector Retrieval ────────────────────────────────────────────

interface RawSemanticResult {
  id: string;
  sourceFile: string;
  chunkIndex: number;
  content: string;
  semanticScore: number;
}

async function semanticRetriever(query: string, limit: number): Promise<RawSemanticResult[]> {
  const queryEmbedding = await embedText(query);
  if (!queryEmbedding || queryEmbedding.length === 0) return [];

  const similarity = sql<number>`1 - (${knowledgeChunks.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector(${sql.raw(String(VECTOR_DIM))}))`;

  const rows = await db.select({
    id: knowledgeChunks.id,
    sourceFile: knowledgeChunks.sourceFile,
    chunkIndex: knowledgeChunks.chunkIndex,
    content: knowledgeChunks.content,
    semanticScore: similarity
  })
  .from(knowledgeChunks)
  .where(sql`1 - (${knowledgeChunks.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector(${sql.raw(String(VECTOR_DIM))})) > ${MIN_VECTOR_SIMILARITY}`)
  .orderBy(desc(similarity))
  .limit(limit);

  return rows.map(r => ({
    id: r.id,
    sourceFile: r.sourceFile,
    chunkIndex: r.chunkIndex,
    content: r.content,
    semanticScore: typeof r.semanticScore === 'number' ? r.semanticScore : parseFloat(String(r.semanticScore)) || 0
  }));
}

// ─── Hybrid Search ──────────────────────────────────────────────────────────

export interface HybridResult {
  id: string;
  sourceFile: string;
  chunkIndex: number;
  content: string;
  semanticScore: number;
  bm25Score: number;
  hybridScore: number;
  matchMethod: 'semantic' | 'bm25' | 'hybrid';
}

/**
 * Normalize an array of scores to the 0–1 range.
 * If all scores are the same (or array has 1 element), returns 1.0 for all.
 */
function normalizeScores(scores: number[]): number[] {
  if (scores.length === 0) return [];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;
  if (range === 0) return scores.map(() => (max > 0 ? 1.0 : 0));
  return scores.map(s => (s - min) / range);
}

/**
 * Search the Knowledge Base using true hybrid retrieval:
 *   1. Run semantic (vector) AND BM25 (full-text) in parallel
 *   2. Normalize each score set to 0–1
 *   3. Combine: hybridScore = SEMANTIC_WEIGHT * semNorm + BM25_WEIGHT * bm25Norm
 *   4. Deduplicate by chunk ID (keep higher score)
 *   5. Filter by MIN_HYBRID_RELEVANCE
 *   6. Return top MAX_CONTEXT_CHUNKS results
 *
 * The Knowledge Base is GLOBAL (school-wide), shared by all users.
 */
export async function searchKnowledge(query: string, limit: number = MAX_CONTEXT_CHUNKS): Promise<{ results: HybridResult[], error: boolean }> {
  let semanticResults: RawSemanticResult[] = [];
  let bm25Results: RawBM25Result[] = [];
  let semanticError = false;
  let bm25Error = false;

  // Run both retrievals in parallel for speed
  const [semanticOutcome, bm25Outcome] = await Promise.allSettled([
    semanticRetriever(query, SEMANTIC_TOP_K),
    bm25Retriever(query, BM25_TOP_K)
  ]);

  if (semanticOutcome.status === 'fulfilled') {
    semanticResults = semanticOutcome.value;
  } else {
    semanticError = true;
    console.info('[RETRIEVAL] Semantic search failed:', (semanticOutcome.reason as any)?.message || semanticOutcome.reason);
  }

  if (bm25Outcome.status === 'fulfilled') {
    bm25Results = bm25Outcome.value;
  } else {
    bm25Error = true;
    console.info('[RETRIEVAL] BM25 search failed:', (bm25Outcome.reason as any)?.message || bm25Outcome.reason);
  }

  // If both failed, return error
  if (semanticError && bm25Error) {
    return { results: [], error: true };
  }

  // If no results from either, return empty
  if (semanticResults.length === 0 && bm25Results.length === 0) {
    return { results: [], error: false };
  }

  // ── Normalize scores within each result set ────────────────────────────

  const semScoresRaw = semanticResults.map(r => r.semanticScore);
  const semScoresNorm = normalizeScores(semScoresRaw);

  const bm25ScoresRaw = bm25Results.map(r => r.bm25Score);
  const bm25ScoresNorm = normalizeScores(bm25ScoresRaw);

  // ── Build combined map keyed by chunk ID ───────────────────────────────

  const combined = new Map<string, HybridResult>();

  for (let i = 0; i < semanticResults.length; i++) {
    const r = semanticResults[i];
    combined.set(r.id, {
      id: r.id,
      sourceFile: r.sourceFile,
      chunkIndex: r.chunkIndex,
      content: r.content,
      semanticScore: semScoresNorm[i],
      bm25Score: 0,
      hybridScore: SEMANTIC_WEIGHT * semScoresNorm[i],
      matchMethod: 'semantic'
    });
  }

  for (let i = 0; i < bm25Results.length; i++) {
    const r = bm25Results[i];
    const existing = combined.get(r.id);

    if (existing) {
      // Chunk appeared in both — true hybrid match
      existing.bm25Score = bm25ScoresNorm[i];
      existing.hybridScore = SEMANTIC_WEIGHT * existing.semanticScore + BM25_WEIGHT * bm25ScoresNorm[i];
      existing.matchMethod = 'hybrid';
    } else {
      combined.set(r.id, {
        id: r.id,
        sourceFile: r.sourceFile,
        chunkIndex: r.chunkIndex,
        content: r.content,
        semanticScore: 0,
        bm25Score: bm25ScoresNorm[i],
        hybridScore: BM25_WEIGHT * bm25ScoresNorm[i],
        matchMethod: 'bm25'
      });
    }
  }

  // ── Filter, sort, and return ───────────────────────────────────────────

  let candidates = Array.from(combined.values())
    .filter(c => c.hybridScore >= MIN_HYBRID_RELEVANCE)
    .sort((a, b) => b.hybridScore - a.hybridScore)
    .slice(0, limit);

  console.log(`[RETRIEVAL] Hybrid results: ${semanticResults.length} semantic + ${bm25Results.length} BM25 → ${candidates.length} after merge/filter (top ${limit})`);

  return { results: candidates, error: false };
}

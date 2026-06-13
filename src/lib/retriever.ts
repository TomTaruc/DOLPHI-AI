import { pipeline, env } from '@xenova/transformers';
import { db } from '../db/index.ts';
import { knowledgeChunks } from '../db/schema.ts';
import { sql, desc } from 'drizzle-orm';

// Disable remote models for safety if needed, but we do need to download it once.
env.allowLocalModels = false; 
env.allowRemoteModels = true;

let extractor: any = null;

// Initialize model
export async function getExtractor() {
  if (!extractor) {
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }
  return extractor;
}

export async function embedText(text: string): Promise<number[]> {
  const ext = await getExtractor();
  const output = await ext(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// Simple BM25 proxy using Postgres ILIKE or we can implement real BM25.
// Since we don't have rank_bm25, we'll do tsvector full text search in Postgres for BM25-like behavior.
export async function searchKnowledge(query: string, limit: number = 6) {
  try {
    const queryEmbedding = await embedText(query);
    
    // We can do a hybrid search using both full text search and vector similarity if requested.
    // For simplicity here, we'll just use HNSW vector similarity 
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
  } catch (error) {
    console.error('Error searching knowledge:', error);
    return [];
  }
}

export const VECTOR_DIM = 768;
export const CHUNK_SIZE = 800;
export const CHUNK_OVERLAP = 120;
export const MAX_HISTORY_MESSAGES = 8;
export const MAX_CONTEXT_CHUNKS = 6;
export const MIN_VECTOR_SIMILARITY = 0.35;
export const SEMANTIC_CACHE_THRESHOLD = 0.97;
export const EMBEDDING_BATCH_SIZE = 20;

// Hybrid retrieval tuning
export const SEMANTIC_TOP_K = 15;
export const BM25_TOP_K = 15;
export const SEMANTIC_WEIGHT = 0.65;
export const BM25_WEIGHT = 0.35;
export const MIN_HYBRID_RELEVANCE = 0.20;

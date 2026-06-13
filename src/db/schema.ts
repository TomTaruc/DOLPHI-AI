import { relations } from 'drizzle-orm';
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  uuid,
  real
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// We define a custom vector type because pgvector/drizzle-orm is sometimes tricky.
// Alternatively imported from pgvector/drizzle-orm
import { customType } from 'drizzle-orm/pg-core';

const vectorType = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(3072)';
  },
  toDriver(value: number[]): string {
    return '[' + value.join(',') + ']';
  },
  fromDriver(value: string | unknown): number[] {
    if (typeof value === 'string') {
      return value.replace('[', '').replace(']', '').split(',').map(Number);
    }
    return value as number[];
  },
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  title: text('title').default('New Chat').notNull(),
  isPinned: boolean('is_pinned').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .references(() => conversations.id, { onDelete: 'cascade' })
    .notNull(),
  role: text('role').notNull(), // 'user' | 'assistant'
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const attachments = pgTable('attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  messageId: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id')
    .references(() => conversations.id, { onDelete: 'cascade' }),
  originalName: text('original_name').notNull(),
  storedName: text('stored_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  storagePath: text('storage_path').notNull(),
  isImage: boolean('is_image').default(false).notNull(),
  width: integer('width'),
  height: integer('height'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const knowledgeChunks = pgTable('knowledge_chunks', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceFile: text('source_file').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  embedding: vectorType('embedding'), // VECTOR(384)
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const conversationSummaries = pgTable('conversation_summaries', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id')
    .references(() => conversations.id, { onDelete: 'cascade' })
    .notNull(),
  summary: text('summary').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const queryCache = pgTable('query_cache', {
  id: uuid('id').defaultRandom().primaryKey(),
  queryText: text('query_text').notNull(),
  queryEmbedding: vectorType('query_embedding'),
  answer: text('answer').notNull(),
  hitCount: integer('hit_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const retrievalLogs = pgTable('retrieval_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  conversationId: uuid('conversation_id'),
  query: text('query'),
  rewrittenQuery: text('rewritten_query'),
  confidence: real('confidence'),
  chunksUsed: jsonb('chunks_used'),
  responseTimeMs: integer('response_time_ms'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const messageFeedback = pgTable('message_feedback', {
  id: uuid('id').defaultRandom().primaryKey(),
  messageId: uuid('message_id').notNull(), // not strictly foreign key to allow deleted messages
  feedbackType: text('feedback_type'),
  feedbackText: text('feedback_text'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sourceMetadata = pgTable('source_metadata', {
  id: uuid('id').defaultRandom().primaryKey(),
  sourceFile: text('source_file').unique().notNull(),
  sourceHash: text('source_hash').notNull(),
  sourceVersion: text('source_version'),
  lastIndexed: timestamp('last_indexed'),
});

export const suggestedPrompts = pgTable('suggested_prompts', {
  id: uuid('id').defaultRandom().primaryKey(),
  icon: text('icon'),
  title: text('title').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  conversations: many(conversations),
}));

export const conversationsRelations = relations(conversations, ({ one, many }) => ({
  user: one(users, { fields: [conversations.userId], references: [users.id] }),
  messages: many(messages),
  attachments: many(attachments),
  summaries: many(conversationSummaries),
}));

export const messagesRelations = relations(messages, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  attachments: many(attachments),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  message: one(messages, {
    fields: [attachments.messageId],
    references: [messages.id],
  }),
  conversation: one(conversations, {
    fields: [attachments.conversationId],
    references: [conversations.id],
  }),
}));

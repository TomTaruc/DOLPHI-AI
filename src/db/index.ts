import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.ts';

console.log(
  'DATABASE_URL_HOST:',
  process.env.DATABASE_URL?.replace(/:\/\/.*@/, '://***@')
);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

const sql = postgres(process.env.DATABASE_URL, {
  ssl: 'require',
  max: 5,
  prepare: false,
});

export const client = sql;
export const db = drizzle(sql, { schema });

export async function initDb() {
  console.log('Connecting to Supabase PostgreSQL...');
  await sql`SELECT 1`;
  console.log('Supabase connection successful');

  // Auto-migration for attachments user_id ownership security
  try {
    await sql`ALTER TABLE attachments ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id)`;
    await sql`UPDATE attachments SET user_id = conversations.user_id FROM conversations WHERE attachments.conversation_id = conversations.id AND attachments.user_id IS NULL`;
    console.log('Attachment ownership schema migration completed.');
  } catch (err: any) {
    console.error('Failed to run attachment ownership migration:', err?.message || err);
  }

  try {
    await sql`DELETE FROM attachments WHERE user_id IS NULL AND conversation_id IS NULL AND created_at < NOW() - INTERVAL '1 day'`;
    console.log('Orphan attachment cleanup completed.');
  } catch (err: any) {
    console.error('Failed to cleanup orphan attachments:', err?.message || err);
  }

  const allowVectorReset = process.env.ALLOW_VECTOR_RESET === "true";

  try {
    await sql`ALTER TABLE knowledge_chunks ALTER COLUMN embedding TYPE vector(768)`;
    await sql`ALTER TABLE query_cache ALTER COLUMN query_embedding TYPE vector(768)`;
    console.log('Vector dimensions verified/updated to 768.');
  } catch (err: any) {
    const isDimensionIssue =
      err.message?.includes("cannot cast type") ||
      err.message?.includes("dimension");

    if (isDimensionIssue && allowVectorReset) {
      console.warn("ALLOW_VECTOR_RESET=true. Truncating vector tables to update dimensions.");
      try {
        await sql`TRUNCATE TABLE knowledge_chunks`;
        await sql`TRUNCATE TABLE query_cache`;
        await sql`ALTER TABLE knowledge_chunks ALTER COLUMN embedding TYPE vector(768)`;
        await sql`ALTER TABLE query_cache ALTER COLUMN query_embedding TYPE vector(768)`;
        console.log("Vector dimensions updated to 768 via truncation.");
      } catch (innerErr: any) {
        console.error('Failed to update vector dimensions even with truncation:', innerErr?.message || innerErr);
      }
    } else if (isDimensionIssue && !allowVectorReset) {
      console.error(
        "Vector dimension migration failed. Set ALLOW_VECTOR_RESET=true only in development if you are okay deleting indexed chunks and cache."
      );
      console.error(err?.message || err);
    } else {
      console.error('Failed to run vector dimension migration:', err?.message || err);
    }
  }
}
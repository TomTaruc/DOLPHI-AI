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
}
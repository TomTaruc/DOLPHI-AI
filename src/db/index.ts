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
}
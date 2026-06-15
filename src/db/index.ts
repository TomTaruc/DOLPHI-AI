import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.ts';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

const sql = postgres(process.env.DATABASE_URL, {
  max: 5,
  prepare: false,
});

export const client = sql;

export const db = drizzle(sql, {
  schema,
});

export async function initDb() {
  try {
    console.log('Connecting to Supabase PostgreSQL...');

    await sql`SELECT 1`;

    console.log('Supabase connection successful');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}
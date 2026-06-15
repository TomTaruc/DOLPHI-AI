import * as schema from './schema.ts';

// Temporary Render deployment test.
// This disables PGlite completely so we can determine
// whether the Render crash is being caused by database startup.

export const client = {} as any;
export const db = {} as any;

export async function initDb() {
  console.log('SKIPPING DB INIT FOR RENDER TEST');
  return;
}
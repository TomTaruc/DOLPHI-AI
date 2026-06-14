import { drizzle } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import * as schema from './schema.ts';
import fs from 'fs';
import path from 'path';

// Ensure data dir exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const client = new PGlite(path.join(dataDir, 'db'), {
  extensions: { vector }
});

export const db = drizzle(client, { schema });

export async function initDb() {
  await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
  
  if (fs.existsSync('drizzle/0000_busy_absorbing_man.sql')) {
    const sql = fs.readFileSync('drizzle/0000_busy_absorbing_man.sql', 'utf8');
    const queries = sql.split(';').map(q => q.trim()).filter(Boolean);
    try {
      // Check if users table exists
      const test = await client.query("SELECT to_regclass('users');");
      if ((test.rows[0] as any)?.to_regclass === null) {
        console.log('Running migrations...');
        for (const q of queries) {
          await client.query(q);
        }
        console.log('Migrations complete');
      }
    } catch (e) {
      console.error('Migration error:', e);
    }
  }
}

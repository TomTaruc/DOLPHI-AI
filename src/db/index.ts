import { drizzle } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema.ts';
import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'data');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

console.log('DATA DIR:', dataDir);

export const client = new PGlite(
  path.join(dataDir, 'db'),
  {
    extensions: {
      vector,
    },
  }
);

export const db = drizzle(client, { schema });

export async function initDb() {
  console.log('Testing PGlite startup...');

  try {
    await client.query(
      `CREATE EXTENSION IF NOT EXISTS vector;`
    );

    console.log('Vector extension loaded');

    await migrate(db, {
      migrationsFolder: './drizzle',
    });

    console.log('Migrations complete');
  } catch (error) {
    console.error('Database initialization failed:', error);
    throw error;
  }
}
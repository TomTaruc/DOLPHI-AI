import * as schema from './schema.ts';

export const client = {} as any;
export const db = {} as any;

export async function initDb() {
  console.log('SKIPPING DB INIT FOR RENDER');
  return;
}
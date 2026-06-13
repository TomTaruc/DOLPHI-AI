import fs from 'fs';
import path from 'path';
import { db } from '../db/index.ts';
import { knowledgeChunks, sourceMetadata } from '../db/schema.ts';
import { embedText } from './retriever.ts';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';

import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || path.join(process.cwd(), 'knowledge');

function chunkText(text: string, chunkSize: number = 800, overlap: number = 120): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
  const chunks: string[] = [];
  let currentChunk = '';
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      // overlap: take the last `overlap` characters from the current chunk
      currentChunk = currentChunk.slice(-overlap) + ' ' + sentence.trim();
    } else {
      currentChunk += (currentChunk.length > 0 ? ' ' : '') + sentence.trim();
    }
  }
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  return chunks;
}

export async function indexKnowledgeBase() {
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
    fs.writeFileSync(path.join(KNOWLEDGE_DIR, 'metadata.json'), JSON.stringify({ version: "1.0.0", last_updated: new Date().toISOString() }));
  }

  const files = fs.readdirSync(KNOWLEDGE_DIR);
  let totalChunks = 0;

  for (const file of files) {
    if (file === 'metadata.json') continue;
    const filePath = path.join(KNOWLEDGE_DIR, file);
    
    let content = '';
    const ext = path.extname(file).toLowerCase();
    
    try {
      if (ext === '.pdf') {
        const dataBuffer = fs.readFileSync(filePath);
        const pdfData = await pdfParse(dataBuffer);
        content = pdfData.text;
      } else if (ext === '.docx') {
        const result = await mammoth.extractRawText({ path: filePath });
        content = result.value;
      } else {
        content = fs.readFileSync(filePath, 'utf-8');
      }
    } catch (err: any) {
      console.warn(`Failed to read file ${file}:`, err.message);
      continue;
    }
    
    const hash = crypto.createHash('md5').update(content).digest('hex');
    
    // Check if changed
    const existingMeta = await db.select().from(sourceMetadata).where(eq(sourceMetadata.sourceFile, file));
    if (existingMeta.length > 0 && existingMeta[0].sourceHash === hash) {
      continue; // already indexed
    }

    // Delete existing chunks for this file
    await db.delete(knowledgeChunks).where(eq(knowledgeChunks.sourceFile, file));

    // Chunk and index
    const chunks = chunkText(content);
    for (let i = 0; i < chunks.length; i++) {
      const chunkContext = chunks[i];
      const embedding = await embedText(chunkContext);
      
      await db.insert(knowledgeChunks).values({
        sourceFile: file,
        chunkIndex: i,
        content: chunkContext,
        embedding: embedding
      });
      totalChunks++;
    }

    // Upsert metadata
    await db.insert(sourceMetadata).values({
      sourceFile: file,
      sourceHash: hash,
      sourceVersion: '1.0',
      lastIndexed: new Date()
    }).onConflictDoUpdate({
      target: sourceMetadata.sourceFile,
      set: {
        sourceHash: hash,
        lastIndexed: new Date()
      }
    });
  }

  console.log(`DOLPHI AI ready — ${totalChunks} new chunks indexed`);
}

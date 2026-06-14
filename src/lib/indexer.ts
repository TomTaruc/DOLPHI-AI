import fs from 'fs';
import path from 'path';
import { db } from '../db/index.ts';
import { knowledgeChunks, sourceMetadata } from '../db/schema.ts';
import { embedBatch } from './retriever.ts';
import crypto from 'crypto';
import { eq } from 'drizzle-orm';
import { createRequire } from 'module';
import { CHUNK_SIZE, CHUNK_OVERLAP, EMBEDDING_BATCH_SIZE } from './constants.ts';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
import mammoth from 'mammoth';

const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || path.join(process.cwd(), 'knowledge');

function chunkText(text: string, chunkSize: number = CHUNK_SIZE, overlap: number = CHUNK_OVERLAP): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
  const chunks: string[] = [];
  let currentChunk = '';
  
  for (const sentence of sentences) {
    if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
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
      } else if (ext === '.csv') {
        const txt = fs.readFileSync(filePath, 'utf-8');
        // Simple row formatting to text
        content = txt.split('\n').map((row, idx) => `Row ${idx + 1}: ${row}`).join('\n');
      } else if (ext === '.xlsx') {
        const workbook = XLSX.readFile(filePath);
        let allTxt = '';
        workbook.SheetNames.forEach(name => {
           allTxt += `Sheet: ${name}\n`;
           allTxt += XLSX.utils.sheet_to_csv(workbook.Sheets[name]) + '\n\n';
        });
        content = allTxt;
      } else if (ext === '.pptx') {
        const dataBuffer = fs.readFileSync(filePath);
        const zip = await JSZip.loadAsync(dataBuffer);
        let allTxt = '';
        for (const [name, zipObj] of Object.entries(zip.files)) {
           if (name.startsWith('ppt/slides/') && name.endsWith('.xml')) {
              const xmlText = await zipObj.async('text');
              allTxt += xmlText.replace(/<[^>]+>/g, ' ') + ' ';
           }
        }
        content = allTxt;
      } else if (ext === '.md' || ext === '.txt') {
        content = fs.readFileSync(filePath, 'utf-8');
      } else {
        console.warn(`Unsupported file type: ${ext} for ${file}`);
        continue;
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
    
    // Batch process embeddings
    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
        const batchChunks = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
        let embeddings: number[][] = [];
        try {
           embeddings = await embedBatch(batchChunks);
        } catch(e: any) {
           console.warn(`Batch embedding failed for ${file} chunk index ${i}:`, e?.message);
           continue; // Skip failed batch chunks, proceed to next
        }

        const values = batchChunks.map((chunk, idx) => ({
            sourceFile: file,
            chunkIndex: i + idx,
            content: chunk,
            embedding: embeddings[idx] || []
        })).filter(val => val.embedding.length > 0);

        if (values.length > 0) {
            await db.insert(knowledgeChunks).values(values);
            totalChunks += values.length;
        }
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

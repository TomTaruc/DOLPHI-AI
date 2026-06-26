import fs from 'fs';
import path from 'path';
import { db } from '../db/index.ts';
import { knowledgeChunks, sourceMetadata } from '../db/schema.ts';
import { embedBatch } from './retriever.ts';
import crypto from 'crypto';
import { eq, sql } from 'drizzle-orm';
import { CHUNK_SIZE, CHUNK_OVERLAP, EMBEDDING_BATCH_SIZE } from './constants.ts';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import * as _pdfParse from 'pdf-parse';
const PDFParse = (_pdfParse as any).default || (_pdfParse as any).PDFParse || _pdfParse;
import mammoth from 'mammoth';

const KNOWLEDGE_DIR =
  process.env.KNOWLEDGE_DIR ||
  path.join(process.cwd(), 'knowledge');

// Supported file extensions for Knowledge Base indexing
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md', '.csv', '.xlsx', '.pptx']);

// Files to ignore inside the knowledge directory
const IGNORED_FILES = new Set(['metadata.json']);

function chunkText(
  text: string,
  chunkSize: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP
): string[] {
  const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if (
      currentChunk.length + sentence.length > chunkSize &&
      currentChunk.length > 0
    ) {
      chunks.push(currentChunk.trim());
      currentChunk = currentChunk.slice(-overlap) + ' ' + sentence.trim();
    } else {
      currentChunk +=
        (currentChunk.length > 0 ? ' ' : '') + sentence.trim();
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * Compute a stable hash from the raw file bytes on disk.
 * This avoids re-indexing instability caused by parser version changes.
 */
function hashFileBytes(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Extract text content from a supported file.
 * Returns the extracted text string, or null if the file type is unsupported.
 * Throws on read/parse errors so the caller can log and continue.
 */
async function extractText(filePath: string, ext: string): Promise<string | null> {
  if (ext === '.pdf') {
    // Read as binary buffer — do NOT read PDFs as UTF-8 text
    const dataBuffer = fs.readFileSync(filePath);
    try {
      const pdf = new PDFParse(new Uint8Array(dataBuffer));
      const result = await pdf.getText();
      return result.text;
    } catch (err: any) {
      console.warn(`[KNOWLEDGE] PDF parse failed for ${filePath}: ${err?.message}`);
      return "";
    }
  }

  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }

  if (ext === '.csv') {
    const txt = fs.readFileSync(filePath, 'utf-8');
    return txt
      .split('\n')
      .map((row, idx) => `Row ${idx + 1}: ${row}`)
      .join('\n');
  }

  if (ext === '.xlsx') {
    const workbook = XLSX.readFile(filePath);
    let allTxt = '';
    workbook.SheetNames.forEach((name) => {
      allTxt += `Sheet: ${name}\n`;
      allTxt += XLSX.utils.sheet_to_csv(workbook.Sheets[name]) + '\n\n';
    });
    return allTxt;
  }

  if (ext === '.pptx') {
    const dataBuffer = fs.readFileSync(filePath);
    const zip = await JSZip.loadAsync(dataBuffer);
    let allTxt = '';
    for (const [name, zipObj] of Object.entries(zip.files)) {
      if (name.startsWith('ppt/slides/') && name.endsWith('.xml')) {
        const xmlText = await zipObj.async('text');
        allTxt += xmlText.replace(/<[^>]+>/g, ' ') + ' ';
      }
    }
    return allTxt;
  }

  if (ext === '.md' || ext === '.txt') {
    return fs.readFileSync(filePath, 'utf-8');
  }

  // Unsupported
  return null;
}

/**
 * Index all supported files inside the Knowledge Base directory.
 *
 * The knowledge/ folder is a GLOBAL school-wide Knowledge Base shared by all
 * users. Files placed here (handbooks, FAQs, policies, etc.) are chunked,
 * embedded, and stored in the knowledge_chunks table for RAG retrieval.
 *
 * This function is safe to call repeatedly — it uses file-bytes hashing to
 * skip unchanged files, and isolated try/catch per file so one broken document
 * cannot block the others.
 */
export async function indexKnowledgeBase() {
  console.log(`[KNOWLEDGE] Using directory: ${KNOWLEDGE_DIR}`);

  // Ensure the directory exists
  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
    console.log(`[KNOWLEDGE] Created knowledge directory: ${KNOWLEDGE_DIR}`);
    fs.writeFileSync(
      path.join(KNOWLEDGE_DIR, 'metadata.json'),
      JSON.stringify({
        version: '1.0.0',
        last_updated: new Date().toISOString(),
      })
    );
  }

  const allEntries = fs.readdirSync(KNOWLEDGE_DIR);

  // Counters for summary
  let filesScanned = 0;
  let filesIndexed = 0;
  let filesSkipped = 0;
  let filesFailed = 0;
  let totalChunksInserted = 0;
  const failedFiles: string[] = [];

  for (const file of allEntries) {
    // Skip metadata and hidden files
    if (IGNORED_FILES.has(file) || file.startsWith('.')) continue;

    const filePath = path.join(KNOWLEDGE_DIR, file);

    // Skip directories
    if (fs.statSync(filePath).isDirectory()) continue;

    const ext = path.extname(file).toLowerCase();

    // Skip unsupported file types with a warning
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      console.warn(`[KNOWLEDGE] Skipping unsupported file type: ${file} (${ext})`);
      continue;
    }

    filesScanned++;

    try {
      // Check if the file has changed using a stable byte-level hash
      const fileHash = hashFileBytes(filePath);

      const existingMeta = await db
        .select()
        .from(sourceMetadata)
        .where(eq(sourceMetadata.sourceFile, file));

      if (existingMeta.length > 0 && existingMeta[0].sourceHash === fileHash) {
        const chunkCountResult = await db.execute(sql`
          SELECT COUNT(*)::int AS count
          FROM knowledge_chunks
          WHERE source_file = ${file}
        `);
        const chunkCount = Number((chunkCountResult as any).rows?.[0]?.count || 0);

        if (chunkCount > 0) {
          filesSkipped++;
          continue;
        }

        console.warn(`[KNOWLEDGE] Metadata exists for "${file}" but no chunks were found. Re-indexing.`);
      }

      // Extract text from the file
      const content = await extractText(filePath, ext);

      if (content === null) {
        // extractText returned null = unsupported (shouldn't reach here, but guard)
        console.warn(`[KNOWLEDGE] Skipping unsupported file: ${file}`);
        continue;
      }

      // Check for empty extraction (e.g. scanned/image-only PDFs)
      const trimmed = content.trim();
      if (trimmed.length === 0) {
        console.warn(`[KNOWLEDGE] ⚠ Empty text extracted from "${file}". The file may be scanned/image-only or contain no readable text. Skipping.`);
        filesFailed++;
        failedFiles.push(`${file} (empty text extraction)`);
        continue;
      }

      // Chunk the extracted text
      const chunks = chunkText(trimmed);
      let fileChunksInserted = 0;

      // Generate embeddings in safe batches
      const allValues: Array<{
        sourceFile: string;
        chunkIndex: number;
        content: string;
        embedding: number[];
      }> = [];

      for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
        const batchChunks = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);

        let embeddings: number[][] = [];
        try {
          embeddings = await embedBatch(batchChunks);
        } catch (e: any) {
          console.warn(
            `[KNOWLEDGE] Embedding batch failed for "${file}" chunk index ${i}: ${e?.message}`
          );
          continue; // Skip this batch, try next
        }

        const values = batchChunks
          .map((chunk, idx) => ({
            sourceFile: file,
            chunkIndex: i + idx,
            content: chunk,
            embedding: embeddings[idx] || [],
          }))
          .filter((val) => val.embedding.length > 0);

        if (values.length > 0) {
          allValues.push(...values);
        }
      }

      if (allValues.length === 0) {
        filesFailed++;
        failedFiles.push(`${file} (no chunks inserted)`);
        console.warn(`[KNOWLEDGE] ✗ No chunks inserted for "${file}". Not marking as indexed.`);
        continue;
      }

      // Use transaction to ensure safe replacement
      await db.transaction(async (tx) => {
        await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.sourceFile, file));
        await tx.insert(knowledgeChunks).values(allValues);
        
        await tx.insert(sourceMetadata).values({
          sourceFile: file,
          sourceHash: fileHash,
          sourceVersion: '1.0',
          lastIndexed: new Date(),
        }).onConflictDoUpdate({
          target: sourceMetadata.sourceFile,
          set: {
            sourceHash: fileHash,
            lastIndexed: new Date(),
          },
        });
      });

      fileChunksInserted = allValues.length;
      totalChunksInserted += fileChunksInserted;

      filesIndexed++;
      console.log(`[KNOWLEDGE] ✓ Indexed "${file}" — ${fileChunksInserted} chunks`);

    } catch (err: any) {
      filesFailed++;
      failedFiles.push(`${file} (${err?.message || 'Unknown error'})`);
      console.warn(`[KNOWLEDGE] ✗ Failed to index "${file}": ${err?.message || err}`);
      // Continue with next file — do not let one failure stop all indexing
      continue;
    }
  }

  // Print a useful summary
  console.log(`\n[KNOWLEDGE] ════════════════════════════════════════`);
  console.log(`[KNOWLEDGE]  Indexing Summary`);
  console.log(`[KNOWLEDGE]  Directory : ${KNOWLEDGE_DIR}`);
  console.log(`[KNOWLEDGE]  Scanned   : ${filesScanned} file(s)`);
  console.log(`[KNOWLEDGE]  Indexed   : ${filesIndexed} file(s)`);
  console.log(`[KNOWLEDGE]  Skipped   : ${filesSkipped} file(s) (unchanged)`);
  console.log(`[KNOWLEDGE]  Failed    : ${filesFailed} file(s)`);
  console.log(`[KNOWLEDGE]  Chunks    : ${totalChunksInserted} new chunk(s) inserted`);
  if (failedFiles.length > 0) {
    console.log(`[KNOWLEDGE]  Failures  :`);
    for (const f of failedFiles) {
      console.log(`[KNOWLEDGE]    - ${f}`);
    }
  }
  console.log(`[KNOWLEDGE] ════════════════════════════════════════\n`);

  return {
    filesScanned,
    filesIndexed,
    filesSkipped,
    filesFailed,
    totalChunksInserted,
    failedFiles,
  };
}
import fs from 'fs';
import path from 'path';
import { extractText } from '../src/lib/document-extract.ts';

const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || path.join(process.cwd(), 'knowledge');
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md', '.csv', '.xlsx', '.pptx']);
const IGNORED_FILES = new Set(['metadata.json', 'README.md']);

async function verifyKnowledgeBase() {
  console.log(`[CHECK] Verifying Knowledge Base directory: ${KNOWLEDGE_DIR}`);

  if (!fs.existsSync(KNOWLEDGE_DIR)) {
    console.log(`[CHECK] Knowledge directory does not exist.`);
    return;
  }

  const allEntries = fs.readdirSync(KNOWLEDGE_DIR);
  let filesChecked = 0;
  let emptyCount = 0;
  let errorCount = 0;

  for (const file of allEntries) {
    if (IGNORED_FILES.has(file) || file.startsWith('.')) continue;

    const filePath = path.join(KNOWLEDGE_DIR, file);
    if (fs.statSync(filePath).isDirectory()) continue;

    const ext = path.extname(file).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      console.log(`[CHECK] Skipping unsupported file: ${file}`);
      continue;
    }

    try {
      const content = await extractText(filePath, ext);
      filesChecked++;

      if (content === null) {
        console.log(`[CHECK] ✗ Unsupported extraction for: ${file}`);
        continue;
      }

      const trimmed = content.trim();
      if (trimmed.length === 0) {
        console.warn(`[CHECK] ⚠ Empty text from: ${file} (Possibly scanned/image-only)`);
        emptyCount++;
      } else {
        console.log(`[CHECK] ✓ Read: ${file} (${trimmed.length} characters)`);
      }
    } catch (err: any) {
      console.error(`[CHECK] ✗ Error reading: ${file} -> ${err?.message || err}`);
      errorCount++;
    }
  }

  if (filesChecked === 0) {
    console.log(`[CHECK] No Knowledge Base documents found.`);
    console.log(`[CHECK] Add PDF, DOCX, TXT, MD, CSV, XLSX, or PPTX files to knowledge/.`);
  } else {
    console.log(`\n[CHECK] Summary: Checked ${filesChecked} files.`);
    if (emptyCount > 0) console.warn(`[CHECK] ${emptyCount} file(s) yielded empty text.`);
    if (errorCount > 0) console.error(`[CHECK] ${errorCount} file(s) had read errors.`);
    console.log(`[CHECK] Done.\n`);
  }
}

verifyKnowledgeBase().catch((err) => {
  console.error('[CHECK] Fatal script error:', err);
  process.exit(1);
});

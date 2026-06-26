import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import * as _pdfParse from 'pdf-parse';
const PDFParse = (_pdfParse as any).default || (_pdfParse as any).PDFParse || _pdfParse;
import mammoth from 'mammoth';

const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || path.join(process.cwd(), 'knowledge');
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md', '.csv', '.xlsx', '.pptx']);
const IGNORED_FILES = new Set(['metadata.json']);

async function extractText(filePath: string, ext: string): Promise<string | null> {
  if (ext === '.pdf') {
    const dataBuffer = fs.readFileSync(filePath);
    let pdf: any = null;
    try {
      pdf = new PDFParse({ data: new Uint8Array(dataBuffer) } as any);
      const result = await pdf.getText();
      return result.text || "";
    } catch (err: any) {
      console.warn(`[KNOWLEDGE] PDF parse failed for "${path.basename(filePath)}": ${err?.message || err}`);
      return "";
    } finally {
      try {
        await pdf?.destroy?.();
      } catch {}
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

  return null;
}

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

  console.log(`\n[CHECK] Summary: Checked ${filesChecked} files.`);
  if (emptyCount > 0) console.warn(`[CHECK] ${emptyCount} file(s) yielded empty text.`);
  if (errorCount > 0) console.error(`[CHECK] ${errorCount} file(s) had read errors.`);
  console.log(`[CHECK] Done.\n`);
}

verifyKnowledgeBase().catch((err) => {
  console.error('[CHECK] Fatal script error:', err);
  process.exit(1);
});

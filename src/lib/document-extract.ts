import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import * as _pdfParse from 'pdf-parse';
const PDFParse = (_pdfParse as any).default || (_pdfParse as any).PDFParse || _pdfParse;
import mammoth from 'mammoth';

/**
 * Extract text content from a supported file.
 * Returns the extracted text string, or null if the file type is unsupported.
 * Throws on read/parse errors so the caller can log and continue.
 */
export async function extractText(filePath: string, ext: string): Promise<string | null> {
  if (ext === '.pdf') {
    // Read as binary buffer — do NOT read PDFs as UTF-8 text
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

  // Unsupported
  return null;
}

// Trigger rules — suspicious-file pre-flight (G4).
//
// Before a trigger preview sheet shows the Run button, we read the file
// through whatever suspicious-* tool covers its MIME type and surface the
// verdict to the user. The user still decides — pre-flight makes the
// security state legible BEFORE they decide.
//
// See docs/triggers-security.md §G4 for the load-bearing intent.

import { analyzeSuspicious, type TextSuspiciousResult } from '../tools/text-suspicious/index.js';

/** Severity tiers exposed to the UI. */
export type PreflightVerdict = 'clean' | 'low' | 'medium' | 'high';

export interface PreflightFinding {
  kind: string;
  severity: 'low' | 'medium' | 'high';
  detail: string;
}

export interface PreflightResult {
  verdict: PreflightVerdict;
  findings: PreflightFinding[];
  /**
   * Tool id used for the analysis. null when no suspicious-* tool covers
   * this MIME — that's "not analysed" rather than "clean" and the UI
   * should label it that way. We deliberately don't fake a verdict for
   * categories we can't check.
   */
  toolUsed: string | null;
}

const PREFLIGHT_SIZE_LIMIT = 5 * 1024 * 1024;

/**
 * Run pre-flight analysis on a file. Pure async function: reads the
 * file, picks the right analyzer, returns the verdict. No side effects.
 *
 * For MIMEs we don't have a checker for (image/*, audio/*, video/*),
 * returns { verdict: 'clean', toolUsed: null } so the UI can label it
 * "not analysed".
 */
export async function runPreflight(file: File): Promise<PreflightResult> {
  const mime = file.type;

  // Big files: skip analysis to avoid blocking the preview sheet on
  // multi-MB string reads. The user still sees the file metadata.
  if (file.size > PREFLIGHT_SIZE_LIMIT) {
    return {
      verdict: 'clean',
      findings: [],
      toolUsed: null,
    };
  }

  if (mime === 'application/pdf') {
    return analyzePdf(file);
  }

  if (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/yaml' ||
    mime === 'application/x-yaml'
  ) {
    return analyzeText(file);
  }

  // Image / audio / video / binary — no useful pre-flight today.
  return { verdict: 'clean', findings: [], toolUsed: null };
}

async function analyzeText(file: File): Promise<PreflightResult> {
  const text = await file.text();
  const result = analyzeSuspicious(text, {});
  return projectResult(result, 'text-suspicious');
}

async function analyzePdf(file: File): Promise<PreflightResult> {
  // pdf-suspicious is heavy (pdfjs worker). For the pre-flight we use
  // a streamlined version: extract text via pdfjs, then reuse the same
  // analyzeSuspicious analyser. Same result, smaller dep surface for
  // the trigger module.
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window === 'undefined') {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    try {
      GlobalWorkerOptions.workerSrc = require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');
    } catch {
      GlobalWorkerOptions.workerSrc = 'pdf.worker.mjs';
    }
  }
  const buf = await file.arrayBuffer();
  const pdf = await getDocument({ data: new Uint8Array(buf) }).promise;
  const parts: string[] = [];
  // Cap at 20 pages — pre-flight, not full scan.
  const pageLimit = Math.min(pdf.numPages, 20);
  for (let i = 1; i <= pageLimit; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((it) => ('str' in it ? it.str ?? '' : '')).join(' '));
  }
  const result = analyzeSuspicious(parts.join('\n\n'), {});
  return projectResult(result, 'pdf-suspicious');
}

function projectResult(r: TextSuspiciousResult, toolUsed: string): PreflightResult {
  return {
    verdict: r.verdict,
    findings: r.findings,
    toolUsed,
  };
}

/**
 * The hex preview shown on the preview sheet. The user inspects this to
 * confirm the file matches its declared MIME — e.g. spot a .pdf that's
 * actually a ZIP. Returns the first 256 bytes as a space-separated hex
 * string, plus the human-readable file header signature when we
 * recognise it.
 */
export interface FileHeader {
  hex: string;
  /** Recognised magic-number label, or null if unknown. */
  signatureLabel: string | null;
}

export async function readFileHeader(file: File, bytes = 256): Promise<FileHeader> {
  const slice = await file.slice(0, bytes).arrayBuffer();
  const u8 = new Uint8Array(slice);
  const hex = Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join(' ');
  return { hex, signatureLabel: classifyMagic(u8) };
}

function classifyMagic(u8: Uint8Array): string | null {
  if (u8.length < 4) return null;
  // PDF: %PDF-
  if (u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46) return 'PDF';
  // PNG: 89 50 4E 47
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return 'PNG';
  // JPEG: FF D8 FF
  if (u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return 'JPEG';
  // GIF: GIF87a / GIF89a
  if (u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return 'GIF';
  // ZIP / docx / xlsx / pptx / odt — PK
  if (u8[0] === 0x50 && u8[1] === 0x4b && (u8[2] === 0x03 || u8[2] === 0x05 || u8[2] === 0x07)) return 'ZIP-shaped';
  // GZIP: 1F 8B
  if (u8[0] === 0x1f && u8[1] === 0x8b) return 'GZIP';
  // WebP: RIFF .... WEBP
  if (u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46) {
    if (u8.length >= 12 && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50)
      return 'WebP';
    return 'RIFF';
  }
  return null;
}

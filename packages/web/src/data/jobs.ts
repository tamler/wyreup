import { mimeMatches } from '@wyreup/core';
import type { ToolbeltChainStep } from '../components/runners/toolbeltStorage';

export type JobAction =
  | { kind: 'tool'; toolId: string; params?: Record<string, unknown> }
  | { kind: 'chain'; steps: ToolbeltChainStep[] };

export interface Job {
  slug: string;
  title: string;
  description: string;
  action: JobAction;
  acceptMimes: string[];
  priority: number;
}

export const JOBS: Job[] = [
  {
    slug: 'compress-photo-for-email',
    title: 'Compress a photo for email',
    description: 'Make a photo small enough to send without losing more quality than necessary.',
    action: { kind: 'tool', toolId: 'compress' },
    acceptMimes: ['image/*'],
    priority: 10,
  },
  {
    slug: 'convert-heic-to-jpg',
    title: 'Convert HEIC to JPG',
    description: 'Turn an iPhone photo into a JPG that websites and other devices can open.',
    action: { kind: 'tool', toolId: 'heic-to-jpg', params: { format: 'jpeg' } },
    acceptMimes: ['image/heic', 'image/heif'],
    priority: 15,
  },
  {
    slug: 'scan-to-searchable-text',
    title: 'Make a scan searchable',
    description: 'Pull the text out of a photo or scanned page so you can copy and search it.',
    action: { kind: 'tool', toolId: 'ocr' },
    acceptMimes: ['image/*'],
    priority: 20,
  },
  {
    slug: 'remove-photo-location-data',
    title: 'Remove location data from a photo',
    description: 'Strip GPS, camera, and timestamp details before sharing a photo.',
    action: { kind: 'tool', toolId: 'strip-exif' },
    acceptMimes: ['image/*'],
    priority: 30,
  },
  {
    slug: 'share-photo-safely',
    title: 'Share a photo safely',
    description: 'Remove private metadata and make the photo smaller in one pass.',
    action: {
      kind: 'chain',
      steps: [
        { toolId: 'strip-exif', params: {} },
        { toolId: 'compress', params: { quality: 80 } },
      ],
    },
    acceptMimes: ['image/*'],
    priority: 40,
  },
  {
    slug: 'prepare-image-for-web',
    title: 'Prepare an image for a website',
    description: 'Resize and compress an image for faster web pages.',
    action: {
      kind: 'chain',
      steps: [
        { toolId: 'resize', params: { width: 1600 } },
        { toolId: 'compress', params: { quality: 80 } },
      ],
    },
    acceptMimes: ['image/*'],
    priority: 50,
  },
  {
    slug: 'merge-receipts-into-pdf',
    title: 'Merge receipts into one PDF',
    description: 'Combine receipt photos into one PDF for filing or reimbursement.',
    action: { kind: 'tool', toolId: 'image-to-pdf' },
    acceptMimes: ['image/*'],
    priority: 60,
  },
  {
    slug: 'clean-up-voice-recording',
    title: 'Clean up a voice recording',
    description: 'Improve a low-quality recording so speech sounds clearer.',
    action: { kind: 'tool', toolId: 'audio-enhance' },
    acceptMimes: ['audio/*'],
    priority: 110,
  },
  {
    slug: 'transcribe-a-recording',
    title: 'Turn a recording into text',
    description: 'Create a written transcript from spoken audio.',
    action: { kind: 'tool', toolId: 'transcribe' },
    acceptMimes: ['audio/*'],
    priority: 120,
  },
  {
    slug: 'compress-pdf-for-upload',
    title: 'Shrink a PDF for upload',
    description: 'Reduce a PDF so it fits an upload size limit.',
    action: { kind: 'tool', toolId: 'pdf-compress' },
    acceptMimes: ['application/pdf'],
    priority: 210,
  },
  {
    slug: 'pdf-to-text',
    title: 'Get the text out of a PDF',
    description: 'Extract plain text from a PDF for copying or editing.',
    action: { kind: 'tool', toolId: 'pdf-to-text' },
    acceptMimes: ['application/pdf'],
    priority: 220,
  },
  {
    slug: 'merge-pdfs',
    title: 'Combine PDFs into one',
    description: 'Join multiple PDF files into a single document.',
    action: { kind: 'tool', toolId: 'merge-pdf' },
    acceptMimes: ['application/pdf'],
    priority: 230,
  },
  {
    slug: 'translate-a-document',
    title: 'Translate a document',
    description: 'Turn a PDF or text file into another language.',
    action: { kind: 'tool', toolId: 'translate-document-pro' },
    acceptMimes: ['application/pdf', 'text/plain'],
    priority: 240,
  },
  {
    slug: 'shrink-video',
    title: 'Make a video smaller',
    description: 'Reduce a video file so it is easier to upload or share.',
    action: { kind: 'tool', toolId: 'compress-video' },
    acceptMimes: ['video/*'],
    priority: 310,
  },
  {
    slug: 'spreadsheet-to-json',
    title: 'Convert a spreadsheet to JSON',
    description: 'Turn a CSV spreadsheet into structured JSON data.',
    action: { kind: 'tool', toolId: 'csv-json' },
    acceptMimes: ['text/csv'],
    priority: 410,
  },
];

export function jobsForMime(mime: string): Job[] {
  return JOBS.filter((job) => job.acceptMimes.some((pattern) => mimeMatches(mime, pattern))).sort(
    (a, b) => a.priority - b.priority || a.slug.localeCompare(b.slug),
  );
}

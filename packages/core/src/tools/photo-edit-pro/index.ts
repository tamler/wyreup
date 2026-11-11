import type { ToolModule, ToolRunContext } from '../../types.js';
import { runPro, fileToBase64 } from '../../lib/pro-runner.js';
import { loadImage, createCanvas, canvasToBlob } from '../../lib/canvas.js';

export type PhotoEditAction = 'custom' | 'remove' | 'colorize' | 'restore';

export interface PhotoEditProParams {
  /** Quick action that writes the instruction for you. */
  edit?: PhotoEditAction;
  /** Your own instruction, or for "remove", what to remove. */
  prompt?: string;
}

export const defaultPhotoEditProParams: PhotoEditProParams = { edit: 'custom', prompt: '' };

/** The hosted model takes a reference image of at most 512px per side. */
export const PHOTO_EDIT_INPUT_SIDE = 512;
/** Matches the server's prompt cap. */
export const PHOTO_EDIT_PROMPT_MAX = 1000;
const DETAIL_MAX = 600;

/**
 * Build the instruction sent to the model from a quick action plus the
 * user's own words. Throws when the action needs text and none was given.
 */
export function buildPhotoEditPrompt(params: PhotoEditProParams): string {
  const detail = (params.prompt ?? '').trim();
  if (detail.length > DETAIL_MAX) {
    throw new Error(`Keep the instruction under ${DETAIL_MAX} characters.`);
  }
  const extra = detail ? ` ${detail}` : '';
  switch (params.edit ?? 'custom') {
    case 'remove':
      if (!detail) throw new Error('Say what to remove, for example "the man on the left".');
      return `Remove ${detail} from the photo. Fill the area so it matches the surrounding background. Keep everything else exactly the same.`;
    case 'colorize':
      return `Colorize this black and white photo with natural, realistic colors. Keep the composition, people and details exactly the same.${extra}`;
    case 'restore':
      return `Restore this old photo: remove scratches, dust, stains and creases, fix faded areas and gently sharpen it. Keep the people, faces and composition exactly the same.${extra}`;
    case 'custom':
      if (!detail)
        throw new Error('Describe the edit you want, for example "make the sky a clear blue".');
      return detail;
    default:
      throw new Error('Unknown edit type.');
  }
}

interface PhotoEditResult {
  contentType: string;
  base64: string;
}

export const photoEditPro: ToolModule<PhotoEditProParams> = {
  id: 'photo-edit-pro',
  slug: 'photo-edit-pro',
  name: 'AI Photo Edit',
  description:
    'Edit a photo by describing the change: remove something, colorize a black and white photo, restore an old one, or write your own instruction. Runs on hosted FLUX.2 [klein] 4B. Your photo is scaled to 512px before upload and the result comes back at up to 1024px. AI results vary, and faces or fine details can change. Uses 1 credit per run.',
  llmDescription:
    'Photo Edit (Pro, 1 credit): edits one PNG/JPEG/WebP image from a text instruction using hosted FLUX.2 [klein] 4B. Set `edit` to "remove" (prompt = what to remove), "colorize", "restore" (prompt optional extra detail) or "custom" (prompt = full instruction). The image is downscaled to fit 512x512 before upload; output is up to 1024px on the long side in the same aspect ratio. Generative: results vary between runs and faces or small details may change.',
  category: 'edit',
  keywords: [
    'photo',
    'edit',
    'ai',
    'remove object',
    'colorize',
    'restore',
    'old photo',
    'flux',
    'pro',
  ],

  input: {
    accept: ['image/jpeg', 'image/png', 'image/webp'],
    min: 1,
    max: 1,
    sizeLimit: 10 * 1024 * 1024,
  },
  output: { mime: 'image/*' },

  interactive: false,
  batchable: false,
  cost: 'credit',
  creditCost: 1,
  memoryEstimate: 'low',

  chainSuggestions: ['compress', 'convert', 'image-watermark', 'upscale-2x-pro'],

  defaults: defaultPhotoEditProParams,
  paramSchema: {
    edit: {
      type: 'enum',
      label: 'edit type',
      help: 'Pick a quick action, or choose "Your own instruction" and describe the change.',
      options: [
        { value: 'custom', label: 'Your own instruction' },
        { value: 'remove', label: 'Remove something' },
        { value: 'colorize', label: 'Colorize a black and white photo' },
        { value: 'restore', label: 'Restore an old photo' },
      ],
    },
    prompt: {
      type: 'string',
      label: 'instruction',
      multiline: true,
      maxLength: DETAIL_MAX,
      placeholder: 'Make the sky a clear blue',
      help: 'For "Remove something", say what to remove. For colorize and restore this is optional extra detail, such as "the dress is red".',
    },
  },

  async run(inputs: File[], params: PhotoEditProParams, ctx: ToolRunContext): Promise<Blob> {
    if (inputs.length !== 1) throw new Error('photo-edit-pro accepts exactly one image.');
    const prompt = buildPhotoEditPrompt(params);
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 10, message: 'Preparing photo' });
    const prepared = await fitForUpload(inputs[0]!);
    if (ctx.signal.aborted) throw new Error('Aborted');

    ctx.onProgress({ stage: 'processing', percent: 30, message: 'Editing with hosted model' });
    const imageBase64 = await fileToBase64(prepared);
    const result = await runPro<PhotoEditResult>(
      'photo-edit-pro',
      { imageBase64, prompt, fileName: inputs[0]!.name },
      ctx,
    );

    const bytes = base64ToBytes(result.base64);
    ctx.onProgress({ stage: 'done', percent: 100 });
    return new Blob([bytes.buffer as ArrayBuffer], { type: result.contentType });
  },

  __testFixtures: { valid: [], weird: [], expectedOutputMime: ['image/jpeg', 'image/png'] },
};

/**
 * Re-encode the photo to fit within 512x512, keeping its aspect ratio.
 * Always re-encodes, which also drops EXIF metadata (including location)
 * before upload. PNG stays PNG to keep transparency; everything else
 * becomes JPEG.
 */
async function fitForUpload(file: File): Promise<File> {
  const image = await loadImage(file);
  const scale = Math.min(1, PHOTO_EDIT_INPUT_SIDE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = await createCanvas(width, height);
  canvas.getContext('2d').drawImage(image, 0, 0, width, height);
  const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const blob = await canvasToBlob(canvas, mime, mime === 'image/jpeg' ? 0.92 : undefined);
  return new File([blob], file.name, { type: mime });
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

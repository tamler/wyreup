import type { ToolModule, ToolRunContext } from '../../types.js';
import { createCanvas, loadImage, canvasToBlob } from '../../lib/canvas.js';

export interface FaceBlurParams {
  /** Blur radius in pixels. Default 20. Bigger = more anonymized. */
  blurRadius?: number;
  /** Minimum detection confidence (0-1). Default 0.5. */
  minConfidence?: number;
  /** Expand each detected box by this fraction before blurring (0.2 = 20% bigger). Default 0.2. */
  padding?: number;
  /** Blur shape. 'rectangle' = axis-aligned rect (fast). 'ellipse' = oval (more natural). Default 'ellipse'. */
  shape?: 'rectangle' | 'ellipse';
}

export const defaultFaceBlurParams: FaceBlurParams = {
  blurRadius: 20,
  minConfidence: 0.5,
  padding: 0.2,
  shape: 'ellipse',
};

const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// ──── Pure helpers ────

export interface BoundingBox {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface ExpandedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Expand a detected bounding box by `padding` fraction of its dimensions,
 * clamped to the image boundaries.
 */
export function expandBox(
  box: BoundingBox,
  padding: number,
  imgWidth: number,
  imgHeight: number,
): ExpandedBox {
  const padX = box.width * padding;
  const padY = box.height * padding;
  const x = Math.max(0, box.originX - padX);
  const y = Math.max(0, box.originY - padY);
  const w = Math.min(imgWidth - x, box.width + 2 * padX);
  const h = Math.min(imgHeight - y, box.height + 2 * padY);
  return { x, y, w, h };
}

/**
 * Blur a rectangular or elliptical region of a canvas.
 *
 * Strategy: draw the source canvas blurred onto a scratch canvas, then
 * copy the blurred region back over the original using clip paths.
 *
 * @napi-rs/canvas supports `filter: blur()` so this works in Node too.
 */
export function blurRegion(
  sourceCanvas: { width: number; height: number },
  sourceCtx: {
    drawImage(src: unknown, x: number, y: number): void;
    save(): void;
    restore(): void;
    beginPath?(): void;
    ellipse?(cx: number, cy: number, rx: number, ry: number, rot: number, start: number, end: number): void;
    rect?(x: number, y: number, w: number, h: number): void;
    clip?(): void;
    filter?: string;
  },
  blurCanvas: {
    width: number;
    height: number;
    getContext(type: '2d'): {
      filter?: string;
      drawImage(src: unknown, x: number, y: number): void;
    };
  },
  box: ExpandedBox,
  blurRadius: number,
  shape: 'rectangle' | 'ellipse',
): void {
  // Step 1: render blurred version of the whole image onto blurCanvas
  const blurCtx = blurCanvas.getContext('2d');
  blurCtx.filter = `blur(${blurRadius}px)`;
  blurCtx.drawImage(sourceCanvas as unknown, 0, 0);

  // Step 2: clip to the face region, copy blurred pixels back
  sourceCtx.save();

  if (sourceCtx.beginPath) {
    sourceCtx.beginPath();
    if (shape === 'ellipse' && sourceCtx.ellipse) {
      sourceCtx.ellipse(
        box.x + box.w / 2,
        box.y + box.h / 2,
        box.w / 2,
        box.h / 2,
        0,
        0,
        Math.PI * 2,
      );
    } else if (sourceCtx.rect) {
      sourceCtx.rect(box.x, box.y, box.w, box.h);
    }
    if (sourceCtx.clip) {
      sourceCtx.clip();
    }
  }

  sourceCtx.drawImage(blurCanvas as unknown, 0, 0);
  sourceCtx.restore();
}

// ──── MediaPipe face detector (cached per session) ────

type FaceDetectorInstance = {
  detect(image: unknown): {
    detections: Array<{
      boundingBox?: BoundingBox | null;
      categories?: Array<{ score: number }> | null;
    }>;
  };
};

async function getDetector(ctx: ToolRunContext): Promise<FaceDetectorInstance> {
  const cached = ctx.cache.get('face-blur:detector') as FaceDetectorInstance | undefined;
  if (cached) return cached;

  const { FilesetResolver, FaceDetector } = await import('@mediapipe/tasks-vision');

  // Use the bundled WASM files from the npm package, resolved via file URL.
  // In browsers the bundler will handle this; in Node we resolve from node_modules.
  let wasmPath: string;
  if (typeof process !== 'undefined' && process.versions?.node) {
    // Node: resolve the wasm/ directory from the installed package.
    // Use createRequire to find the package root, then append /wasm.
    // We use the vision_bundle.mjs entrypoint (exported as ".") to locate the pkg root.
    const { createRequire } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const req = createRequire(import.meta.url);
    // resolve the CJS bundle — this works even with an exports map
    const bundlePath = req.resolve('@mediapipe/tasks-vision');
    wasmPath = pathToFileURL(join(dirname(bundlePath), 'wasm')).href;
  } else {
    // Browser: CDN fallback (bundler can override via alias)
    wasmPath = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm';
  }

  const vision = await FilesetResolver.forVisionTasks(wasmPath);
  const detector = await FaceDetector.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
      delegate: 'CPU', // GPU requires WebGPU; CPU via WASM is universal
    },
    runningMode: 'IMAGE',
    minDetectionConfidence: 0.3, // filter more strictly post-hoc via minConfidence param
  });

  ctx.cache.set('face-blur:detector', detector);
  return detector as unknown as FaceDetectorInstance;
}

// ──── Tool module ────

const FaceBlurComponentStub = (): unknown => null;

export const faceBlur: ToolModule<FaceBlurParams> = {
  id: 'face-blur',
  slug: 'face-blur',
  name: 'Face Blur',
  description: 'Detect every face in a photo and blur it — runs entirely on your device.',
  category: 'privacy',
  presence: 'both',
  keywords: ['face', 'blur', 'privacy', 'anonymize', 'redact', 'pixelate'],

  input: {
    accept: ACCEPTED_MIME_TYPES,
    min: 1,
    sizeLimit: 50 * 1024 * 1024,
  },
  output: { mime: 'image/png' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'medium',
  // No `requires` field — MediaPipe runs on WASM universally (no WebGPU needed)

  defaults: defaultFaceBlurParams,

  Component: FaceBlurComponentStub,

  async run(inputs: File[], params: FaceBlurParams, ctx: ToolRunContext): Promise<Blob[]> {
    for (const input of inputs) {
      if (!ACCEPTED_MIME_TYPES.includes(input.type)) {
        throw new Error(
          `Unsupported input type: ${input.type}. Accepted: ${ACCEPTED_MIME_TYPES.join(', ')}`,
        );
      }
    }

    const {
      blurRadius = 20,
      minConfidence = 0.5,
      padding = 0.2,
      shape = 'ellipse',
    } = params;

    ctx.onProgress({ stage: 'loading-deps', percent: 0, message: 'Loading face detector' });

    const detector = await getDetector(ctx);

    const outputs: Blob[] = [];

    for (let i = 0; i < inputs.length; i++) {
      if (ctx.signal.aborted) throw new Error('Aborted');

      ctx.onProgress({
        stage: 'processing',
        percent: Math.round((i / inputs.length) * 90),
        message: `Processing ${i + 1} of ${inputs.length}`,
      });

      const img = await loadImage(inputs[i]!);
      const canvas = await createCanvas(img.width, img.height);
      const context = canvas.getContext('2d') as unknown as {
        drawImage(src: unknown, x: number, y: number): void;
        save(): void;
        restore(): void;
        beginPath(): void;
        ellipse(cx: number, cy: number, rx: number, ry: number, rot: number, start: number, end: number): void;
        rect(x: number, y: number, w: number, h: number): void;
        clip(): void;
        filter?: string;
      };

      context.drawImage(img as unknown, 0, 0);

      // Run face detection on the loaded image element
      const result = detector.detect(img);
      const faces = result.detections.filter(
        (d) => (d.categories?.[0]?.score ?? 1) >= minConfidence,
      );

      if (faces.length > 0) {
        // Create a single scratch canvas for blurring, reused across all faces
        const blurCanvas = await createCanvas(img.width, img.height) as unknown as {
          width: number;
          height: number;
          getContext(type: '2d'): { filter?: string; drawImage(src: unknown, x: number, y: number): void };
        };

        for (const face of faces) {
          if (!face.boundingBox) continue;
          const box = expandBox(face.boundingBox, padding, img.width, img.height);
          blurRegion(
            canvas as unknown as { width: number; height: number },
            context,
            blurCanvas,
            box,
            blurRadius,
            shape,
          );
        }
      }

      outputs.push(await canvasToBlob(canvas, 'image/png'));
    }

    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return outputs;
  },

  __testFixtures: {
    valid: ['photo.jpg'],
    weird: [],
    expectedOutputMime: ['image/png'],
  },
};

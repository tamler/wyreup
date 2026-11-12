const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PROMPT_BYTES = 1000;

/**
 * Encode a candidate model request. This helper does not decode or validate images
 * and is not connected to a provider. The server route remains disabled.
 */
export function encodeImageEditMultipart(input: {
  image: Uint8Array;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  prompt: string;
}): { body: ReadableStream<Uint8Array>; contentType: string } {
  if (!input.image.length || input.image.length > MAX_IMAGE_BYTES) {
    throw new Error('Invalid image size');
  }
  if (!input.prompt.trim() || new TextEncoder().encode(input.prompt).byteLength > MAX_PROMPT_BYTES) {
    throw new Error('Invalid edit instruction');
  }

  const form = new FormData();
  form.set('input_image_0', new Blob([Uint8Array.from(input.image).buffer], { type: input.mime }), 'image');
  form.set('prompt', input.prompt);
  form.set('width', '512');
  form.set('height', '512');
  const response = new Response(form);
  const contentType = response.headers.get('content-type');
  if (!response.body || !contentType) throw new Error('Unable to encode image request');
  return { body: response.body, contentType };
}

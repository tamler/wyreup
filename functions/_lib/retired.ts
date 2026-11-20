const retiredToolIds = new Set([
  'analyze-chart',
  'bg-remove-pro',
  'chat-long-pdf-pro',
  'content-safety-pro',
  'cron-from-text-pro',
  'deep-analysis-pro',
  'detect-objects',
  'fix-grammar-pro',
  'image-describe',
  'image-generate-pro',
  'image-q-and-a',
  'json-extract-pro',
  'ocr-hq',
  'pdf-q-and-a',
  'pdf-summarize',
  'read-handwriting',
  'regex-from-text-pro',
  'rewrite-tone-pro',
  'text-ner-pro',
  'text-redact-pro',
  'text-sentiment-pro',
  'text-summarize-pro',
  'text-to-speech-pro',
  'text-translate-pro',
  'transcribe-and-translate',
  'transcribe-pro',
  'translate-document-pro',
  'translate-image',
  'translate-indic-pro',
  'translate-many-pro',
  'upscale-2x-pro',
]);

export function retiredApiResponse(): Response {
  return new Response(JSON.stringify({ error: 'This API has been retired.' }), {
    status: 410,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function retiredToolPageResponse(pathname: string, method: string): Response | undefined {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    // Middleware already rejected malformed first segments. Classify the intact
    // first segment without attempting to decode the malformed remainder again.
    const firstSegment = pathname.replace(/^\/+/, '').split('/', 1)[0] ?? '';
    if (/^\/*tools(?:\/|$)/i.test(decodeURIComponent(firstSegment))) {
      return new Response(null, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    return undefined;
  }

  const [, scope, id, child] = decodedPath.replace(/\/{2,}/g, '/').toLowerCase().split('/');
  if (scope !== 'tools' || !id) return undefined;
  const htmlId = !child && id.endsWith('.html') ? id.slice(0, -5) : id;
  if (!retiredToolIds.has(htmlId)) return undefined;
  if (method !== 'GET' && method !== 'HEAD') return retiredApiResponse();
  return new Response(null, {
    status: 301,
    headers: { Location: '/tools/', 'Cache-Control': 'no-store' },
  });
}

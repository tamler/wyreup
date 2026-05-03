/**
 * Cross-platform DOMParser. Browsers have a global; Node lazy-loads
 * @xmldom/xmldom. Used by geospatial tools that parse KML/GPX/TCX.
 */

interface ParserLike {
  parseFromString(text: string, mime: string): Document;
}

export async function getDomParser(): Promise<ParserLike> {
  if (typeof globalThis.DOMParser !== 'undefined') {
    return new globalThis.DOMParser();
  }
  const mod = await import('@xmldom/xmldom');
  return new mod.DOMParser() as unknown as ParserLike;
}

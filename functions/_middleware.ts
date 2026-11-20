import type { PagesFunction } from './_lib/types';
import { retiredApiResponse, retiredToolPageResponse } from './_lib/retired';

const PUBLIC_METHODS = new Map([
  ['/api/domain-age', 'POST'],
]);

function apiLikePath(pathname: string): boolean {
  const firstSegment = pathname.replace(/^\/+/, '').split('/', 1)[0] ?? '';
  try {
    // Decoding is only for classification. Allowlisting below always uses
    // the original path so encoded and repeated-slash variants stay denied.
    return /^api(?:\/|$)/i.test(decodeURIComponent(firstSegment));
  } catch {
    // An invalid first segment must not fall through into static routing.
    return true;
  }
}

function allowedPublicPath(pathname: string): string | undefined {
  if (PUBLIC_METHODS.has(pathname)) return pathname;
  if (pathname.endsWith('/') && !pathname.endsWith('//')) {
    const withoutOneTrailingSlash = pathname.slice(0, -1);
    if (PUBLIC_METHODS.has(withoutOneTrailingSlash)) return withoutOneTrailingSlash;
  }
  return undefined;
}

export const onRequest: PagesFunction = ({ request, next }) => {
  const rawUrl = request.url;
  const rawPathname = rawUrl.match(/^[a-z][a-z\d+.-]*:\/\/[^/?#]*(\/[^?#]*)?/i)?.[1] || '/';
  const parsed = new URL(rawUrl);
  if (rawPathname !== parsed.pathname) return retiredApiResponse();
  const route = !rawUrl.includes('?') && !rawUrl.includes('#')
    ? allowedPublicPath(rawPathname)
    : undefined;
  if (route && PUBLIC_METHODS.get(route) === request.method) return next();
  if (apiLikePath(rawPathname)) return retiredApiResponse();
  if (/%(?![\da-f]{2})/i.test(rawPathname)) return retiredApiResponse();
  return retiredToolPageResponse(rawPathname, request.method) ?? next();
};

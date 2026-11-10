// Browser side of /api/shares. The server re-checks every rule; this list
// only decides where the button appears and must match functions/_lib/shares.ts.
export const SHAREABLE_TOOL_IDS: readonly string[] = [
  'ocr-hq',
  'read-handwriting',
  'transcribe-pro',
  'text-translate-pro',
  'translate-document-pro',
  'pdf-q-and-a',
  'pdf-summarize',
  'text-summarize-pro',
];

/** Build-time switch, paired with the server's SHARE_LINKS_ENABLED. Off unless set to "1". */
export const SHARE_LINKS_ENABLED: boolean = import.meta.env.PUBLIC_SHARE_LINKS === '1';

export function isShareableTool(toolId: string): boolean {
  return SHAREABLE_TOOL_IDS.includes(toolId);
}

/** Whether a result of this tool shows the share button. */
export function showShareFor(toolId: string, cost: string | undefined, enabled = SHARE_LINKS_ENABLED): boolean {
  return enabled && cost === 'credit' && isShareableTool(toolId);
}

export interface ShareLink {
  id: string;
  url: string;
  expiresAt: number;
}

export interface ShareSummary extends ShareLink {
  toolId: string;
  preview: string;
  createdAt: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const headers = { 'Content-Type': 'application/json', 'X-Wyreup-CSRF': '1' };

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  if (res.status === 401) return new Error('Sign in to create a share link.');
  return new Error(typeof body.error === 'string' ? body.error : fallback);
}

export async function createShareLink(toolId: string, text: string, fetchImpl: FetchLike = fetch): Promise<ShareLink> {
  const res = await fetchImpl('/api/shares', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({ toolId, text }),
  });
  if (!res.ok) throw await errorFrom(res, `Could not create a link (${res.status})`);
  return (await res.json()) as ShareLink;
}

export async function listShareLinks(fetchImpl: FetchLike = fetch): Promise<ShareSummary[]> {
  const res = await fetchImpl('/api/shares', { credentials: 'same-origin' });
  if (!res.ok) throw await errorFrom(res, `Could not load links (${res.status})`);
  return ((await res.json()) as { shares: ShareSummary[] }).shares;
}

export async function deleteShareLink(id: string, fetchImpl: FetchLike = fetch): Promise<void> {
  const res = await fetchImpl('/api/shares/delete', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw await errorFrom(res, `Could not delete the link (${res.status})`);
}

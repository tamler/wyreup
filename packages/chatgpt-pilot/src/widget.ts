import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';

const MAX_BYTES = 7 * 1024 * 1024;
const MAX_ENVELOPE = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT = 20_000;
type Output = { name: string; mimeType: string; bytes: number; base64: string; sha256: string };
const root = document.getElementById('wyreup-result');
if (!root) throw new Error('Missing result mount');
const style = document.createElement('style');
style.textContent = 'body{margin:0;font:15px/1.5 system-ui,sans-serif;color:light-dark(#172332,#edf3fa);background:light-dark(#fff,#172332);color-scheme:light dark}section{padding:20px;max-width:640px}h2{font-size:19px;margin:0 0 12px}p{margin:10px 0}button{font:inherit;padding:9px 16px;border:1px solid currentColor;border-radius:6px;background:transparent;color:inherit;cursor:pointer}button:focus-visible{outline:3px solid #4084e6;outline-offset:3px}button:disabled{opacity:.5;cursor:default}.disclosure{font-size:13px;opacity:.85}';
document.head.append(style);
const section = document.createElement('section');
const heading = document.createElement('h2');
heading.textContent = 'Wyreup file result';
const details = document.createElement('p');
details.id = 'details';
const status = document.createElement('p');
status.id = 'status';
status.setAttribute('role', 'status');
status.setAttribute('aria-live', 'polite');
status.textContent = 'Waiting for the file result.';
const download = document.createElement('button');
download.id = 'download';
download.type = 'button';
download.textContent = 'Download file';
download.disabled = true;
const privacy = document.createElement('p');
privacy.className = 'disclosure';
privacy.textContent = 'Inputs and output bytes pass through OpenAI, including this download. Processing runs on the operator’s host. Wyreup keeps no server-side job files. This mounted ChatGPT card retains the result until cancellation or teardown; OpenAI retention policies apply.';
const limits = document.createElement('p');
limits.className = 'disclosure';
limits.textContent = 'Compression can convert PNG to JPEG and lose transparency. Metadata removal re-encodes pixels and preserves orientation; it does not redact visible content. PDF merging preserves document contents and does not sanitize active content.';
section.append(heading, details, status, download, privacy, limits);
root.append(section);

const app = new App({ name: 'Wyreup private pilot', version: '0.1.0' }, {});
let output: Output | undefined;
let received = false;
let generation = 0;
let pending = false;
let controller: AbortController | undefined;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function clear(message: string) {
  received = true;
  generation++;
  controller?.abort();
  controller = undefined;
  output = undefined;
  pending = false;
  download.disabled = true;
  details.textContent = '';
  status.textContent = message;
}
function bounded(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length <= MAX_ENVELOPE;
}
function validOutput(value: unknown): value is Output {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'base64,bytes,mimeType,name,sha256') return false;
  const names: Record<string, string[]> = {
    'image/jpeg': ['compressed.jpg', 'metadata-removed.jpg'],
    'image/png': ['compressed.png', 'metadata-removed.png'],
    'image/webp': ['compressed.webp', 'metadata-removed.webp'],
    'application/pdf': ['merged.pdf'],
  };
  return typeof value.mimeType === 'string' && typeof value.name === 'string'
    && (names[value.mimeType]?.includes(value.name) ?? false)
    && typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= MAX_BYTES
    && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)
    && typeof value.base64 === 'string' && value.base64.length === 4 * Math.ceil(value.bytes / 3)
    && value.base64.endsWith('='.repeat((3 - value.bytes % 3) % 3))
    && !/[^A-Za-z0-9+/]/.test(value.base64.slice(0, value.base64.length - (3 - value.bytes % 3) % 3));
}
async function handleResult(result: Parameters<NonNullable<typeof app.ontoolresult>>[0]): Promise<void> {
  if (received) return;
  received = true;
  const current = generation;
  try {
    if (!bounded(result)) throw new Error('Oversized result');
    const structured = result.structuredContent;
    if (result.isError || !object(structured) || structured.status !== 'success') {
      const code = object(structured) && typeof structured.code === 'string' ? structured.code : 'TOOL_ERROR';
      const host = object(structured) && code === 'FILE_HOST_NOT_ENABLED' && typeof structured.downloadHost === 'string'
        && /^[a-z0-9.-]{1,253}$/.test(structured.downloadHost) ? ' Upload hostname: ' + structured.downloadHost + '.' : '';
      clear('File processing failed (' + code.replace(/[^A-Z_]/g, '').slice(0, 64) + '). No download is available.' + host);
      return;
    }
    const candidate = result._meta?.output;
    if (!validOutput(candidate) || !object(structured.output)
      || structured.output.name !== candidate.name || structured.output.mimeType !== candidate.mimeType
      || structured.output.bytes !== candidate.bytes || structured.targetReached === false
      || typeof structured.operation !== 'string'
      || !['compress_image_to_size', 'strip_image_metadata', 'merge_pdfs'].includes(structured.operation)) throw new Error('Invalid output');
    const prefix = structured.operation === 'compress_image_to_size' ? 'compressed.'
      : structured.operation === 'strip_image_metadata' ? 'metadata-removed.' : 'merged.';
    if (!candidate.name.startsWith(prefix) || (structured.operation === 'merge_pdfs') !== (candidate.mimeType === 'application/pdf')) throw new Error('Mismatched output operation');
    if (structured.operation === 'compress_image_to_size' && (structured.targetReached !== true
      || typeof structured.targetBytes !== 'number' || !Number.isSafeInteger(structured.targetBytes)
      || structured.targetBytes < 10 * 1024 || structured.targetBytes > 10240 * 1024
      || candidate.bytes > structured.targetBytes)) throw new Error('Invalid compression target');
    const bytes = Uint8Array.from(atob(candidate.base64), (character) => character.charCodeAt(0));
    if (bytes.length !== candidate.bytes) throw new Error('Length mismatch');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) => value.toString(16).padStart(2, '0')).join('');
    if (hash !== candidate.sha256) throw new Error('Checksum mismatch');
    if (current !== generation) return;
    output = candidate;
    details.textContent = candidate.name + ' · ' + candidate.bytes.toLocaleString() + ' bytes · ' + candidate.mimeType;
    if (!app.getHostCapabilities()?.downloadFile) {
      status.textContent = 'Unsupported host: this ChatGPT host does not offer file downloads. Try a host with the standard download-file capability.';
      return;
    }
    status.textContent = 'File verified. Choose Download file to ask ChatGPT to save it.';
    download.disabled = false;
  } catch {
    if (current === generation) clear('Result validation failed. No download is available.');
  }
}
app.ontoolresult = (result) => { void handleResult(result); };
app.ontoolcancelled = () => clear('Cancelled. The result has been cleared.');
app.onteardown = () => { clear('Closed. The result has been cleared.'); return {}; };
app.onerror = () => {};
app.onclose = () => clear('Connection lost. Download failed; reconnect and run the tool again.');
window.addEventListener('pagehide', () => clear('Closed. The result has been cleared.'), { once: true });
async function handleDownload(): Promise<void> {
  if (!output || pending || download.disabled) return;
  const current = generation;
  const selected = output;
  const params = { contents: [{ type: 'resource' as const, resource: { uri: 'file:///' + selected.name, mimeType: selected.mimeType, blob: selected.base64 } }] };
  if (!bounded({ jsonrpc: '2.0', id: Number.MAX_SAFE_INTEGER, method: 'ui/download-file', params })) {
    clear('Download failed: output exceeds the supported envelope limit.');
    return;
  }
  pending = true;
  download.disabled = true;
  controller = new AbortController();
  status.textContent = 'Waiting for ChatGPT to handle the download.';
  try {
    const response = await app.downloadFile(params, { timeout: DOWNLOAD_TIMEOUT, signal: controller.signal });
    if (current !== generation) return;
    status.textContent = response.isError ? 'Download failed or was denied. Choose Download file to retry explicitly.' : 'ChatGPT accepted the download. Check your downloads for the file.';
  } catch {
    if (current === generation) status.textContent = 'Download failed, timed out, or was cancelled. Choose Download file to retry explicitly.';
  } finally {
    if (current === generation) { pending = false; controller = undefined; download.disabled = !output; }
  }
}
download.addEventListener('click', () => { void handleDownload(); });
void app.connect(new PostMessageTransport(window.parent, window.parent)).catch(() => clear('Connection failed. Reconnect and run the tool again.'));

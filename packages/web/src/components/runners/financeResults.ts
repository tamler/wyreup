import { cloneUtilityJson, type JsonValue } from '@wyreup/core/execution';

export interface FinanceResultTable {
  id: string;
  label: string;
  columns: string[];
  rows: Array<Record<string, JsonValue>>;
}
export interface FinanceSource {
  title: string;
  url: string;
  checkedOn: string;
  href: string | null;
}
export interface FinanceResultView {
  summary: Array<{ label: string; value: JsonValue }>;
  tables: FinanceResultTable[];
  sources: FinanceSource[];
  limitations: string[];
}
const hosts = new Set([
  'sell.amazon.com',
  'www.etsy.com',
  'www.ebay.com',
  'www.paypal.com',
  'stripe.com',
  'squareup.com',
  'www.airbnb.com',
  'help.shopify.com',
  'support.google.com',
  'support.patreon.com',
  'help.fiverr.com',
  'support.upwork.com',
  'kdp.amazon.com',
  'seller-us.tiktok.com',
  'support.poshmark.com',
  'depophelp.zendesk.com',
  'www.mercari.com',
  'stockx.com',
  'www.twitch.tv',
  'gumroad.com',
  'www.kickstarter.com',
  'help.printify.com',
  'help.redbubble.com',
  'kb.spri.ng',
  'support.grailed.com',
  'help.reverb.com',
  'support.discogs.com',
  'www.whatnot.com',
  'help.ko-fi.com',
  'fourthwall.com',
]);
export function financeSourceHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      hosts.has(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function financeLabel(raw: string): string {
  return raw
    .replaceAll('.', ' / ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^[a-z]/, (letter) => letter.toUpperCase());
}
export function financeCell(value: JsonValue | undefined): string {
  if (value === null || value === undefined) return 'Undefined';
  if (typeof value === 'number')
    return value.toLocaleString('en-US', { maximumFractionDigits: 15 });
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return typeof value === 'string' ? value : JSON.stringify(value);
}
export function prepareFinanceResult(text: string): FinanceResultView {
  let parsed: JsonValue;
  try {
    parsed = cloneUtilityJson(JSON.parse(text));
  } catch {
    throw new Error('Finance result must be bounded valid JSON.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Finance result must be an object.');
  const view: FinanceResultView = { summary: [], tables: [], sources: [], limitations: [] };
  function table(path: string, list: JsonValue[]) {
    const rows = list.map((row) =>
      row !== null && typeof row === 'object' && !Array.isArray(row) ? row : { value: row },
    );
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    if (columns.length > 200) throw new Error('Finance table exceeds 200 readable columns.');
    view.tables.push({ id: path, label: financeLabel(path), columns, rows });
  }
  function walk(value: JsonValue, path: string) {
    if (Array.isArray(value)) {
      table(path, value);
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) walk(item, path ? `${path}.${key}` : key);
      return;
    }
    if (typeof value === 'string' && /Json$/.test(path)) {
      try {
        const decoded: unknown = JSON.parse(value);
        if (Array.isArray(decoded)) {
          const safe = cloneUtilityJson(decoded);
          table(path, safe as JsonValue[]);
          return;
        }
      } catch {
        /* Invalid row strings remain visible as literal data. */
      }
    }
    view.summary.push({
      label: financeLabel(path),
      value:
        value === null && (path === 'margin' || path === 'ROI')
          ? `Not defined (zero ${path === 'margin' ? 'revenue' : 'cost'})`
          : value,
    });
  }
  for (const [key, item] of Object.entries(parsed)) {
    if (key === 'sources' && Array.isArray(item)) {
      for (const source of item)
        if (
          source &&
          typeof source === 'object' &&
          !Array.isArray(source) &&
          typeof source.url === 'string'
        )
          view.sources.push({
            title: typeof source.title === 'string' ? source.title : 'Official source',
            url: source.url,
            checkedOn: typeof source.checkedOn === 'string' ? source.checkedOn : '',
            href: financeSourceHref(source.url),
          });
    } else if (key === 'limitations' && Array.isArray(item))
      view.limitations = item.map(financeCell);
    else walk(item, key);
  }
  return view;
}
export function financeSummaryText(view: FinanceResultView): string {
  return view.summary.map((item) => `${item.label}: ${financeCell(item.value)}`).join('\n');
}
export function financeTablePage(
  table: FinanceResultTable,
  page: number,
  size = 25,
): Array<Record<string, JsonValue>> {
  if (!Number.isInteger(page) || page < 0 || !Number.isInteger(size) || size < 1 || size > 100)
    throw new Error('Invalid finance table page.');
  return table.rows.slice(page * size, (page + 1) * size);
}

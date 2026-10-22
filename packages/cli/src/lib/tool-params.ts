import { constants, fstat } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { promisify } from 'node:util';
import {
  cloneUtilityJson,
  validateUtilityParams,
  type ParamFieldSchema,
  type ToolModule,
} from '@wyreup/core';

const MAX_BYTES = 1024 * 1024;
const descriptorStat = promisify(fstat);
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

// Literal IDs from the reviewed admission policy; schema presence alone is not strictness.
export const STRICT_TOOL_IDS = new Set(
  `
tip-calculator discount-calculator sales-tax-calculator loan-calculator mortgage-calculator
paypal-fee-calculator stripe-fee-calculator square-fee-calculator amazon-fba-profit-calculator
etsy-fee-profit-calculator ebay-fee-profit-calculator fuel-trip-cost-calculator
airbnb-host-payout-calculator shopify-profit-margin-calculator ev-charging-cost-calculator
youtube-rpm-calculator patreon-earnings-calculator fiverr-fee-calculator upwork-fee-calculator
kdp-royalty-calculator tiktok-shop-fee-calculator poshmark-fee-calculator depop-fee-calculator
mercari-profit-calculator stockx-seller-fee-calculator shopify-break-even-roas-calculator
twitch-subscription-revenue-calculator twitch-bits-to-usd-converter gumroad-fee-calculator
kickstarter-fee-calculator printify-profit-calculator redbubble-profit-calculator
teespring-profit-calculator amazon-handmade-fee-calculator grailed-fee-calculator
reverb-fee-calculator discogs-fee-calculator whatnot-seller-fee-calculator ko-fi-fee-calculator
fourthwall-profit-calculator recipe-cost-calculator bmi-calculator age-calculator
time-zone-converter random-number-generator dice-roller coin-flip calorie-calculator
gpa-calculator grade-calculator cocktail-dilution-calculator pool-volume-calculator
aquarium-volume-calculator coffee-ratio-calculator rice-water-ratio-calculator
turkey-thaw-time-calculator meat-cooking-time-calculator pizza-dough-calculator
sourdough-calculator bread-hydration-calculator cake-pan-size-converter yeast-converter
sewing-fabric-yardage-calculator shipping-dimensional-weight-calculator pallet-loading-calculator
propane-usage-calculator photography-contract-generator podcast-name-generator band-name-generator
clan-name-generator dnd-name-generator number-to-words-converter chmod-calculator utm-link-builder
css-gradient-generator px-to-rem-converter paint-calculator concrete-bag-calculator gravel-calculator
mulch-calculator roof-pitch-rafter-calculator tile-calculator-with-waste drywall-sheet-calculator
fence-material-calculator deck-material-calculator paver-calculator topsoil-calculator sod-calculator
hvac-btu-calculator insulation-calculator asphalt-driveway-calculator roofing-shingle-bundle-calculator
retaining-wall-block-calculator pond-liner-calculator french-drain-gravel-calculator
wallpaper-roll-calculator board-foot-calculator stair-stringer-calculator stud-wall-calculator
pipe-volume-calculator ramp-slope-calculator gutter-size-calculator ac-tonnage-calculator
screen-ppi-calculator ohms-law-calculator voltage-drop-calculator wire-size-calculator
battery-runtime-calculator tv-viewing-distance-calculator projector-throw-distance-calculator
generator-wattage-calculator solar-panel-output-calculator led-resistor-calculator
ups-runtime-calculator solar-battery-bank-calculator speaker-box-volume-calculator
stopwatch countdown-timer wedding-seating-chart-builder remove-duplicate-lines-online
markdown-table-generator bulk-meta-description-generator javascript-minifier robots-txt-generator
csp-header-generator hreflang-tag-generator nginx-redirect-generator code-beautifier
aspect-ratio-calculator psd-to-png csv-viewer stl-to-gcode domain-age-checker
construction-estimate-generator gamepad-tester touchscreen-dead-zone-tester word-counter
json-formatter ip-subnet-calc bank-statement-to-csv mp3-to-midi camera-shutter-count-checker
json-path date-calculator
`
    .trim()
    .split(/\s+/),
);

const CUSTOM_VALIDATOR_IDS = new Set(
  `
stopwatch countdown-timer wedding-seating-chart-builder bank-statement-to-csv mp3-to-midi
json-path date-calculator
`
    .trim()
    .split(/\s+/),
);

function objectParams(value: unknown): Record<string, unknown> {
  const cloned = cloneUtilityJson(value);
  if (cloned === null || typeof cloned !== 'object' || Array.isArray(cloned))
    throw new Error('Parameters must be a JSON object.');
  return cloned;
}

function toolDefaults(tool: ToolModule): Record<string, unknown> {
  const value = tool.defaults;
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)
  )
    throw new Error('Tool defaults must be a plain object.');
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new Error('Tool defaults require string data keys.');
    const property = Object.getOwnPropertyDescriptor(value, key)!;
    if (!property.enumerable || !('value' in property))
      throw new Error('Tool defaults require own data fields.');
    result[key] = property.value;
  }
  return result;
}

function toolSchema(tool: ToolModule): Record<string, ParamFieldSchema> {
  const supplied: Record<string, ParamFieldSchema | undefined> = tool.paramSchema ?? {};
  const schema: Record<string, ParamFieldSchema> = Object.create(null) as Record<
    string,
    ParamFieldSchema
  >;
  for (const [key, field] of Object.entries(supplied)) if (field) schema[key] = field;
  return schema;
}

function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Parameter read cancelled.', 'AbortError');
}

/** One local file, at most 1 MiB plus one byte observed, never stdin or a URL. */
export async function readToolParamsJson(
  path: string,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  cancelled(signal);
  if (!path || path === '-' || /^[a-z][a-z0-9+.-]*:\/\//i.test(path))
    throw new Error('--params-json requires a local file path.');
  const before = await lstat(path);
  if (!before.isFile()) throw new Error('--params-json requires a regular file, not a link or device.');
  cancelled(signal);
  const stdin = await descriptorStat(0).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'EBADF') return null;
    throw error;
  });
  if (stdin && before.dev === stdin.dev && before.ino === stdin.ino)
    throw new Error('--params-json cannot read the stdin file.');
  cancelled(signal);
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    cancelled(signal);
    const opened = await file.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino)
      throw new Error('--params-json requires the same regular file throughout admission.');
    const bytes = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      cancelled(signal);
      const chunk = await file.read(bytes, length, bytes.length - length, null);
      cancelled(signal);
      if (!chunk.bytesRead) break;
      length += chunk.bytesRead;
    }
    if (length > MAX_BYTES) throw new Error('Parameter file exceeds 1 MiB.');
    const body = bytes.subarray(0, length);
    if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf)
      throw new Error('Parameter file must be UTF-8 without a BOM.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    } catch {
      throw new Error('Parameter file must contain valid UTF-8 JSON.');
    }
    return objectParams(parsed);
  } finally {
    await file.close();
  }
}

function legacyCoerce(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const n = Number(value);
  return !Number.isNaN(n) && value.trim() !== '' ? n : value;
}

function jsonFlag(text: string): unknown {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES)
    throw new Error('JSON parameter exceeds 1 MiB; use a bounded --params-json file.');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Expected JSON data; use --params-json for structured parameters.');
  }
  return cloneUtilityJson(value);
}

function nullable(tool: ToolModule, key: string): boolean {
  return (
    tool.id === 'bank-statement-to-csv' && ['statementYear', 'opening', 'closing'].includes(key)
  );
}

export function parseToolFlag(
  tool: ToolModule,
  key: string,
  text: string,
  merged: Record<string, unknown>,
): unknown {
  const defaults = toolDefaults(tool);
  const field: ParamFieldSchema | undefined = toolSchema(tool)[key];
  if (STRICT_TOOL_IDS.has(tool.id) && !Object.hasOwn(defaults, key) && !field)
    throw new Error(`Unknown parameter: ${key}.`);
  if (text === 'null' && nullable(tool, key)) return null;
  if (!field) {
    // Defaults-only arrays remain reachable without inventing their item schema.
    if (Array.isArray(defaults[key])) {
      const value = jsonFlag(text);
      if (!Array.isArray(value)) throw new Error(`${key}: Expected a JSON array.`);
      return value;
    }
    return legacyCoerce(text);
  }
  switch (field.type) {
    case 'string':
      return text;
    case 'number':
    case 'range': {
      if (!DECIMAL.test(text) || !Number.isFinite(Number(text)))
        throw new Error(`${key}: Expected a complete finite decimal number.`);
      return Number(text);
    }
    case 'boolean':
      if (text !== 'true' && text !== 'false') throw new Error(`${key}: Expected true or false.`);
      return text === 'true';
    case 'enum': {
      const source = field.optionsFrom;
      const options =
        source && Object.hasOwn(source.map, String(merged[source.field]))
          ? source.map[String(merged[source.field])]!
          : field.options;
      const matches = options.filter((option) => String(option.value) === text);
      const values = new Set(matches.map((option) => option.value));
      if (values.size === 0 && !STRICT_TOOL_IDS.has(tool.id)) return legacyCoerce(text);
      if (values.size !== 1)
        throw new Error(
          `${key}: Choose an unambiguous declared value; use --params-json for typed enum values.`,
        );
      return matches[0]!.value;
    }
    case 'multi-enum':
    case 'array': {
      const value = jsonFlag(text);
      if (!Array.isArray(value)) throw new Error(`${key}: Expected a JSON array.`);
      if (field.type === 'array' && value.some((item) => typeof item !== field.itemType))
        throw new Error(`${key}: Array items must be ${field.itemType}.`);
      if (
        field.type === 'multi-enum' &&
        value.some((item) => !field.options.some((option) => option.value === item))
      )
        throw new Error(`${key}: Choose declared string values.`);
      return value;
    }
    case 'json':
      return jsonFlag(text);
  }
}

export function mergeToolParams(
  tool: ToolModule,
  json: unknown,
  orderedParams: string[],
  namedFlags: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const defaults = toolDefaults(tool);
  const schema = toolSchema(tool);
  // Undefined optional legacy defaults stay absent, retaining their existing runtime meaning.
  for (const [key, value] of Object.entries(defaults))
    if (value !== undefined) merged[key] = cloneUtilityJson(value, `$defaults.${key}`);
  const provided = objectParams(json);
  for (const [key, value] of Object.entries(provided)) merged[key] = value;
  for (const pair of orderedParams) {
    const index = pair.indexOf('=');
    if (index < 1) {
      if (STRICT_TOOL_IDS.has(tool.id)) throw new Error('--param requires key=value.');
      process.stderr.write('Warning: ignoring malformed --param (expected key=value).\n');
      continue;
    }
    const key = pair.slice(0, index).trim();
    if (!key) throw new Error('--param requires a nonempty key.');
    merged[key] = parseToolFlag(tool, key, pair.slice(index + 1), merged);
  }
  for (const [key, value] of Object.entries(namedFlags)) {
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new Error(`${key}: Named flags must contain text.`);
    merged[key] = parseToolFlag(tool, key, value, merged);
  }
  const bounded = objectParams(merged);
  if (STRICT_TOOL_IDS.has(tool.id)) {
    for (const key of Object.keys(bounded))
      if (!Object.hasOwn(defaults, key) && !Object.hasOwn(schema, key))
        throw new Error(`Unknown parameter: ${key}.`);
    if (!CUSTOM_VALIDATOR_IDS.has(tool.id)) return validateUtilityParams(defaults, schema, bounded);
  }
  return bounded;
}

const GENERATOR_HELP: Record<string, Record<string, string>> = {
  'robots-txt-generator': {
    groupsJson:
      'JSON STRING of rows {userAgent,rule,path}, max 1000; rule Allow or Disallow. Example value: [{"userAgent":"*","rule":"Disallow","path":"/private"}].',
    sitemapsJson:
      'JSON STRING of rows {url}, max 20; absolute HTTP(S) URLs. Example value: [{"url":"https://example.com/sitemap.xml"}].',
  },
  'csp-header-generator': {
    directivesJson:
      'JSON STRING of {directive,sources} rows, max 10. Directives: default-src, script-src, style-src, img-src, connect-src, font-src, frame-src, form-action, base-uri, object-src. Sources is space-separated self/none (quoted) or HTTPS origins; data:/blob: only img-src/font-src.',
  },
  'hreflang-tag-generator': {
    linksJson:
      'JSON STRING of {language,url} rows, max 1000; canonical language tags or x-default and absolute HTTP(S) URLs.',
  },
  'nginx-redirect-generator': {
    redirectsJson:
      'JSON STRING of {source,destination,status} rows, max 1000; literal slash-leading source, destination is an absolute HTTP(S) URL or a slash-leading relative path, status 301/302/307/308. Example value: [{"source":"/old","destination":"https://example.com/new","status":301}].',
  },
};

export function toolParamHelp(tool: ToolModule, key: string): string {
  const field = toolSchema(tool)[key];
  const specific = GENERATOR_HELP[tool.id]?.[key];
  if (specific)
    return `${specific} At most 100000 characters; core validates exact columns. In --params-json encode the array text once as a string, not an array.`;
  const base = [field?.label, field?.help].filter(Boolean).join('. ') || key;
  if (field?.type === 'string' && key.endsWith('Json'))
    return `${base}. ${financeRowHelp(tool, key)} Supply JSON row text as a STRING, not an array; encode once in --params-json. Core validates rows and assumptions.`;
  if (field?.type === 'json' || field?.type === 'array' || field?.type === 'multi-enum')
    return `${base}. Supply JSON data, or use --params-json (1 MiB, UTF-8, object root).`;
  return `${base}. Type: ${field?.type ?? 'legacy'}.`;
}

function financeRowHelp(tool: ToolModule, key: string): string {
  const columns =
    key === 'feeBandsJson'
      ? 'upperBound,percent (max 100 bands; final band omits upperBound; ascending positive bounds, percent 0..100)'
      : key === 'discountRatesJson'
        ? 'percent (max 100 rows, 0..100)'
        : key === 'tiersJson' && tool.id === 'patreon-earnings-calculator'
          ? 'name,members,monthlyPrice,failedMembers,taxPerMember,paymentPercent,paymentFixed'
          : key === 'tiersJson' && tool.id === 'twitch-subscription-revenue-calculator'
            ? 'name,subscriberCount,netSubscriptionPrice,creatorSharePercent'
            : key === 'primeJson'
              ? 'name,count,payoutPerSubscription'
              : key === 'itemsJson'
                ? 'name,basePriceAfterDiscount,markupPercent,quantity'
                : key === 'ingredientsJson'
                  ? 'name,packageCost,packageQuantity,usedQuantity,unit,wastePercent'
                  : '';
  return columns
    ? `Row columns: ${columns}. Up to 1000 rows unless specified; amounts use major currency units with at most currencyDecimals fractional digits, counts are whole numbers, rates are explicit assumptions.`
    : '';
}

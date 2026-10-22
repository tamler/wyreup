import {
  cloneUtilityJson,
  validateUtilityParams,
  type ParamFieldSchema,
  type ToolModule,
} from '@wyreup/core';

type Schema = Record<string, unknown>;
export interface ToolParamsPolicy {
  strict: boolean;
  sharedValidation: boolean;
}

// Literal reviewed IDs, not a blanket restriction on every legacy paramSchema.
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

export function toolParamsPolicy(tool: ToolModule): ToolParamsPolicy {
  const strict = STRICT_TOOL_IDS.has(tool.id);
  return { strict, sharedValidation: strict && !CUSTOM_VALIDATOR_IDS.has(tool.id) };
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

/** Clone before merging/reading values; getters, cycles, non-JSON and over-budget data refuse. */
export function admitToolParams(tool: ToolModule, provided: unknown): Record<string, unknown> {
  const value = cloneUtilityJson(provided);
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('params must be a JSON object.');
  const policy = toolParamsPolicy(tool);
  const defaults = toolDefaults(tool);
  const schema = toolSchema(tool);
  const merged: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, item] of Object.entries(defaults))
    if (item !== undefined) merged[key] = cloneUtilityJson(item, `$defaults.${key}`);
  for (const [key, item] of Object.entries(value)) {
    if (policy.strict && !Object.hasOwn(defaults, key) && !Object.hasOwn(schema, key))
      throw new Error(`Unknown parameter: ${key}.`);
    merged[key] = item;
  }
  const bounded = cloneUtilityJson(merged);
  if (bounded === null || typeof bounded !== 'object' || Array.isArray(bounded))
    throw new Error('params must be a JSON object.');
  if (policy.sharedValidation) return validateUtilityParams(defaults, schema, bounded);
  return bounded;
}

function defaultSchema(value: unknown): Schema {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return { type: typeof value };
  if (Array.isArray(value)) return { type: 'array', items: {} };
  // A sample object or null does not establish its permitted shape/type.
  return {};
}

function fieldSchema(
  tool: ToolModule,
  key: string,
  field: ParamFieldSchema,
  policy: ToolParamsPolicy,
): Schema {
  const description = [field.label, field.help].filter(Boolean).join('. ');
  let schema: Schema;
  switch (field.type) {
    case 'string':
      schema = { type: 'string' };
      if (policy.strict || tool.id === 'cron-from-text') {
        if (field.minLength !== undefined) schema.minLength = field.minLength;
        if (field.maxLength !== undefined) schema.maxLength = field.maxLength;
      }
      if (policy.sharedValidation) schema.maxLength = Math.min(field.maxLength ?? 100000, 100000);
      break;
    case 'number':
    case 'range': {
      schema = { type: 'number' };
      if (policy.strict || (tool.id === 'cron-from-text' && key === 'nextCount')) {
        if (field.min !== undefined) schema.minimum = field.min;
        if (field.max !== undefined) schema.maximum = field.max;
        const step = field.step ?? (field.type === 'range' ? 1 : undefined);
        // Integer step has runtime meaning in the shared validator, not every legacy UI.
        if (
          (policy.sharedValidation ||
            (tool.id === 'bank-statement-to-csv' && key === 'statementYear') ||
            (tool.id === 'mp3-to-midi' && key === 'tempo') ||
            (tool.id === 'json-path' && key === 'limit') ||
            (tool.id === 'cron-from-text' && key === 'nextCount')) &&
          step !== undefined &&
          Number.isInteger(step)
        ) {
          schema.type = 'integer';
          if (
            policy.sharedValidation &&
            step > 1 &&
            field.min !== undefined &&
            Number.isInteger(field.min) &&
            field.min % step === 0
          )
            schema.multipleOf = step;
        }
      }
      if (policy.sharedValidation) {
        schema.minimum = Math.max(field.min ?? -1e12, -1e12);
        schema.maximum = Math.min(field.max ?? 1e12, 1e12);
      }
      if (tool.id === 'lorem-ipsum') {
        schema.minimum = 1;
        schema.maximum = key === 'paragraphs' ? 1000 : 100;
      }
      break;
    }
    case 'boolean':
      schema = { type: 'boolean' };
      break;
    case 'enum': {
      const choices = [...field.options, ...Object.values(field.optionsFrom?.map ?? {}).flat()];
      schema = { enum: [...new Set(choices.map((option) => option.value))] };
      if (field.optionsFrom)
        schema.description = `Choices depend on ${field.optionsFrom.field}; the core validates the active selection.`;
      break;
    }
    case 'multi-enum':
      schema = { type: 'array', items: { enum: field.options.map((option) => option.value) } };
      if (policy.sharedValidation) Object.assign(schema, { maxItems: 1000, uniqueItems: true });
      break;
    case 'array':
      schema = { type: 'array', items: { type: field.itemType } };
      if (policy.sharedValidation) schema.maxItems = 1000;
      break;
    case 'json':
      schema = {
        description:
          'Bounded inert JSON: depth 20, 20000 scalar values, 1 MiB serialized. Core validates the exact row shape.',
      };
      if (policy.sharedValidation && toolDefaults(tool)[key] === null)
        schema.not = { type: 'null' };
      break;
  }
  if (description)
    schema.description = [description, schema.description].filter(Boolean).join('. ');
  if (field.type === 'string' && key.endsWith('Json'))
    schema.description = `${typeof schema.description === 'string' ? schema.description : ''}. ${rowStringHelp(tool.id, key)} Supply array text as a JSON STRING, not an array. Encode the array text once in params. Core enforces exact columns and limits.`;
  if (tool.id === 'bank-statement-to-csv' && ['statementYear', 'opening', 'closing'].includes(key))
    schema = {
      anyOf: [schema, { type: 'null' }],
      description: `${description}. Null means unspecified.`,
    };
  return schema;
}

function rowStringHelp(id: string, key: string): string {
  const specific: Record<string, Record<string, string>> = {
    'robots-txt-generator': {
      groupsJson:
        'Rows {userAgent,rule,path}, max 1000. Rule Allow or Disallow; supported slash-leading paths. Example string contents: [{"userAgent":"*","rule":"Disallow","path":"/private"}].',
      sitemapsJson: 'Rows {url}, max 20; absolute HTTP(S) sitemap URLs.',
    },
    'csp-header-generator': {
      directivesJson:
        'Rows {directive,sources}, max 10. Supported directives: default-src,script-src,style-src,img-src,connect-src,font-src,frame-src,form-action,base-uri,object-src. Sources: space-separated quoted self/none or HTTPS origins; data:/blob: only images/fonts.',
    },
    'hreflang-tag-generator': {
      linksJson:
        'Rows {language,url}, max 1000; canonical language tags or x-default, absolute HTTP(S) URLs.',
    },
    'nginx-redirect-generator': {
      redirectsJson:
        'Rows {source,destination,status}, max 1000. Literal slash-leading source, destination is an absolute HTTP(S) URL or a slash-leading relative path, status 301/302/307/308. Example string contents: [{"source":"/old","destination":"https://example.com/new","status":301}].',
    },
  };
  if (specific[id]?.[key]) return specific[id][key];
  const columns =
    key === 'feeBandsJson'
      ? 'upperBound,percent; max 100 bands, final band omits upperBound, ascending positive bounds, percent 0..100'
      : key === 'discountRatesJson'
        ? 'percent; max 100 rows, 0..100'
        : key === 'tiersJson' && id === 'patreon-earnings-calculator'
          ? 'name,members,monthlyPrice,failedMembers,taxPerMember,paymentPercent,paymentFixed'
          : key === 'tiersJson' && id === 'twitch-subscription-revenue-calculator'
            ? 'name,subscriberCount,netSubscriptionPrice,creatorSharePercent'
            : key === 'primeJson'
              ? 'name,count,payoutPerSubscription'
              : key === 'itemsJson'
                ? 'name,basePriceAfterDiscount,markupPercent,quantity'
                : key === 'ingredientsJson'
                  ? 'name,packageCost,packageQuantity,usedQuantity,unit,wastePercent'
                  : '';
  return columns
    ? `Columns: ${columns}. Max 1000 rows unless specified; amounts use major currency units with at most currencyDecimals fractional digits, counts are integers, rates are user assumptions.`
    : '';
}

function condition(tool: ToolModule, field: ParamFieldSchema): Schema {
  const when = field.showWhen!;
  const values = Object.hasOwn(when, 'equals') ? [when.equals] : (when.in ?? []);
  const present = { properties: { [when.field]: { enum: values } }, required: [when.field] };
  return values.some((value) => value === toolDefaults(tool)[when.field])
    ? { anyOf: [present, { not: { required: [when.field] } }] }
    : present;
}

export function projectToolParamsSchema(tool: ToolModule, policy = toolParamsPolicy(tool)): Schema {
  const properties: Record<string, Schema> = Object.create(null) as Record<string, Schema>;
  const allOf: Schema[] = [];
  const required: string[] = [];
  const defaults = toolDefaults(tool);
  for (const [key, value] of Object.entries(defaults)) properties[key] = defaultSchema(value);
  for (const [key, field] of Object.entries(toolSchema(tool))) {
    if (!field) continue;
    const projected = fieldSchema(tool, key, field, policy);
    const needsValue = policy.sharedValidation && defaults[key] === null;
    if (field.showWhen) {
      properties[key] = {
        description: policy.sharedValidation
          ? `Active only when ${field.showWhen.field} matches its declared condition; inactive values are ignored by core.`
          : `Shown when ${field.showWhen.field} matches its declared condition; core may still validate values in other modes.`,
      };
      allOf.push({
        if: condition(tool, field),
        then: { properties: { [key]: projected }, ...(needsValue ? { required: [key] } : {}) },
      });
    } else {
      properties[key] = projected;
      if (needsValue) required.push(key);
    }
  }
  return {
    type: 'object',
    properties,
    additionalProperties: !policy.strict,
    description:
      'Tool parameters merged over defaults. Bounded inert JSON; core enforces mode-dependent choices, row contracts and calculations. JSON row strings remain strings, not arrays.',
    ...(required.length ? { required } : {}),
    ...(allOf.length ? { allOf } : {}),
  };
}

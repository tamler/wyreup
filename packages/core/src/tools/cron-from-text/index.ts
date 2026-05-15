import type { ToolModule, ToolRunContext } from '../../types.js';

export interface CronFromTextParams {
  /** Natural-language schedule description. Required. */
  description?: string;
}

export const defaultCronFromTextParams: CronFromTextParams = {
  description: '',
};

export interface CronFromTextResult {
  description: string;
  cron: string;
  explanation: string;
  confidence: 'high' | 'medium' | 'low' | 'no-match';
  fields: {
    minute: string;
    hour: string;
    dayOfMonth: string;
    month: string;
    dayOfWeek: string;
  };
  matchedTokens: string[];
  upgrade?: string;
}

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Time { hour: number; minute: number }

/** Extract a HH:MM 24h, HH:MM 12h with am/pm, "midnight", "noon", or bare hour with am/pm. */
function parseTime(lower: string): Time | null {
  if (/\bmidnight\b/.test(lower)) return { hour: 0, minute: 0 };
  if (/\bnoon\b/.test(lower)) return { hour: 12, minute: 0 };

  // Match HH:MM or H:MM, optional am/pm.
  const m = lower.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/);
  if (m) {
    let h = parseInt(m[1]!, 10);
    const mm = parseInt(m[2]!, 10);
    const period = m[3];
    if (period === 'pm' && h < 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && mm >= 0 && mm <= 59) return { hour: h, minute: mm };
  }

  // Bare-hour with am/pm: "9am", "9 pm", "11 PM"
  const m2 = lower.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (m2) {
    let h = parseInt(m2[1]!, 10);
    const period = m2[2]!;
    if (period === 'pm' && h < 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23) return { hour: h, minute: 0 };
  }

  return null;
}

function parseDaysOfWeek(lower: string): { values: number[]; label: string } | null {
  if (/\bweekdays?\b/.test(lower) || /\bweekday\b/.test(lower)) {
    return { values: [1, 2, 3, 4, 5], label: 'weekdays' };
  }
  if (/\bweekends?\b/.test(lower)) {
    return { values: [0, 6], label: 'weekends' };
  }
  const matched: { day: number; name: string }[] = [];
  for (const [name, day] of Object.entries(DAY_NAMES)) {
    // Whole-word match so "fri" doesn't match "friend".
    const re = new RegExp(`\\b${name}s?\\b`);
    if (re.test(lower) && !matched.some((m) => m.day === day)) {
      matched.push({ day, name });
    }
  }
  if (matched.length === 0) return null;
  matched.sort((a, b) => a.day - b.day);
  const label = matched.map((m) => DAY_LABELS[m.day]).join(', ');
  return { values: matched.map((m) => m.day), label };
}

function parseDayOfMonth(lower: string): { value: number | 'L'; label: string } | null {
  if (/\blast day of (the )?month\b|\bend of (the )?month\b/.test(lower)) {
    return { value: 'L', label: 'last day of the month' };
  }
  const m = lower.match(/\b(first|last|1st|2nd|3rd|\d{1,2}(?:th|st|nd|rd)?)\b(?:\s+of\s+(?:the\s+)?month)?/);
  if (m && /of\s+(the\s+)?month/.test(lower)) {
    const word = m[1]!;
    if (word === 'first' || word === '1st') return { value: 1, label: '1st of the month' };
    if (word === 'last') return { value: 'L', label: 'last day of the month' };
    const n = parseInt(word, 10);
    if (n >= 1 && n <= 31) return { value: n, label: `day ${n} of the month` };
  }
  return null;
}

function parseEvery(lower: string): { unit: 'minute' | 'hour' | 'day' | 'week' | 'month'; n: number } | null {
  // "every X minutes/hours/days/weeks/months" or "every minute/hour/day"
  const m = lower.match(/\bevery\s+(\d+)\s+(minutes?|hours?|days?|weeks?|months?)\b/);
  if (m) {
    const n = parseInt(m[1]!, 10);
    const unit = m[2]!.replace(/s$/, '') as 'minute' | 'hour' | 'day' | 'week' | 'month';
    if (n > 0) return { unit, n };
  }
  const m2 = lower.match(/\bevery\s+(minute|hour|day|week|month)\b/);
  if (m2) return { unit: m2[1] as 'minute' | 'hour' | 'day' | 'week' | 'month', n: 1 };
  return null;
}

function formatTime(t: Time): string {
  const period = t.hour < 12 ? 'AM' : 'PM';
  const h12 = t.hour === 0 ? 12 : t.hour > 12 ? t.hour - 12 : t.hour;
  const mm = String(t.minute).padStart(2, '0');
  return `${h12}:${mm} ${period}`;
}

export function generateCronFromText(description: string): CronFromTextResult {
  const desc = (description ?? '').trim();
  if (!desc) {
    throw new Error('cron-from-text requires a non-empty "description" parameter.');
  }
  const lower = desc.toLowerCase();
  const tokens: string[] = [];

  const time = parseTime(lower);
  if (time) tokens.push(`time ${formatTime(time)}`);
  const dows = parseDaysOfWeek(lower);
  if (dows) tokens.push(`day-of-week ${dows.label}`);
  const dom = parseDayOfMonth(lower);
  if (dom) tokens.push(`day-of-month ${dom.label}`);
  const every = parseEvery(lower);
  if (every) tokens.push(`interval every ${every.n} ${every.unit}${every.n > 1 ? 's' : ''}`);

  // Build cron fields. Default: every minute (* * * * *).
  let minute = '*';
  let hour = '*';
  let dayOfMonth = '*';
  const month = '*';
  let dayOfWeek = '*';
  const parts: string[] = [];

  if (every) {
    if (every.unit === 'minute') {
      minute = every.n === 1 ? '*' : `*/${every.n}`;
      parts.push(every.n === 1 ? 'every minute' : `every ${every.n} minutes`);
    } else if (every.unit === 'hour') {
      minute = '0';
      hour = every.n === 1 ? '*' : `*/${every.n}`;
      parts.push(every.n === 1 ? 'every hour' : `every ${every.n} hours`);
    } else if (every.unit === 'day') {
      minute = '0';
      hour = '0';
      dayOfMonth = every.n === 1 ? '*' : `*/${every.n}`;
      parts.push(every.n === 1 ? 'every day' : `every ${every.n} days`);
    } else if (every.unit === 'week') {
      minute = '0';
      hour = '0';
      dayOfWeek = '0';
      parts.push('every week (Sunday)');
    } else if (every.unit === 'month') {
      minute = '0';
      hour = '0';
      dayOfMonth = '1';
      parts.push('every month (1st)');
    }
  }

  if (time) {
    minute = String(time.minute);
    hour = String(time.hour);
    parts.length = 0; // time overrides the "every hour" default minute=0
    parts.push(`at ${formatTime(time)}`);
  }

  if (dows) {
    dayOfWeek = dows.values.join(',');
    parts.push(`on ${dows.label}`);
  }

  if (dom) {
    dayOfMonth = dom.value === 'L' ? 'L' : String(dom.value);
    parts.push(`on the ${dom.label}`);
  }

  // If nothing matched, return no-match.
  if (!time && !dows && !dom && !every) {
    return {
      description: desc,
      cron: '',
      explanation:
        'No matching schedule heuristic. The free engine knows "every N minutes/hours/days", ' +
        'specific times (HH:MM, "midnight", "noon", "9am"), days of week (monday, weekdays, weekends), ' +
        'and days of month ("1st", "last day"). For arbitrary phrasings, the Pro AI variant covers open-ended cases.',
      confidence: 'no-match',
      fields: { minute: '', hour: '', dayOfMonth: '', month: '', dayOfWeek: '' },
      matchedTokens: [],
      upgrade: 'Pro: AI-generated cron for arbitrary schedule descriptions.',
    };
  }

  const cron = `${minute} ${hour} ${dayOfMonth} ${month} ${dayOfWeek}`;

  // Confidence — every time + dow combination is high; bare interval-only is medium.
  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (every && !time && !dows && !dom) confidence = 'medium';

  return {
    description: desc,
    cron,
    explanation: parts.join(', '),
    confidence,
    fields: { minute, hour, dayOfMonth, month, dayOfWeek },
    matchedTokens: tokens,
  };
}

export const cronFromText: ToolModule<CronFromTextParams> = {
  id: 'cron-from-text',
  slug: 'cron-from-text',
  name: 'Cron From Text',
  description:
    'Generate a cron expression from a natural-language schedule. "Every Monday at 9am", "first of the month at midnight", "every 5 minutes", "weekdays at 8:30am". Chains after toolbelt rule scheduling.',
  llmDescription:
    'Convert a plain-English schedule like "every weekday at 9am" or "every 5 minutes" into a 5-field cron expression (minute hour day-of-month month day-of-week). Returns JSON with cron, explanation, fields breakdown, and confidence. For unparseable phrasings, returns confidence: "no-match" — call the AI variant or revise.',
  category: 'inspect',
  keywords: ['cron', 'schedule', 'crontab', 'natural language', 'from text', 'generate'],

  input: {
    accept: ['text/plain'],
    min: 0,
    max: 1,
    sizeLimit: 4 * 1024,
  },
  output: { mime: 'application/json' },

  interactive: true,
  batchable: true,
  cost: 'free',
  memoryEstimate: 'low',

  defaults: defaultCronFromTextParams,

  paramSchema: {
    description: {
      type: 'string',
      label: 'description',
      help: 'Plain English: "every monday at 9am", "first of the month at midnight", "every 15 minutes", "weekdays at 8:30am".',
      placeholder: 'every weekday at 9am',
      multiline: true,
    },
  },

  async run(inputs: File[], params: CronFromTextParams, ctx: ToolRunContext): Promise<Blob[]> {
    let description = params.description ?? '';
    if (!description.trim() && inputs.length === 1) {
      description = (await inputs[0]!.text()).trim();
    }
    ctx.onProgress({ stage: 'processing', percent: 50, message: 'Parsing schedule' });
    const result = generateCronFromText(description);
    ctx.onProgress({ stage: 'done', percent: 100, message: 'Done' });
    return [new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })];
  },

  __testFixtures: {
    valid: [],
    weird: [],
    expectedOutputMime: ['application/json'],
  },
};

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
  warning?: string;
}

const DAY_NAMES: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function weekdayPattern(name: string): string {
  // Plurals apply to full names; abbreviation "thu" must not consume "thus".
  return `\\b${name}${name.endsWith('day') ? 's?' : ''}\\b`;
}

const TIME_PATTERN = /\b(?:midnight|noon|\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm))\b/g;
const MONTH_END_PATTERN = /\blast day of (?:the )?month\b|\bend of (?:the )?month\b/g;
const MONTH_DAY_PATTERN =
  /\b(first|last|1st|2nd|3rd|\d{1,2}(?:th|st|nd|rd)?)\s+of\s+(?:the\s+)?month\b/g;
const INTERVAL_PATTERN = /\bevery\s+(?:\d+\s+)?(?:minutes?|hours?|days?|weeks?|months?)\b/g;

interface Time {
  hour: number;
  minute: number;
}

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
    if (period && (h < 1 || h > 12)) return null;
    if (period === 'pm' && h < 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23 && mm >= 0 && mm <= 59) return { hour: h, minute: mm };
  }

  // Bare-hour with am/pm: "9am", "9 pm", "11 PM"
  const m2 = lower.match(/\b(\d{1,2})\s*(am|pm)\b/);
  if (m2) {
    let h = parseInt(m2[1]!, 10);
    const period = m2[2]!;
    if (h < 1 || h > 12) return null;
    if (period === 'pm' && h < 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    if (h >= 0 && h <= 23) return { hour: h, minute: 0 };
  }

  return null;
}

function parseDaysOfWeek(lower: string): { values: number[]; label: string } | null {
  const matched: { day: number; name: string }[] = [];
  const labels: string[] = [];
  if (/\bweekdays?\b/.test(lower)) {
    matched.push(...[1, 2, 3, 4, 5].map((day) => ({ day, name: DAY_LABELS[day]! })));
    labels.push('weekdays');
  }
  if (/\bweekends?\b/.test(lower)) {
    for (const day of [0, 6])
      if (!matched.some((entry) => entry.day === day))
        matched.push({ day, name: DAY_LABELS[day]! });
    labels.push('weekends');
  }
  for (const [name, day] of Object.entries(DAY_NAMES)) {
    // Whole-word match so "fri" doesn't match "friend".
    const re = new RegExp(weekdayPattern(name));
    if (re.test(lower) && !matched.some((m) => m.day === day)) {
      matched.push({ day, name });
      labels.push(DAY_LABELS[day]!);
    }
  }
  if (matched.length === 0) return null;
  matched.sort((a, b) => a.day - b.day);
  const label = labels.join(', ');
  return { values: matched.map((m) => m.day), label };
}

function parseDayOfMonth(lower: string): { value: number | 'L'; label: string } | null {
  if (new RegExp(MONTH_END_PATTERN.source).test(lower)) {
    return { value: 'L', label: 'last day of the month' };
  }
  const m = new RegExp(MONTH_DAY_PATTERN.source).exec(lower);
  if (m && /of\s+(the\s+)?month/.test(lower)) {
    const word = m[1]!;
    if (word === 'first' || word === '1st') return { value: 1, label: '1st of the month' };
    if (word === 'last') return { value: 'L', label: 'last day of the month' };
    const n = parseInt(word, 10);
    const suffix = /(?:st|nd|rd|th)$/.exec(word)?.[0];
    const expectedSuffix =
      n % 100 >= 11 && n % 100 <= 13
        ? 'th'
        : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
    if (suffix && suffix !== expectedSuffix) return null;
    if (n >= 1 && n <= 31) return { value: n, label: `day ${n} of the month` };
  }
  return null;
}

function parseEvery(
  lower: string,
): { unit: 'minute' | 'hour' | 'day' | 'week' | 'month'; n: number } | null {
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
  if (typeof description !== 'string' || new TextEncoder().encode(description).length > 4096)
    throw new Error('Description must be text within 4 KiB');
  const desc = (description ?? '').trim();
  if (!desc) {
    throw new Error('cron-from-text requires a non-empty "description" parameter.');
  }
  // Remove framing only at the original description's end, before replacing spans.
  const lower = desc.toLowerCase().replace(/\.$/, '');
  const tokens: string[] = [];
  const noMatch = (): CronFromTextResult => ({
    description: desc,
    cron: '',
    explanation:
      'No matching unambiguous schedule heuristic. Use one time, supported calendar intervals and one day restriction, or enter structured fields. Calendar steps reset at field boundaries.',
    confidence: 'no-match',
    fields: { minute: '', hour: '', dayOfMonth: '', month: '', dayOfWeek: '' },
    matchedTokens: [],
    upgrade: 'Pro: AI-generated cron for arbitrary schedule descriptions.',
  });

  const time = parseTime(lower);
  if (time) tokens.push(`time ${formatTime(time)}`);
  const dows = parseDaysOfWeek(lower);
  if (dows) tokens.push(`day-of-week ${dows.label}`);
  const dom = parseDayOfMonth(lower);
  if (dom) tokens.push(`day-of-month ${dom.label}`);
  const every = parseEvery(lower);
  if (every) tokens.push(`interval every ${every.n} ${every.unit}${every.n > 1 ? 's' : ''}`);
  const timePhrases = [...lower.matchAll(TIME_PATTERN)];
  const intervalPhrases = [...lower.matchAll(INTERVAL_PATTERN)];
  const monthPhrase = /\bof\s+(?:the\s+)?month\b/.test(lower);
  const monthPhraseCount = [...lower.matchAll(/\bof\s+(?:the\s+)?month\b/g)].length;
  const ordinalPhrases = [...lower.matchAll(/\b(?:first|last|\d+(?:st|nd|rd|th))\b/g)];
  const numericClocks = [...lower.matchAll(/\bat\s+(\d[\d:]*(?:\s*(?:am|pm))?)/g)];
  const unsupportedClock = numericClocks.some(
    ([, clock]) =>
      !/^(?:\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,2}\s*(?:am|pm))$/.test(clock!) ||
      !parseTime(clock!),
  );
  if (
    unsupportedClock ||
    /\bo'clock\b/.test(lower) ||
    (ordinalPhrases.length > 0 && !dom) ||
    timePhrases.length > 1 ||
    (timePhrases.length && !time) ||
    intervalPhrases.length > 1 ||
    (intervalPhrases.length && !every) ||
    (monthPhrase && (!dom || ordinalPhrases.length > 1 || monthPhraseCount > 1)) ||
    (dom && dows) ||
    (every && dom) ||
    (every?.unit === 'day' && every.n > 1 && dows) ||
    (every?.unit === 'month' && dows) ||
    (every && time && (every.unit === 'minute' || every.unit === 'hour')) ||
    (every &&
      (!Number.isSafeInteger(every.n) ||
        every.n > { minute: 59, hour: 23, day: 31, week: 1, month: 1 }[every.unit]))
  )
    return noMatch();

  if (every && dows) {
    let restriction = lower.replace(/^run\s+/, '').trim();
    if (restriction.startsWith(',') || restriction.endsWith(',')) return noMatch();
    let framingCommas = 0;
    const removeClause = (pattern: string) => {
      restriction = restriction.replace(
        new RegExp(`(?:,\\s*)?${pattern}(?:\\s*,)?`, 'g'),
        (clause) => {
          framingCommas += clause.match(/,/g)?.length ?? 0;
          return ' ';
        },
      );
    };
    removeClause(INTERVAL_PATTERN.source);
    if (time) removeClause(`(?:\\bat\\s+)?${TIME_PATTERN.source}`);
    const day = `(?:${Object.keys(DAY_NAMES)
      .map((name) => `${name}${name.endsWith('day') ? 's?' : ''}`)
      .join('|')}|weekdays?|weekends?)`;
    const completeRestriction = new RegExp(
      `^on\\s+(?:the\\s+)?${day}(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+)${day})*$`,
    );
    if (framingCommas > 1 || !completeRestriction.test(restriction.trim())) return noMatch();
  }

  // Accept only complete supported phrases. Retain every unrecognised word,
  // digit and operator rather than emitting the recognised subset of a schedule.
  let remaining = lower;
  if (dom) remaining = remaining.replace(MONTH_END_PATTERN, ' ').replace(MONTH_DAY_PATTERN, ' ');
  if (every) remaining = remaining.replace(INTERVAL_PATTERN, ' ');
  if (time) remaining = remaining.replace(TIME_PATTERN, ' ');
  if (dows) {
    remaining = remaining.replace(/\b(?:weekdays?|weekends?)\b/g, ' ');
    for (const name of Object.keys(DAY_NAMES))
      remaining = remaining.replace(new RegExp(weekdayPattern(name), 'g'), ' ');
  }
  remaining = remaining.replace(/\b(?:on|at|the|every|and|run)\b/g, ' ').replace(/,/g, ' ');
  remaining = remaining.trim();
  if (remaining) return noMatch();

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
      parts.push(dows ? 'every week' : 'every week (Sunday)');
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
    return noMatch();
  }

  const cron = `${minute} ${hour} ${dayOfMonth} ${month} ${dayOfWeek}`;

  // Confidence — every time + dow combination is high; bare interval-only is medium.
  let confidence: 'high' | 'medium' | 'low' = 'high';
  if (every && !time && !dows && !dom) confidence = 'medium';
  if (!every && !time && (dows || dom)) {
    confidence = 'medium';
    parts.unshift('every minute');
  }
  const resets =
    every &&
    every.n > 1 &&
    (every.unit === 'day' ||
      (every.unit === 'minute' && 60 % every.n !== 0) ||
      (every.unit === 'hour' && 24 % every.n !== 0));

  return {
    description: desc,
    cron,
    explanation: parts.join(', '),
    confidence,
    fields: { minute, hour, dayOfMonth, month, dayOfWeek },
    matchedTokens: tokens,
    ...(resets
      ? {
          warning:
            'Calendar field steps reset at hour, day or month boundaries; this is not a constant elapsed interval.',
        }
      : {}),
  };
}


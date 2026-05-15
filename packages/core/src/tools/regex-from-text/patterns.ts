/**
 * Knowledge base for the heuristic regex-from-text engine. Each entry maps a
 * set of natural-language phrases to a regex pattern.
 *
 * Phrases are matched as substrings against the lowercased description.
 * Longer phrases win on ties (more specific intent). When the user's request
 * cannot be matched here, the tool falls back to a low-confidence guess
 * — and the Pro variant (when gated) hands off to a hosted LLM.
 */

export interface PatternEntry {
  /** Natural-language phrases that should fire this entry. Longest wins. */
  keywords: string[];
  /** Regex body (no slashes, no flags). */
  pattern: string;
  /** Human explanation, shown in the UI and chained MCP output. */
  explanation: string;
  /** Heuristic confidence — high = nailed it; medium = likely; low = guess. */
  confidence: 'high' | 'medium' | 'low';
  /** Default flags. Caller may override. */
  defaultFlags?: string;
}

export const PATTERNS: PatternEntry[] = [
  {
    keywords: ['email address', 'email', 'e-mail'],
    pattern: '[\\w.+-]+@[\\w-]+\\.[\\w.-]+',
    explanation: 'Email addresses',
    confidence: 'high',
  },
  {
    keywords: ['url', 'link', 'http', 'https', 'website', 'web address'],
    pattern: 'https?://[^\\s]+',
    explanation: 'HTTP/HTTPS URLs',
    confidence: 'high',
  },
  {
    keywords: ['phone number', 'phone', 'telephone'],
    pattern: '\\(?\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]?\\d{4}',
    explanation: 'US phone numbers (with or without area code parens)',
    confidence: 'high',
  },
  {
    keywords: ['ipv6'],
    pattern: '(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}',
    explanation: 'Full IPv6 addresses (8 groups, no compression)',
    confidence: 'medium',
  },
  {
    keywords: ['ip address', 'ipv4', 'ip'],
    pattern: '\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b',
    explanation: 'IPv4 addresses (does not range-check octets)',
    confidence: 'high',
  },
  {
    keywords: ['iso date', 'yyyy-mm-dd'],
    pattern: '\\d{4}-\\d{2}-\\d{2}',
    explanation: 'ISO dates (YYYY-MM-DD)',
    confidence: 'high',
  },
  {
    keywords: ['us date', 'mm/dd/yyyy', 'mm-dd-yyyy'],
    pattern: '\\d{1,2}[\\/-]\\d{1,2}[\\/-]\\d{2,4}',
    explanation: 'US-style dates (MM/DD/YYYY)',
    confidence: 'high',
  },
  {
    keywords: ['date'],
    pattern: '\\d{4}-\\d{2}-\\d{2}',
    explanation: 'ISO dates (YYYY-MM-DD) — default interpretation of "date"',
    confidence: 'medium',
  },
  {
    keywords: ['timestamp', 'iso timestamp', 'iso 8601'],
    pattern: '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:?\\d{2})?',
    explanation: 'ISO 8601 timestamps',
    confidence: 'high',
  },
  {
    keywords: ['time', 'clock time', 'hh:mm'],
    pattern: '\\d{1,2}:\\d{2}(?::\\d{2})?',
    explanation: 'Times (HH:MM or HH:MM:SS)',
    confidence: 'high',
  },
  {
    keywords: ['hex color', 'color code', 'color hex'],
    pattern: '#[0-9a-fA-F]{3,8}\\b',
    explanation: 'Hex color codes (#RGB / #RRGGBB / #RRGGBBAA)',
    confidence: 'high',
  },
  {
    keywords: ['uuid', 'guid'],
    pattern: '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
    explanation: 'UUIDs (any version, hex)',
    confidence: 'high',
    defaultFlags: 'gi',
  },
  {
    keywords: ['credit card', 'card number'],
    pattern: '\\b\\d{4}[-\\s]?\\d{4}[-\\s]?\\d{4}[-\\s]?\\d{4}\\b',
    explanation: 'Credit card numbers (16 digits with optional separators)',
    confidence: 'high',
  },
  {
    keywords: ['ssn', 'social security'],
    pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b',
    explanation: 'US Social Security Numbers',
    confidence: 'high',
  },
  {
    keywords: ['zip code', 'postal code', 'us zip'],
    pattern: '\\b\\d{5}(?:-\\d{4})?\\b',
    explanation: 'US ZIP codes (5 or 9 digits)',
    confidence: 'high',
  },
  {
    keywords: ['hashtag'],
    pattern: '#\\w+',
    explanation: 'Hashtags',
    confidence: 'high',
  },
  {
    keywords: ['mention', '@mention', 'twitter mention', 'username mention'],
    pattern: '@\\w+',
    explanation: 'Username mentions (@handle)',
    confidence: 'high',
  },
  {
    keywords: ['markdown link'],
    pattern: '\\[([^\\]]+)\\]\\(([^)]+)\\)',
    explanation: 'Markdown links [text](url)',
    confidence: 'high',
  },
  {
    keywords: ['markdown image'],
    pattern: '!\\[([^\\]]*)\\]\\(([^)]+)\\)',
    explanation: 'Markdown images ![alt](url)',
    confidence: 'high',
  },
  {
    keywords: ['html tag', 'xml tag', 'tag'],
    pattern: '<\\/?[\\w-]+(?:\\s+[^>]*)?>',
    explanation: 'HTML/XML tags',
    confidence: 'high',
  },
  {
    keywords: ['semver', 'semantic version', 'version number', 'version'],
    pattern: '\\b\\d+\\.\\d+\\.\\d+(?:-[\\w.]+)?(?:\\+[\\w.]+)?\\b',
    explanation: 'Semantic version numbers',
    confidence: 'high',
  },
  {
    keywords: ['dollar', 'usd', 'price', 'money'],
    pattern: '\\$\\d{1,3}(?:,\\d{3})*(?:\\.\\d{2})?',
    explanation: 'US dollar amounts',
    confidence: 'high',
  },
  {
    keywords: ['percent', 'percentage'],
    pattern: '\\d+(?:\\.\\d+)?%',
    explanation: 'Percentages',
    confidence: 'high',
  },
  {
    keywords: ['unix timestamp', 'epoch', 'epoch time'],
    pattern: '\\b\\d{10}\\b',
    explanation: 'Unix timestamps (10-digit seconds)',
    confidence: 'medium',
  },
  {
    keywords: ['integer', 'whole number', 'digit', 'number', 'numeric'],
    pattern: '\\d+',
    explanation: 'Digit sequences',
    confidence: 'medium',
  },
  {
    keywords: ['decimal', 'float', 'floating point'],
    pattern: '\\d+\\.\\d+',
    explanation: 'Decimal numbers',
    confidence: 'high',
  },
  {
    keywords: ['signed number', 'positive or negative'],
    pattern: '-?\\d+(?:\\.\\d+)?',
    explanation: 'Signed numbers (positive, negative, integer, decimal)',
    confidence: 'high',
  },
  {
    keywords: ['whitespace', 'blank space', 'spaces'],
    pattern: '\\s+',
    explanation: 'Whitespace runs',
    confidence: 'high',
  },
  {
    keywords: ['word'],
    pattern: '\\b\\w+\\b',
    explanation: 'Words (alphanumeric runs bounded by word boundaries)',
    confidence: 'medium',
  },
  {
    keywords: ['blank line', 'empty line'],
    pattern: '^\\s*$',
    explanation: 'Blank lines',
    confidence: 'high',
    defaultFlags: 'gm',
  },
  {
    keywords: ['comment', 'js comment', 'c comment'],
    pattern: '//.*$|/\\*[\\s\\S]*?\\*/',
    explanation: 'JS/C-style comments (// line or /* block */)',
    confidence: 'medium',
    defaultFlags: 'gm',
  },
  {
    keywords: ['python comment'],
    pattern: '#.*$',
    explanation: 'Python-style line comments',
    confidence: 'high',
    defaultFlags: 'gm',
  },
  {
    keywords: ['html comment'],
    pattern: '<!--[\\s\\S]*?-->',
    explanation: 'HTML comments',
    confidence: 'high',
  },
  {
    keywords: ['file path', 'unix path', 'absolute path'],
    pattern: '/[\\w./-]+',
    explanation: 'Unix-style absolute file paths',
    confidence: 'medium',
  },
  {
    keywords: ['windows path'],
    pattern: '[A-Za-z]:\\\\[^\\s]+',
    explanation: 'Windows-style absolute file paths (drive letter)',
    confidence: 'medium',
  },
  {
    keywords: ['emoji'],
    pattern: '\\p{Extended_Pictographic}',
    explanation: 'Emoji characters (uses Unicode property; requires /u flag)',
    confidence: 'medium',
    defaultFlags: 'gu',
  },
];

/**
 * Flag modifier phrases. Detected separately from the pattern lookup so the
 * user can write "match emails case insensitive" and we mix correctly.
 */
export const FLAG_MODIFIERS: ReadonlyArray<{ phrases: string[]; add?: string; remove?: string }> = [
  { phrases: ['case insensitive', 'case-insensitive', 'ignore case', 'ignoring case'], add: 'i' },
  { phrases: ['case sensitive', 'case-sensitive'], remove: 'i' },
  { phrases: ['multiline', 'multi-line', 'multiple lines'], add: 'm' },
  { phrases: ['single line', 'dotall', 'dot matches newline'], add: 's' },
  { phrases: ['unicode', 'unicode aware'], add: 'u' },
  { phrases: ['first match only', 'just one match', 'first occurrence'], remove: 'g' },
  { phrases: ['all matches', 'every occurrence', 'every match', 'global'], add: 'g' },
];

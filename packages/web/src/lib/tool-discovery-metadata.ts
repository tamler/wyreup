import type { ParamFieldSchema, ToolModule, ToolSeoContent } from '@wyreup/core';
import { SEO_CONTENT } from './seo-content';
import { TOOL_PAGE_METADATA } from './seo';
import { correctedToolSeoContent } from './search-guides';

export interface ToolDiscoveryMetadata {
  title: string;
  heading: string;
  description: string;
  keywords: string[];
  seoContent?: ToolSeoContent;
  inputLabel: string;
  outputLabel: string;
  networkAccess?: 'domain-registration';
}

const CONTENT_OVERRIDES: Record<string, ToolSeoContent> = {
  'domain-age-checker': {
    alsoTry: [{ id: 'url-parse', why: 'Inspect the components of a URL locally.' }],
    faq: [
      { q: 'What leaves my device?', a: 'The domain you enter is sent to Wyreup and its public RDAP registration registry. No account or API key is required.' },
      { q: 'Is registration age the first time a domain was used?', a: 'No. The current public registration date can differ from first-ever use, especially after expiry or re-registration. Missing registration data is reported as unavailable.' },
      { q: 'Does the lookup work offline?', a: 'No. This lookup requires a network connection. Retry explicitly when your connection returns.' },
    ],
  },
  'face-blur': {
    faq: [
      { q: 'Where does face detection run?', a: 'Detection runs on your device. Its model and runtime download when needed; the photo is not uploaded by this tool.' },
      { q: 'How should I review the result?', a: 'Inspect every person and the whole image at full size. Detection can miss small, obscured or turned-away faces. Blur does not guarantee anonymity.' },
    ],
  },
};

function mergeContent(base: ToolSeoContent, next: ToolSeoContent | undefined): ToolSeoContent {
  return {
    intro: next?.intro ?? base.intro,
    useCases: next?.useCases ?? base.useCases,
    faq: next?.faq ?? base.faq,
    alsoTry: next?.alsoTry ?? base.alsoTry,
  };
}

function fieldHelp(name: string, field: ParamFieldSchema): string {
  const label = field.label ?? name;
  const details: string[] = [];
  if (field.type === 'number' || field.type === 'range') {
    if (field.unit) details.push(`unit: ${field.unit}`);
    if (field.min !== undefined) details.push(`minimum ${field.min}`);
    if (field.max !== undefined) details.push(`maximum ${field.max}`);
  } else if (field.type === 'enum') {
    details.push(field.options.map((option) => option.label).join(', '));
  } else if (field.type === 'string') {
    if (field.maxLength !== undefined) details.push(`maximum ${field.maxLength} characters`);
  } else if (field.type === 'array') {
    details.push(`list of ${field.itemType} values`);
  } else if (field.type === 'json') {
    details.push('structured JSON');
  }
  if (field.showWhen) details.push(`shown for the selected ${field.showWhen.field} mode`);
  return `${label}${details.length ? ` (${details.join('; ')})` : ''}${field.help ? `: ${field.help}` : ''}`;
}

export function projectToolDiscoveryMetadata(tool: ToolModule): ToolDiscoveryMetadata {
  const override = TOOL_PAGE_METADATA[tool.id];
  const description = override?.description ?? tool.description;
  const inputLabel = tool.input.accept.length
    ? `Accepts: ${tool.input.accept.join(', ')}.${tool.input.sizeLimit === undefined ? '' : ` Up to ${tool.input.sizeLimit.toLocaleString('en-US')} bytes per file.`}`
    : 'No file input — use the controls for this task.';
  const outputLabel = tool.id === 'construction-estimate-generator'
    ? 'Outputs: JSON or PDF, according to the selected format.'
    : `Outputs: ${tool.output.mime}${tool.output.multiple ? ' (multiple files)' : ''}.`;
  const fields = Object.entries(tool.paramSchema as Record<string, ParamFieldSchema> | undefined ?? {})
    .map(([name, field]) => fieldHelp(name, field));
  const networkAccess = tool.id === 'domain-age-checker' ? 'domain-registration' : undefined;
  const execution = networkAccess
    ? 'This free lookup sends the entered domain to Wyreup and its public registration registry.'
    : tool.cost === 'credit'
      ? 'This hosted PRO tool sends its input to Wyreup for remote processing and uses credits.'
      : 'Processing runs locally. Check the task controls and supported formats before using the result.';
  const backfill: ToolSeoContent = {
    intro: `${description}\n\n${inputLabel} ${outputLabel} ${execution}`,
    useCases: [description],
    faq: [
      { q: `What input does ${tool.name} use?`, a: `${inputLabel}${fields.length ? ` Settings: ${fields.join('. ')}.` : ''}` },
      { q: `What does ${tool.name} produce?`, a: `${outputLabel} ${description}` },
      { q: 'Where does this task run?', a: execution },
    ],
  };
  // Baseline question-specific corrections run before the final FAQ replacement.
  const generated = mergeContent(backfill, SEO_CONTENT[tool.id]);
  const inline = mergeContent(generated, tool.seoContent);
  const corrected = correctedToolSeoContent(tool.id, inline) ?? inline;
  const seoContent = mergeContent(corrected, CONTENT_OVERRIDES[tool.id]);
  return {
    title: override?.title ?? `${tool.name} — Wyreup`,
    heading: override?.heading ?? tool.name,
    description,
    keywords: tool.keywords,
    seoContent,
    inputLabel,
    outputLabel,
    ...(networkAccess ? { networkAccess } : {}),
  };
}

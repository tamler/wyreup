import * as p from '@clack/prompts';
import { scaffoldTool } from './init-tool-scaffold.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const CATEGORIES = [
  'optimize',
  'convert',
  'edit',
  'privacy',
  'pdf',
  'create',
  'inspect',
  'export',
  'audio',
  'dev',
  'finance',
] as const;

const MEMORY_OPTIONS = ['low', 'medium', 'high'] as const;

export async function initToolCommand(): Promise<void> {
  p.intro('wyreup init-tool — scaffold a new ToolModule');

  const answers = await p.group(
    {
      toolId: () =>
        p.text({
          message: 'Tool ID (kebab-case)',
          placeholder: 'my-tool',
          validate: (v) => {
            if (!v) return 'Tool ID is required.';
            if (!/^[a-z][a-z0-9-]*$/.test(v)) return 'Must be lowercase kebab-case (e.g. my-tool).';
          },
        }),

      displayName: () =>
        p.text({
          message: 'Display name',
          placeholder: 'My Tool',
          validate: (v) => { if (!v) return 'Display name is required.'; },
        }),

      description: () =>
        p.text({
          message: 'Description (one sentence)',
          placeholder: 'Does something useful with your files.',
          validate: (v) => { if (!v) return 'Description is required.'; },
        }),

      category: () =>
        p.select({
          message: 'Category',
          options: CATEGORIES.map((c) => ({ value: c, label: c })),
        }),

      inputMimesRaw: () =>
        p.text({
          message: 'Input MIMEs (comma-separated)',
          placeholder: 'image/jpeg,image/png',
          validate: (v) => { if (!v) return 'At least one MIME type is required.'; },
        }),

      outputMime: () =>
        p.text({
          message: 'Output MIME',
          placeholder: 'image/jpeg',
          validate: (v) => { if (!v) return 'Output MIME is required.'; },
        }),

      inputMin: () =>
        p.text({
          message: 'Minimum input count',
          placeholder: '1',
          initialValue: '1',
        }),

      inputMax: () =>
        p.text({
          message: 'Maximum input count',
          placeholder: '1',
          initialValue: '1',
        }),

      memoryEstimate: () =>
        p.select({
          message: 'Memory estimate',
          options: MEMORY_OPTIONS.map((m) => ({
            value: m,
            label: m === 'low' ? 'low  (<50 MB)' : m === 'medium' ? 'medium  (50–200 MB)' : 'high  (200–500 MB)',
          })),
        }),
    },
    {
      onCancel: () => {
        p.cancel('Cancelled.');
        process.exit(0);
      },
    },
  );

  // @clack/prompts group() returns correctly typed values — extract them cleanly.
  const toolId = String(answers.toolId);
  const displayName = String(answers.displayName);
  const description = String(answers.description);
  const category = String(answers.category);
  const outputMime = String(answers.outputMime);
  const inputMimes = String(answers.inputMimesRaw).split(',').map((m) => m.trim()).filter(Boolean);
  const inputMin = parseInt(String(answers.inputMin), 10) || 1;
  const inputMax = parseInt(String(answers.inputMax), 10) || 1;
  const memoryEstimate = String(answers.memoryEstimate) as 'low' | 'medium' | 'high';

  const monorepoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

  const paths = scaffoldTool(monorepoRoot, {
    toolId,
    displayName,
    description,
    category,
    inputMimes,
    outputMime,
    inputMin,
    inputMax,
    memoryEstimate,
  });

  p.outro(
    [
      `Scaffolded ${toolId}:`,
      `  ${paths.indexTs}`,
      `  ${paths.typesTs}`,
      `  ${paths.testTs}`,
      '',
      'Next steps:',
      `  1. Implement run() in ${paths.indexTs}`,
      `  2. Register in packages/core/src/default-registry.ts`,
      '  3. Run pnpm test to verify',
    ].join('\n'),
  );
}

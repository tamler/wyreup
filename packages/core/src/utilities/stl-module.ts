import type { ToolModule } from '../types.js';
import type { UtilityParams } from './common.js';
import { STL_LIMITS, stlDefaults, stlParamSchema, validateStlParams } from './stl-contours.js';
import { runStlFileJob } from './stl-job.js';

export const stlToGcode: ToolModule<UtilityParams> = {
  id: 'stl-to-gcode',
  slug: 'stl-to-gcode',
  name: 'STL Contour Preview G-code',
  description:
    'Slice a closed manifold STL into horizontal contours. Preview G-code has no extrusion, heaters or homing and is not printer-ready.',
  category: 'convert',
  keywords: ['stl', 'gcode', 'contours', 'slice', '3d'],
  input: {
    accept: ['model/stl', 'application/octet-stream', 'text/plain', '.stl'],
    min: 1,
    max: 1,
    sizeLimit: STL_LIMITS.inputBytes,
  },
  output: { mime: 'text/plain', multiple: false, filename: () => 'contour-preview.gcode' },
  defaults: stlDefaults,
  paramSchema: stlParamSchema,
  interactive: true,
  batchable: false,
  cost: 'free',
  memoryEstimate: 'medium',
  surfaces: ['web', 'cli', 'mcp'],
  async run(inputs, provided, ctx) {
    if (ctx.signal.aborted) throw new DOMException('STL conversion cancelled.', 'AbortError');
    if (inputs.length !== 1 || !inputs[0]!.size || inputs[0]!.size > STL_LIMITS.inputBytes)
      throw new Error('Select one nonempty STL of at most 20 MiB.');
    const params = validateStlParams(provided);
    const bytes = new Uint8Array(await inputs[0]!.arrayBuffer());
    if (ctx.signal.aborted) throw new DOMException('STL conversion cancelled.', 'AbortError');
    ctx.onProgress({
      stage: 'processing',
      percent: 10,
      message: 'Validating mesh and slicing all layers',
    });
    const value = await runStlFileJob(
      { type: 'stl-contours', bytes, params: { ...params } },
      ctx.signal,
    );
    if (ctx.signal.aborted) throw new DOMException('STL conversion cancelled.', 'AbortError');
    ctx.onProgress({ stage: 'done', percent: 100 });
    return [new Blob([value.gcode], { type: 'text/plain' })];
  },
  __testFixtures: {
    valid: ['test/fixtures/catalog-files/stl-cube.stl'],
    weird: ['test/fixtures/catalog-files/stl-open.stl'],
    expectedOutputMime: ['text/plain'],
  },
};

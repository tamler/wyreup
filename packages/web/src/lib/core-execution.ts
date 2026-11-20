import { createDefaultRegistry as createCoreRegistry, runChain as runCoreChain } from '@wyreup/core/execution';
import { displayName } from '../data/display-names';

export { clearPipelineCache } from '@wyreup/core/execution';

function isWebsiteTool(tool: ReturnType<typeof createCoreRegistry>['tools'][number]): boolean {
  return tool.cost === 'free' && (tool.surfaces === undefined || tool.surfaces.includes('web'));
}

export function createDefaultRegistry(): ReturnType<typeof createCoreRegistry> {
  const core = createCoreRegistry();
  const neuralOcrId = 'ocr-pro';
  const tools = core.tools.filter(isWebsiteTool).map(tool =>
    tool.id === neuralOcrId ? { ...tool, name: displayName(tool.id) } : tool,
  );
  const toolsById = new Map(tools.map(tool => [tool.id, tool]));
  const project = (candidates: typeof tools) => candidates.flatMap(tool => {
    const projected = toolsById.get(tool.id);
    return projected ? [projected] : [];
  });
  const neuralOcr = toolsById.get(neuralOcrId);
  return {
    tools,
    toolsById,
    toolsByCategory: category => project(core.toolsByCategory(category)),
    toolsForFiles: files => project(core.toolsForFiles(files)),
    searchTools(query) {
      const matches = project(core.searchTools(query));
      const term = query.trim().toLowerCase();
      if (neuralOcr && term && neuralOcr.name.toLowerCase().includes(term) && !matches.includes(neuralOcr)) {
        matches.push(neuralOcr);
      }
      return matches;
    },
  };
}

// Core validates and dispatches steps in order. Check the entire website chain
// up front so an old URL or saved chain cannot run even its earlier steps.
export async function runChain(...args: Parameters<typeof runCoreChain>): Promise<Blob[]> {
  const [chain, , , registry] = args;
  const unavailable = chain.find(({ toolId }) => {
    const tool = registry.toolsById.get(toolId);
    return !tool || !isWebsiteTool(tool);
  });
  if (unavailable) throw new Error(`Tool is unavailable on Wyreup: ${unavailable.toolId}`);
  return runCoreChain(...args);
}

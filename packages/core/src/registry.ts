import type { ToolModule, ToolCategory, MimePattern, Surface } from './types.js';

/**
 * True if this tool is exposed on the given runtime surface.
 * Undefined `surfaces` (the common case) means the tool runs everywhere.
 */
export function toolRunsOnSurface(tool: ToolModule, surface: Surface): boolean {
  return tool.surfaces === undefined || tool.surfaces.includes(surface);
}

export interface ToolRegistry {
  /** All tools, in registration order. */
  readonly tools: readonly ToolModule[];
  /** Fast lookup by tool id. */
  readonly toolsById: ReadonlyMap<string, ToolModule>;
  /** All tools matching a category. */
  toolsByCategory(category: ToolCategory): ToolModule[];
  /** Tools whose input spec is satisfied by the given files. */
  toolsForFiles(files: File[]): ToolModule[];
  /** Fuzzy-ish search across id, name, description, keywords. */
  searchTools(query: string): ToolModule[];
}

/**
 * Create a registry over a fixed list of tools. The registry is the single
 * source of truth consumed by the editor, command palette, sitemap generator,
 * MCP server schema generator, and CLI.
 */
export function createRegistry(tools: ToolModule[]): ToolRegistry {
  const toolsById = new Map(tools.map((t) => [t.id, t]));

  function toolsByCategory(category: ToolCategory): ToolModule[] {
    return tools.filter((t) => t.category === category);
  }

  function toolsForFiles(files: File[]): ToolModule[] {
    if (files.length === 0) {
      // Tools with min: 0 (e.g. qr generator) are always available.
      return tools.filter((t) => t.input.min === 0);
    }
    return tools.filter((t) => filesMatchInput(files, t.input));
  }

  function searchTools(query: string): ToolModule[] {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return tools.filter((t) => {
      if (t.id.toLowerCase().includes(q)) return true;
      if (t.name.toLowerCase().includes(q)) return true;
      if (t.description.toLowerCase().includes(q)) return true;
      if (t.keywords.some((k) => k.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  return {
    tools,
    toolsById,
    toolsByCategory,
    toolsForFiles,
    searchTools,
  };
}

/**
 * Check whether a set of files satisfies a tool's input specification.
 * - File count must be between min and max (inclusive).
 * - Every file's MIME type must match one of the accept patterns.
 */
function filesMatchInput(
  files: File[],
  input: ToolModule['input'],
): boolean {
  if (files.length < input.min) return false;
  if (input.max !== undefined && files.length > input.max) return false;
  return files.every((f) => input.accept.some((p) => mimeMatches(f.type, p)));
}

/**
 * Match a MIME type against a pattern. Supports simple wildcards like
 * 'image/*' matching any 'image/<x>'.
 *
 * Handles MIME parameters per RFC 7231 — `audio/webm;codecs=opus` matches
 * the `audio/webm` pattern. MediaRecorder routinely emits the parameter-
 * suffixed form, and without this normalization the captured-blob would
 * match nothing in the chain panel.
 */
export function mimeMatches(mime: string, pattern: MimePattern): boolean {
  if (pattern === '*' || pattern === '*/*') return true;
  // Strip parameters (anything after `;`) before comparison.
  const baseMime = (mime.split(';')[0] ?? '').trim().toLowerCase();
  const basePattern = (pattern.split(';')[0] ?? '').trim().toLowerCase();
  if (basePattern.endsWith('/*')) {
    const prefix = basePattern.slice(0, -1); // 'image/'
    return baseMime.startsWith(prefix);
  }
  return baseMime === basePattern;
}

/**
 * Decide whether a producer's declared output MIME could feed a
 * consumer's `accept` list. Used by chain UIs (builder, dry-run, panel)
 * that need to predict compatibility before any concrete bytes exist.
 *
 * Wildcards on either side are tolerated:
 * - Producer `image/<wild>` resolves to a concrete `image/<x>` at runtime,
 *   so it's compatible with any consumer that accepts the same family
 *   (concrete or wildcard).
 * - Consumer `<star>` / `<star>/<star>` accepts anything.
 *
 * Use this whenever you're matching declared output → declared accept.
 * For matching a real File's `.type` → declared accept, use
 * `mimeMatches(file.type, pattern)` directly.
 */
export function couldFlowTo(producerOutput: string, consumerAccept: MimePattern[]): boolean {
  const out = (producerOutput.split(';')[0] ?? '').trim().toLowerCase();
  if (out.endsWith('/*')) {
    const family = out.slice(0, -1); // 'image/'
    return consumerAccept.some((pattern) => {
      const p = (pattern.split(';')[0] ?? '').trim().toLowerCase();
      if (p === '*' || p === '*/*') return true;
      if (p.endsWith('/*')) {
        // Same family wildcard, or wider wildcard, both flow.
        return p.startsWith(family) || family.startsWith(p.slice(0, -1));
      }
      return p.startsWith(family);
    });
  }
  return consumerAccept.some((p) => mimeMatches(producerOutput, p));
}

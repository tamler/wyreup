// MCP-local override map for Tool.idempotent. The default is true (deterministic
// output from same input). List tool IDs whose output is stochastic — currently
// the LLM- and diffusion-backed Pro tools. Keep this list in sync as Pro tools
// are added; the annotations test enforces shape but not membership.

export const NON_IDEMPOTENT_TOOLS = new Set<string>([
  'chat-long-pdf-pro',
  'chat-image-pro',
  'image-generate-pro',
  'text-summarize',
  'text-translate-pro',
]);

export function isIdempotent(toolId: string): boolean {
  return !NON_IDEMPOTENT_TOOLS.has(toolId);
}

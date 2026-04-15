import { createRegistry, type ToolRegistry } from '@wyreup/core';

/**
 * Wyreup MCP server state. Wave 0 scaffold: wraps an empty registry.
 * Wave 1 will add real tools and MCP protocol handlers.
 */
export interface WyreupMcpServer {
  registry: ToolRegistry;
  start(): Promise<void>;
}

export function createWyreupMcpServer(): WyreupMcpServer {
  const registry = createRegistry([]);

  return {
    registry,
    async start(): Promise<void> {
      console.error(
        `[wyreup-mcp] starting with ${registry.tools.length} tool(s) registered (Wave 0 scaffold)`,
      );
      // Wave 1: connect to MCP transport (stdio), handle list_tools / call_tool.
    },
  };
}

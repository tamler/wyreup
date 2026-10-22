import { readFileSync } from 'node:fs';

type PackageMetadata = { version?: unknown };

const metadata = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as PackageMetadata;

if (typeof metadata.version !== 'string' || metadata.version.length === 0) {
  throw new Error('@wyreup/mcp package.json has no valid version');
}

export const MCP_VERSION = metadata.version;

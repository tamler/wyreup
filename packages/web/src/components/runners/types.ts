import type { ParamFieldSchema, ToolRequires } from '@wyreup/core';

export interface SerializedTool {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  keywords: string[];
  input: { accept: string[]; min: number; max?: number; sizeLimit?: number };
  output: { mime: string; multiple?: boolean };
  defaults: Record<string, unknown>;
  paramSchema?: Record<string, ParamFieldSchema>;
  requiresWebgpu?: 'preferred' | 'required';
  requires?: ToolRequires;
  installSize?: number;
  installGroup?: string;
  memoryEstimate: string;
  outputDisplay?: 'mono' | 'prose';
}

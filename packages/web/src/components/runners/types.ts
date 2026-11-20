import type { ParamFieldSchema, ToolRequires } from '@wyreup/core';

export type PreloadAdmission =
  { file: File; status: 'admitted' } | { file: File; status: 'refused'; message: string };

export interface SerializedTool {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  keywords: string[];
  networkAccess?: 'domain-registration';
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
  /** Retained to reject stale serialized tool data. */
  cost?: 'free' | 'credit';
}

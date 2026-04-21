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
  requiresWebgpu?: 'preferred' | 'required';
  memoryEstimate: string;
}

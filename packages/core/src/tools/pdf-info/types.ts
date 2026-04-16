// pdf-info takes no params
export type PdfInfoParams = Record<string, never>;

export const defaultPdfInfoParams: PdfInfoParams = {};

export interface PdfInfoResult {
  pageCount: number;
  bytes: number;
  title: string | null;
  author: string | null;
  subject: string | null;
  producer: string | null;
  creator: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
}

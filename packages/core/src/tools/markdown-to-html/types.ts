export interface MarkdownToHtmlParams {
  /** Enable GitHub Flavored Markdown (tables, task lists, strikethrough). Default true. */
  gfm?: boolean;
}

export const defaultMarkdownToHtmlParams: MarkdownToHtmlParams = {
  gfm: true,
};

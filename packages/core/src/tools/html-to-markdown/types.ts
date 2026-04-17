export interface HtmlToMarkdownParams {
  /** 'atx' uses # prefixes; 'setext' uses underlines. Default 'atx'. */
  headingStyle?: 'atx' | 'setext';
}

export const defaultHtmlToMarkdownParams: HtmlToMarkdownParams = {
  headingStyle: 'atx',
};

export interface JsonFormatterParams {
  /** Spaces per indent level. Default 2. */
  indent?: number;
}

export const defaultJsonFormatterParams: JsonFormatterParams = {
  indent: 2,
};

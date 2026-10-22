export interface JsonFormatterParams {
  /** Spaces per indent level. Default 2. */
  indent?: number;
  sortKeys?: boolean;
  validationOnly?: boolean;
}

export const defaultJsonFormatterParams: JsonFormatterParams = {
  indent: 2,
  sortKeys: false,
  validationOnly: false,
};

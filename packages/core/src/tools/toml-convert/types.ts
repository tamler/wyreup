export type TomlConvertDirection = 'auto' | 'toml-to-json' | 'json-to-toml';

export interface TomlConvertParams {
  direction?: TomlConvertDirection;
  indent?: number;
}

export const defaultTomlConvertParams: TomlConvertParams = {
  direction: 'auto',
  indent: 2,
};

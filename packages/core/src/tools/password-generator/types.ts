export interface PasswordGeneratorParams {
  /** Password length. Default 16. */
  length?: number;
  /** Include uppercase letters. Default true. */
  uppercase?: boolean;
  /** Include lowercase letters. Default true. */
  lowercase?: boolean;
  /** Include digits. Default true. */
  digits?: boolean;
  /** Include symbols. Default true. */
  symbols?: boolean;
  /** Exclude visually ambiguous characters (0O, l1I). Default false. */
  excludeAmbiguous?: boolean;
  /** Number of passwords to generate. Default 1. */
  count?: number;
}

export const defaultPasswordGeneratorParams: PasswordGeneratorParams = {
  length: 16,
  uppercase: true,
  lowercase: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: false,
  count: 1,
};

export type X509DecodeParams = Record<string, never>;

export interface X509DecodeResult {
  subject: string;
  issuer: string;
  serial: string;
  notBefore: string;
  notAfter: string;
  daysUntilExpiry: number;
  subjectAltNames: string[];
  publicKeyAlgorithm: string;
  publicKeySize: number | null;
  signatureAlgorithm: string;
  sha1Fingerprint: string;
  sha256Fingerprint: string;
  isSelfSigned: boolean;
}

export const defaultX509DecodeParams: X509DecodeParams = {};

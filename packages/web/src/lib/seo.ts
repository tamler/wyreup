const PRODUCTION_ORIGIN = 'https://wyreup.com';

/** Page identity only: never use this to rewrite file or tool-launch URLs. */
export function canonicalPageUrl(path: string): string {
  const pathname = new URL(path, PRODUCTION_ORIGIN).pathname;
  return `${PRODUCTION_ORIGIN}${pathname === '/' ? '/' : `${pathname.replace(/\/+$/, '')}/`}`;
}

export function isIndexablePath(path: string): boolean {
  const pathname = new URL(path, PRODUCTION_ORIGIN).pathname.replace(/\/+$/, '');
  return !/^\/(?:account|admin|settings|share|share-receive|toolbelt|chain|404(?:\.html)?)(?:\/|$)/.test(
    pathname,
  );
}

interface ToolPageMetadata {
  heading: string;
  title: string;
  description: string;
}

// Web copy describes search tasks without changing registry names or tool APIs.
export const TOOL_PAGE_METADATA: Record<string, ToolPageMetadata> = {
  compress: {
    heading: 'Compress images',
    title: 'Compress images online — JPEG, PNG & WebP — Wyreup',
    description:
      'Compress JPEG, PNG and WebP images in your browser without uploading your photos. Choose quality and download a separate copy; size savings vary.',
  },
  convert: {
    heading: 'Convert images',
    title: 'Convert images — JPG, PNG & WebP converter — Wyreup',
    description:
      'Convert images between JPG, PNG and WebP in your browser without uploading them. Choose an output format and quality, then download your converted copy.',
  },
  'strip-exif': {
    heading: 'Remove photo metadata',
    title: 'Remove photo metadata — EXIF & GPS remover — Wyreup',
    description:
      'Remove EXIF metadata, GPS coordinates and camera details from JPEG, PNG and WebP photos by re-encoding locally. Download a cleaned copy without uploading it.',
  },
  'face-blur': {
    heading: 'Blur faces in photos',
    title: 'Blur faces in photos online — on-device face blur — Wyreup',
    description:
      'Detect and blur faces in JPG, PNG and WebP photos on your device. Download a PNG and review every face: automatic detection can miss people.',
  },
  'heic-to-jpg': {
    heading: 'HEIC to JPG converter',
    title: 'HEIC to JPG converter — also PNG & WebP — Wyreup',
    description:
      'Convert HEIC and HEIF still images to JPG, PNG or WebP locally in your browser. Choose quality or convert multiple photos without uploading them.',
  },
  ocr: {
    heading: 'Extract text from images with OCR',
    title: 'Image to text OCR — extract text from scans — Wyreup',
    description:
      'Extract plain text from JPEG, PNG, WebP, TIFF and BMP images with on-device OCR. Language data downloads on first use; review recognition mistakes.',
  },
  'pdf-compress': {
    heading: 'Compress PDF files',
    title: 'Compress PDF files online — reduce embedded image size — Wyreup',
    description:
      'Reduce PDF size by re-encoding supported embedded images on your device. Image quality can change; savings depend on the PDF and are not guaranteed.',
  },
  'pgp-armor': {
    heading: 'Encode or decode PGP ASCII armor',
    title: 'PGP ASCII armor encoder & decoder — Wyreup',
    description:
      'Wrap bytes in OpenPGP ASCII armor or decode an armored block locally. Inspect headers and CRC-24 checksums; armoring does not encrypt or sign your file.',
  },
  'pgp-decrypt': {
    heading: 'Decrypt a PGP file',
    title: 'Open and decrypt PGP files with your private key — Wyreup',
    description:
      'Decrypt armored or binary OpenPGP files locally using your private key and its passphrase when needed. Download the decrypted bytes from your browser.',
  },
  'pdf-form-fields': {
    heading: 'Inspect PDF form fields',
    title: 'List PDF form fields, names & values — Wyreup',
    description:
      'Inspect interactive PDF form fields locally: names, types, required and read-only flags, and optional current values. Download a JSON report without editing the PDF.',
  },
  'image-similarity': {
    heading: 'Compare image similarity locally',
    title: 'Image similarity checker — compare photos locally — Wyreup',
    description:
      'Compare JPG, PNG and WebP images with local image embeddings. Review similarity scores and groups as suggestions, and inspect originals before deleting photos.',
  },
  'otpauth-uri': {
    heading: 'Build an otpauth URI and QR code',
    title: 'otpauth URI generator — TOTP & HOTP QR codes — Wyreup',
    description:
      'Build a TOTP or HOTP enrollment URI and optional QR code from a Base32 secret, issuer and account. Keep the secret and generated QR private.',
  },
};

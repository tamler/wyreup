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
  'csv-viewer': {
    heading: 'View and edit CSV files',
    title: 'CSV viewer and editor — search, sort & export — Wyreup',
    description:
      'Open CSV files locally, search all rows, edit cells and export the complete edited or filtered table. Quoted fields and numeric strings stay intact.',
  },
  'psd-to-png': {
    heading: 'Convert a saved PSD composite to PNG',
    title: 'PSD to PNG converter — saved 8-bit composites — Wyreup',
    description:
      'Export the saved RGB or grayscale composite from an 8-bit raw or RLE PSD locally. Layers are not recomposited; PSB and ZIP compression are unsupported.',
  },
  'mp3-to-midi': {
    heading: 'Create a MIDI pitch sketch from MP3',
    title: 'MP3 to MIDI — experimental monophonic melody — Wyreup',
    description:
      'Decode an MP3 locally, review detected notes and export a MIDI pitch sketch. Experimental monophonic transcription; chords, drums and voice reconstruction are unsupported.',
  },
  'bank-statement-to-csv': {
    heading: 'Review bank statement PDF data and export CSV',
    title: 'Bank statement PDF to CSV — reviewed local export — Wyreup',
    description:
      'Extract supported horizontal text from a bank statement PDF locally. Map columns, review every line and check balances before exporting CSV. Scans need OCR first.',
  },
  'stl-to-gcode': {
    heading: 'Create contour-only G-code from STL',
    title: 'STL to contour G-code — local geometry preview — Wyreup',
    description:
      'Slice supported closed STL meshes into contour-only G-code locally. Inspect layers and dimensions; output has no extrusion, heating or homing commands.',
  },
  'domain-age-checker': {
    heading: 'Check domain registration age',
    title: 'Domain age checker — public RDAP registration data — Wyreup',
    description:
      'Check public registration dates and age through Wyreup and the domain registry. Registration age can differ from first-ever use. No API key required.',
  },
  'code-beautifier': {
    heading: 'Beautify JavaScript, JSON, CSS, HTML, XML or SQL',
    title: 'Code beautifier — six local language formatters — Wyreup',
    description:
      'Format code locally with installed language parsers and download the complete result. Input is not executed; HTML and SQL formatting does not guarantee valid syntax.',
  },
  'aspect-ratio-calculator': {
    heading: 'Calculate an aspect ratio or missing dimension',
    title: 'Aspect ratio calculator — exact decimal ratios — Wyreup',
    description:
      'Reduce positive decimal dimensions to an exact ratio or calculate a missing width or height. Missing dimensions round to six decimal places when necessary.',
  },
  'word-counter': {
    heading: 'Count words, characters and UTF-8 bytes',
    title: 'Word and character counter — live local text statistics — Wyreup',
    description:
      'Count words, UTF-16 characters, Unicode code points, graphemes and UTF-8 bytes locally. Estimate speaking time and compare text with your chosen length limit.',
  },
  'ip-subnet-calc': {
    heading: 'Calculate and split IPv4 subnets',
    title: 'IPv4 subnet calculator — CIDR and subnet splitting — Wyreup',
    description:
      'Calculate network ranges and split a CIDR block into up to 4,096 subnets locally. Page through results or download the complete JSON report.',
  },
  'cron-from-text': {
    heading: 'Build and inspect a cron expression',
    title: 'Cron expression builder — explicit timezone and next runs — Wyreup',
    description:
      'Build five-field cron expressions and inspect upcoming runs from an explicit date and IANA timezone. Review the day-of-month/day-of-week rule; no jobs are scheduled.',
  },
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

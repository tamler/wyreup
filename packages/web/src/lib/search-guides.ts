import type { ToolSeoContent } from '@wyreup/core';

export interface SearchGuide {
  heading: string;
  steps: string[];
  example: string;
  formats: string;
  limitations: string[];
  links: { href: string; label: string }[];
}

// Hand-maintained task help, grounded in the matching tool's input and run code.
export const SEARCH_GUIDES: Record<string, SearchGuide> = {
  'strip-exif': {
    heading: 'How to remove EXIF metadata from a photo',
    steps: [
      'Select one or more JPEG, PNG or WebP photos in the tool above.',
      'Run the tool to decode and re-encode each image without its embedded metadata.',
      'Download the cleaned copy, check its EXIF fields in a local metadata viewer and inspect the visible scene, then share that copy instead of the original.',
    ],
    example:
      'Before posting a photo of an item for sale, clean the embedded GPS and camera fields. Check the image itself for an address, reflection or landmark that could still reveal where it was taken.',
    formats:
      'Input: JPEG, PNG or WebP, up to 500 MB per file. Output: the same image format. Device memory may impose a lower practical limit.',
    limitations: [
      'The tool re-encodes at quality 95. JPEG and WebP pixels can change, and the cleaned file can be larger than the original.',
      'Removing EXIF does not conceal faces, street signs, filenames or information recorded by a service you later share with.',
      'For HEIC or HEIF, convert the still image first. Inspect the downloaded copy before sharing sensitive material.',
    ],
    links: [
      { href: '/remove-photo-location-data/', label: 'Remove location data before sharing' },
      { href: '/tools/image-info/', label: 'Inspect image dimensions and file size' },
      { href: '/tools/face-blur/', label: 'Blur faces in the visible photo' },
      { href: '/share-photo-safely/', label: 'Remove metadata and compress a sharing copy' },
    ],
  },
  'face-blur': {
    heading: 'How to blur faces in a photo',
    steps: [
      'Select a JPEG, PNG or WebP photo. The face detector downloads its model and runtime when needed; the photo is processed on your device.',
      'Run face blur and inspect the output at full size. Automatic detection applies blur to the faces it finds.',
      'Download the PNG only after checking every person and other identifying details. Use a region-redaction tool for details the detector misses.',
    ],
    example:
      'For an event photo, check the foreground and the crowd in the background. A small profile or partially covered face may be missed even when a larger face was blurred.',
    formats:
      'Input: JPEG, PNG or WebP, up to 50 MB per file. Output: PNG. No WebGPU requirement; detection uses a local WASM runtime.',
    limitations: [
      'Detection can miss small, turned-away or obscured faces. Blur does not guarantee anonymity or satisfy a particular privacy rule.',
      'Clothing, tattoos, text, reflections and location clues remain visible. Review the whole image before you share.',
      'The first run needs model/runtime downloads. PNG output can be larger than the source photo.',
    ],
    links: [
      { href: '/tools/pixelate-region/', label: 'Pixelate a region the detector missed' },
      { href: '/remove-photo-location-data/', label: 'Remove hidden photo location data' },
      { href: '/tools/compress/', label: 'Compress the resulting image' },
    ],
  },
  'heic-to-jpg': {
    heading: 'How to convert HEIC to JPG, PNG or WebP',
    steps: [
      'Select one or more HEIC or HEIF files. Choose JPEG for a JPG copy, or select PNG or WebP for a different destination.',
      'Choose quality for JPEG or WebP, then run the conversion on your device.',
      'Download and open the converted still image. Check the recipient or upload form accepts its format and size.',
    ],
    example:
      'If a website rejects an iPhone .heic file but accepts .jpg, choose JPEG. If its upload limit is still exceeded, compress or resize the JPG after conversion.',
    formats:
      'Input: HEIC or HEIF, up to 200 MB per file. Output: JPEG, PNG or WebP. Multiple selected files produce separate converted images.',
    limitations: [
      'The decoder uses the first still image in each file. Live Photo motion, sound and additional images are not exported.',
      'JPEG and WebP use the chosen quality setting. PNG preserves the decoded pixels but does not restore detail already lost in the HEIC source.',
      'Conversion can change colors, metadata and file size. No output format is accepted by every website; check the destination requirements.',
    ],
    links: [
      { href: '/convert-heic-to-jpg/', label: 'Prepare an iPhone photo for a JPG-only website' },
      { href: '/compress-photo-for-email/', label: 'Make the converted photo easier to email' },
      { href: '/tools/strip-exif/', label: 'Clean metadata from the converted image' },
    ],
  },
  compress: {
    heading: 'How to compress images',
    steps: [
      'Select JPEG, PNG or WebP images. Start with the default quality of 80 and run the tool.',
      'Download and compare the result with the original, checking both file size and important details such as small text.',
      'If you need a smaller file, lower quality or resize the image. Check the destination limit before attaching or uploading it.',
    ],
    example:
      "For a receipt photo sent by email, keep the amounts and dates readable. Check the downloaded file against your email provider's attachment limit; no particular size reduction is guaranteed.",
    formats:
      'Input: JPEG, PNG or WebP, up to 500 MB per file. The browser interface keeps the source format and offers a quality setting. Output: one image per input.',
    limitations: [
      'JPEG and WebP compression can discard detail. PNG may not shrink much because its encoding is lossless.',
      'If same-format re-encoding is larger, the tool keeps the original bytes. A result may therefore have the same size and metadata as the input.',
      'This is not a target-size guarantee. HEIC, GIF and SVG need their corresponding converter first; large images can exhaust device memory.',
    ],
    links: [
      { href: '/compress-photo-for-email/', label: 'Compress a photo for an email attachment' },
      { href: '/tools/resize/', label: 'Reduce image dimensions' },
      { href: '/tools/convert/', label: 'Convert an image to another format' },
      { href: '/tools/strip-exif/', label: 'Remove metadata explicitly' },
    ],
  },
  convert: {
    heading: 'How to convert images between JPG, PNG and WebP',
    steps: [
      'Select JPEG, PNG or WebP files and choose the output format required by your website or app.',
      'Set quality for JPEG or WebP and run the conversion. PNG output uses lossless encoding of the decoded pixels.',
      'Download the converted copy and inspect its appearance, transparency and size before replacing an asset.',
    ],
    example:
      'Convert a WebP download to JPEG for an older app, or choose PNG when a graphic needs transparency. Keep the original so you can return to it if the new format changes the appearance.',
    formats:
      'Input and output: JPEG, PNG or WebP, up to 500 MB per input file. JPEG does not support transparency. Several files can be converted in one run.',
    limitations: [
      'JPEG and WebP output can lose detail. Converting an already compressed JPG to PNG does not recover missing detail.',
      'A different format can produce a larger file. Inspect transparent edges when moving to JPEG.',
      "HEIC, GIF, SVG, PDF and document files are outside this converter's input formats. Use the matching dedicated tool.",
    ],
    links: [
      { href: '/tools/heic-to-jpg/', label: 'Convert HEIC or HEIF instead' },
      { href: '/tools/svg-to-png/', label: 'Convert SVG to PNG' },
      { href: '/tools/compress/', label: 'Compress the converted image' },
    ],
  },
};

export const JOB_SEARCH_GUIDES: Record<string, SearchGuide> = {
  'remove-photo-location-data': {
    ...SEARCH_GUIDES['strip-exif'],
    heading: 'How to remove photo location data before sharing',
    steps: [
      'Choose a JPEG, PNG or WebP photo using the launcher above. Convert an iPhone HEIC photo first if needed.',
      'Run the cleanup to create a re-encoded copy without embedded GPS, camera and timestamp metadata.',
      'Download the copy, check EXIF fields in a local metadata viewer and inspect visible surroundings. Send the cleaned download rather than the source file.',
    ],
    links: [
      { href: '/tools/strip-exif/', label: 'Open the EXIF metadata removal tool' },
      { href: '/convert-heic-to-jpg/', label: 'Convert an iPhone HEIC photo first' },
      { href: '/tools/face-blur/', label: 'Blur visible faces before sharing' },
      { href: '/share-photo-safely/', label: 'Remove metadata and compress together' },
    ],
  },
  'convert-heic-to-jpg': {
    ...SEARCH_GUIDES['heic-to-jpg'],
    heading: 'How to make an iPhone HEIC photo a JPG',
    steps: [
      'Select the HEIC or HEIF still image from your device using the launcher above.',
      'Run the job to create a JPEG copy. Your original HEIC is kept on your device.',
      'Download the JPG, open it to check the photo, and confirm the website or recipient accepts its size.',
    ],
    formats:
      'Input: HEIC or HEIF still images, up to 200 MB per file. This job outputs JPEG; use the full converter for PNG, WebP or quality settings.',
    links: [
      { href: '/tools/heic-to-jpg/', label: 'Choose HEIC output format and quality' },
      { href: '/compress-photo-for-email/', label: 'Compress the JPG for email' },
      { href: '/remove-photo-location-data/', label: 'Remove metadata before sharing the JPG' },
    ],
  },
  'compress-photo-for-email': {
    ...SEARCH_GUIDES.compress,
    heading: 'How to compress a photo for email',
    steps: [
      "Check your email service's attachment limit, including the combined size of all files you plan to send.",
      'Select a JPEG, PNG or WebP photo above and run the compression job with its default quality setting.',
      'Download the result and check its size and readability. Use the full compressor or resize tool if you need another adjustment, then attach the downloaded copy.',
    ],
    links: [
      { href: '/tools/compress/', label: 'Adjust image compression quality' },
      { href: '/tools/resize/', label: 'Resize a photo that remains too large' },
      { href: '/convert-heic-to-jpg/', label: 'Convert an iPhone HEIC photo first' },
      { href: '/remove-photo-location-data/', label: 'Remove photo location data before emailing' },
    ],
  },
};

// Correct scoped generated copy without modifying the generated backfill.
const CONTENT_CORRECTIONS: Record<
  string,
  {
    intro?: string;
    useCases?: string[];
    answers?: Record<string, string>;
    alsoTry?: ToolSeoContent['alsoTry'];
  }
> = {
  compress: {
    intro:
      'Compress images by re-encoding JPEG, PNG and WebP locally. Choose a quality setting for a sharing copy, then compare size and appearance. Savings depend on the source; when a same-format encode is larger, the tool keeps the original bytes.',
    answers: {
      'Which image formats can I compress?':
        'JPEG, PNG and WebP. The browser interface keeps the original format. Re-encoding may reduce size; when it would produce a larger file, the original bytes are returned.',
      'Does compressing reduce quality?':
        'JPEG and WebP output can lose detail as quality is lowered. PNG encoding is lossless. Inspect the result at the size you intend to use.',
      'Is there a file-size limit?':
        'The tool accepts up to 500 MB per input file. Device memory and image dimensions can impose a lower practical limit, especially on phones.',
    },
  },
  convert: {
    intro:
      'Convert images between JPEG, PNG and WebP locally. Choose the format your destination accepts and check the converted copy: lossy encoding, transparency support and file size vary by output format. Your source file stays unchanged.',
    answers: {
      'Can it convert HEIC or GIF?':
        'This converter accepts JPEG, PNG and WebP only. Use the dedicated HEIC to JPG tool for HEIC/HEIF images, or a matching tool for other formats.',
    },
  },
  'face-blur': {
    intro:
      'Blur the faces detected in a JPEG, PNG or WebP photo on your device and download a PNG. Automatic detection can miss people; inspect every face and other identifying details before sharing. The detector model and runtime download when needed, while the photo stays local.',
    useCases: [
      'Prepare an event or street photo with detected faces blurred, then check every person before posting.',
      'Create a reviewed sharing copy of a classroom or workplace photo; obtain any consent your situation requires.',
      'Blur detected faces in a screenshot or crowd photo and separately check clothing, text and location clues.',
      'Make a family photo sharing copy while reviewing whether people remain identifiable.',
      'Prepare research-image redactions for human review under the applicable protocol.',
    ],
    answers: {
      'Does it work offline?':
        'Local processing does not upload your photo. The first run needs the detector model and runtime downloads; offline reuse depends on which assets remain available in your browser.',
      'Can the blur be reversed?':
        'Blur is baked into the output pixels, but it does not guarantee anonymity. People may remain identifiable from an insufficient blur or other details. Keep the original separately and inspect the result.',
    },
  },
  'strip-exif': {
    intro:
      'Remove photo metadata such as EXIF GPS coordinates, camera fields and capture timestamps by decoding and re-encoding JPEG, PNG or WebP locally at quality 95. The cleaned copy has no source metadata, but its pixels and size can change. Visible location clues remain.',
    useCases: [
      'Remove embedded GPS fields before posting a photo to a marketplace or social site.',
      'Create a copy without camera fields and timestamps, then check it in a local metadata viewer.',
      'Clean product-photo metadata before preparing images for a public listing.',
      'Remove embedded metadata from supported screenshots or image exports before attaching them to a public report.',
      'Prepare a photo for sensitive sharing while separately reviewing visible location and identity clues.',
    ],
    answers: {
      'Will stripping metadata hurt image quality?':
        'The tool re-encodes at quality 95. JPEG and WebP can lose detail; inspect the cleaned copy and keep your original.',
      'Does my photo get uploaded to check the metadata?':
        'No. This tool decodes and re-encodes your image in the browser without uploading its contents.',
      'Can someone still recover the GPS location afterward?':
        'The re-encoded copy does not carry the source EXIF GPS fields. Visible landmarks, filenames and records held by another app or service may still reveal a location.',
    },
  },
  'heic-to-jpg': {
    intro:
      'Convert HEIC/HEIF still images to JPG, PNG or WebP on your device. Choose a format supported by the destination and inspect the resulting copy. The tool exports the first decoded still image; it does not carry Live Photo motion or sound into the output.',
    answers: {
      "Why won't websites accept my iPhone photos?":
        "Many iPhones save photos in HEIC format. Some websites and older apps do not support it; a JPEG copy is broadly compatible, but check the destination's accepted formats and size limit.",
      'Does my photo get uploaded to convert it?':
        'No. Decoding and encoding happen in your browser. Decoder and codec assets load when needed; offline reuse depends on which assets remain available.',
      'Which output format should I pick?':
        'JPEG is widely supported for photos. PNG uses lossless encoding of the decoded pixels and supports transparency. WebP can offer a smaller sharing copy; compare results and check destination support.',
      "Does it keep the photo's quality?":
        'JPEG and WebP use the selected quality (default 90). PNG preserves decoded pixels, but conversion does not restore lost source detail or preserve every HEIC feature. Inspect the result.',
    },
  },
  'image-similarity': {
    intro:
      'Compare images using CLIP image embeddings and review pairwise similarity scores and suggested groups. Processing runs on your device; model and runtime assets download when needed. Scores are suggestions for manual review, not proof that two photos are duplicates. Inspect originals before deleting photos.',
    useCases: [
      'Review a small group of images and inspect pairs with high similarity scores.',
      'Download scores and suggested groups as JSON while retaining your original files.',
      'Check suspected matches with pixel differences or file checksums when you need stronger evidence.',
    ],
    answers: {
      'What does the score mean?':
        'The score is cosine similarity between CLIP image embeddings. A higher score indicates more similar embeddings, but does not prove that the files or pictured objects are identical.',
      'Is this the same as a pixel diff?':
        'No. This tool compares image embeddings. Use Image Diff for a pixel-level comparison of supported same-size images, or Hash to check whether file bytes are identical.',
      'Do the images leave my device?':
        'Image processing runs locally in your browser without uploading your image contents. Model and runtime assets download when needed.',
      'Which formats are supported?':
        'The tool accepts JPEG, PNG and WebP and requires at least two images.',
      'Do the images have to be the same size?':
        'No. Images are decoded and prepared for the embedding model. Different dimensions are accepted, but scores still require manual review.',
      'Will it match two photos of the same object taken differently?':
        'A score does not establish that two photos show the same object. This tool suggests pairs to inspect; it does not automatically confirm duplicates or delete files.',
    },
    alsoTry: [
      { id: 'image-diff', why: 'Compare supported same-size images at the pixel level.' },
      { id: 'image-info', why: 'Inspect image dimensions, format and file size.' },
      { id: 'hash', why: 'Compare file checksums for byte-level verification.' },
    ],
  },
};

export function correctedToolSeoContent(
  id: string,
  content: ToolSeoContent | undefined,
): ToolSeoContent | undefined {
  const correction = CONTENT_CORRECTIONS[id];
  if (!content || !correction) return content;
  return {
    ...content,
    ...(correction.intro ? { intro: correction.intro } : {}),
    ...(correction.useCases ? { useCases: correction.useCases } : {}),
    ...(correction.alsoTry ? { alsoTry: correction.alsoTry } : {}),
    faq: content.faq?.map((entry) => ({ ...entry, a: correction.answers?.[entry.q] ?? entry.a })),
  };
}

// Build-only facade: reuse selected core processors without the public barrel's unrelated imports.
export { compressImageToSize } from '../../core/src/tools/compress-image-to-size/index.js';
export { stripExif } from '../../core/src/tools/strip-exif/index.js';
export { mergePdf } from '../../core/src/tools/merge-pdf/index.js';
export { getCodec } from '../../core/src/lib/codecs.js';

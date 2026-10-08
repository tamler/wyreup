// ExcelJS uses these APIs for worksheet protection. Algorithms are supplied
// by create-hash; randomness uses the browser's cryptographic generator.
exports.createHash = require('create-hash');
exports.randomBytes = require('randombytes');
exports.getHashes = () => ['md5', 'rmd160', 'ripemd160', 'sha', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512'];

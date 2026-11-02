'use strict';

// Temporary CVE-2026-111497 mitigation for Electron's bundled Node runtime.
// Load before networking modules in every Node process. A patched decoder
// exposes FORMAT_BLOCK_SWITCH (-17), so the mitigation retires automatically.
const zlib = require('node:zlib');
if (zlib.constants.BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH !== -17) {
  const blockedError = function () {
    const error = new Error('Brotli decoding disabled until this runtime includes the CVE-2026-111497 fix');
    error.code = 'ERR_BROTLI_SECURITY_BLOCKED';
    return error;
  };
  const { Transform } = require('node:stream');
  class BlockedBrotliDecompress extends Transform {
    _transform(chunk, encoding, callback) { setImmediate(callback, blockedError()); }
    _flush(callback) { setImmediate(callback, blockedError()); }
  }
  const replacements = {
    BrotliDecompress: BlockedBrotliDecompress,
    createBrotliDecompress: () => new BlockedBrotliDecompress(),
    brotliDecompress: (...args) => {
      const callback = args.at(-1);
      if (typeof callback !== 'function') throw blockedError();
      process.nextTick(callback, blockedError());
    },
    brotliDecompressSync: () => { throw blockedError(); },
  };
  for (const [name, value] of Object.entries(replacements)) {
    Object.defineProperty(zlib, name, { value, configurable: true, writable: true, enumerable: true });
  }
  require('node:module').syncBuiltinESMExports();
  // Request uncompressed responses; a server ignoring this still cannot reach
  // the vulnerable decoder through Node's fetch implementation.
  const originalFetch = globalThis.fetch;
  if (originalFetch) globalThis.fetch = function (input, init) {
    const headers = new Headers(init?.headers ?? input?.headers);
    headers.set('accept-encoding', 'identity');
    return originalFetch(input, { ...init, headers });
  };
}

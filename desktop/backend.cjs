// Utility processes use CommonJS entrypoints; the existing server is an ES module.
import('../server.js').catch(error => {
  process.parentPort?.postMessage({ type: 'startup-error', message: error.message });
  console.error(error);
  process.exit(1);
});

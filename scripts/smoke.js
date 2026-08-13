'use strict';

/**
 * Smoke test for the DSH launcher used by Electron's main process.
 * Boots the server, checks the UI responds with HTTP 200, then shuts down.
 *
 * Usage:
 *   node scripts/smoke.js                # uses ~/.dsh (or inherited DSH_HOME)
 *   DSH_HOME=<tmpdir> node scripts/smoke.js   # validate fresh-home bootstrap
 */

const http = require('node:http');
const { startServer } = require('../lib/server');

function get(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', () => resolve(null));
  });
}

(async () => {
  const server = await startServer({
    dshHome: process.env.DSH_HOME || undefined,
    port: 0,
  });
  console.log(`SMOKE url  = ${server.url}`);
  const status = await get(server.url);
  console.log(`SMOKE GET  = ${status}`);
  server.stop();
  if (status !== 200) {
    console.error('SMOKE FAILED: expected HTTP 200');
    process.exit(1);
  }
  console.log('SMOKE ok');
})().catch((error) => {
  console.error('SMOKE FAILED:', error && (error.stderr || error.message) || error);
  process.exit(1);
});

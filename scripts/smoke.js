'use strict';

/**
 * Smoke test for the DSH launcher used by Electron's main process.
 * Boots the server, completes the browser-token exchange (0.1.2-rc.1+ mints a
 * signed cookie from the `?token=` URL), verifies the UI loads, then shuts
 * down.
 *
 * Usage:
 *   node scripts/smoke.js                # uses ~/.dsh (or inherited DSH_HOME)
 *   DSH_HOME=<tmpdir> node scripts/smoke.js   # validate fresh-home bootstrap
 */

const http = require('node:http');
const { startServer } = require('../lib/server');

function get(url, headers) {
  return new Promise((resolve) => {
    const req = http.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({ status: res.statusCode, setCookie: res.headers['set-cookie'] });
      });
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

  // DSH 0.1.2-rc.1+ authenticates via a launch token in the URL: `GET /?token=`
  // mints a signed cookie and redirects to the clean root. Exchange the token,
  // then load the UI with the cookie.
  const exchange = await get(server.url);
  const cookie = exchange && exchange.setCookie && exchange.setCookie.length ? exchange.setCookie[0].split(';')[0] : '';
  const page = await get(new URL(server.url).origin + '/', cookie ? { Cookie: cookie } : {});

  server.stop();
  if (!page || page.status !== 200) {
    console.error(`SMOKE FAILED: expected HTTP 200 after token exchange, got ${page && page.status}`);
    process.exit(1);
  }
  console.log('SMOKE ok');
})().catch((error) => {
  console.error('SMOKE FAILED:', error && (error.stderr || error.message) || error);
  process.exit(1);
});

'use strict';

/**
 * Stable-port selection for the DSH Web server.
 *
 * DSH embeds the Web URL (including the port) into its system prompt
 * (`app:web-surface`), so a changing port changes the prompt and defeats LLM
 * prompt caching for continued sessions. We therefore prefer a fixed port and
 * only fall back to an OS-assigned port when the preferred ones are taken.
 *
 * Strategy: reuse the port saved from the last successful run, then the
 * official `dsh web` default (3080), then port 0 (let the OS choose). The
 * chosen port is persisted under `dataDir` (Electron's userData directory) so
 * it stays stable across restarts without polluting the shared `~/.dsh`.
 */

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

/** Official `dsh web` default listen port. */
const PREFERRED_PORT = 3080;

const FILENAME = 'port.json';

function portFilePath(dataDir) {
  return path.join(dataDir, FILENAME);
}

/** Parse the numeric port out of a `http://127.0.0.1:<port>` URL. */
function extractPort(url) {
  try {
    const port = Number(new URL(url).port);
    return Number.isInteger(port) && port > 0 ? port : 0;
  } catch {
    return 0;
  }
}

function readSavedPort(dataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(portFilePath(dataDir), 'utf8'));
    const port = Number(parsed && parsed.port);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

/** Persist the port in `url` for the next run (best-effort). */
function savePort(dataDir, url) {
  const port = extractPort(url);
  if (!port) return;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(portFilePath(dataDir), JSON.stringify({ port }, null, 2) + '\n');
  } catch {
    /* persistence is best-effort */
  }
}

/** Resolve true when the loopback port can be bound, false when it is taken. */
function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

/**
 * Pick a listen port: saved port first, then the official default, then 0.
 * @param {string} dataDir - directory holding the persisted port state.
 * @returns {Promise<number>}
 */
async function choosePort(dataDir) {
  const saved = readSavedPort(dataDir);
  const candidates = [...new Set([saved, PREFERRED_PORT].filter((p) => p !== null && p !== undefined))];
  for (const port of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(port)) return port;
  }
  return 0;
}

module.exports = { PREFERRED_PORT, choosePort, savePort, extractPort, isPortFree };

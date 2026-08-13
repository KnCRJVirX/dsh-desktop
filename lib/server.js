'use strict';

/**
 * DSH web-server launcher shared by the Electron main process and the smoke
 * test. It boots the bundled `@deepseek-ai/dsh` CLI (`web` profile) bound to
 * the loopback interface, discovers the assigned URL from its stdout, waits
 * until the UI actually responds, and exposes a `stop()`.
 *
 * The DSH `web` profile self-initializes `$DSH_HOME` on first run (profile
 * templates + module-fallback junctions), so the in-box bundles need neither
 * pnpm nor network — only the dsh installation itself.
 */

const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');

const URL_PATTERN = /dsh web:\s+(https?:\/\/\S+)/;
const DEFAULT_READY_TIMEOUT_MS = 90_000;

/**
 * Resolve the absolute path of the dsh CLI entry (`lib/bin.js`).
 * Priority: DSH_BIN override, then the project's own node_modules, then a
 * profile-local / npx-cache fallback for development convenience.
 */
function resolveDshBin() {
  if (process.env.DSH_BIN) return process.env.DSH_BIN;

  const req = createRequire(__filename);
  try {
    return req.resolve('@deepseek-ai/dsh/lib/bin.js');
  } catch {
    /* fall through to filesystem fallbacks */
  }

  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  const candidates = [
    path.join(home, 'profiles', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  throw new Error(
    'Cannot locate @deepseek-ai/dsh. Run `npm install` in the project, or set DSH_BIN to the absolute path of its lib/bin.js.'
  );
}

/**
 * Resolve a Node.js runtime that can execute the DSH CLI.
 * Priority: DSH_NODE override, then the bundled portable Node (packaged apps
 * carry `resources/node/node.exe`; the dev checkout carries `vendor/node`),
 * then system `node` from PATH, then Electron's bundled Node as a last resort
 * (ELECTRON_RUN_AS_NODE — native modules may need an ABI rebuild for it).
 */
function resolveNode() {
  if (process.env.DSH_NODE) {
    return { command: process.env.DSH_NODE, extraEnv: {} };
  }

  const bundledCandidates = [];
  if (process.resourcesPath) {
    bundledCandidates.push(path.join(process.resourcesPath, 'node', 'node.exe'));
  }
  bundledCandidates.push(path.join(__dirname, '..', 'vendor', 'node', 'node.exe'));
  for (const candidate of bundledCandidates) {
    if (fs.existsSync(candidate)) {
      return { command: candidate, extraEnv: {} };
    }
  }

  const probe = spawnSync('node', ['-e', 'process.stdout.write(process.execPath)'], {
    encoding: 'utf8',
    timeout: 5000,
    windowsHide: true,
  });
  if (!probe.error && probe.status === 0 && probe.stdout && probe.stdout.trim()) {
    return { command: probe.stdout.trim(), extraEnv: {} };
  }

  return { command: process.execPath, extraEnv: { ELECTRON_RUN_AS_NODE: '1' } };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Perform one HTTP GET and resolve to the status code (or null on failure). */
function request(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

/** Poll the served URL until it answers, or the deadline passes. */
async function waitUntilReady(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await request(url)) != null) return true;
    await sleep(250);
  }
  return false;
}

/**
 * Boot the DSH web server.
 * @param {object} [opts]
 * @param {string} [opts.dshHome]  Overrides DSH_HOME for the child (defaults to inherited env).
 * @param {string} [opts.host]     Bind host (default 127.0.0.1).
 * @param {number} [opts.port]     Listen port; 0 lets the OS pick a free one (default 0).
 * @param {number} [opts.readyTimeoutMs]
 * @returns {Promise<{url:string, child:import('node:child_process').ChildProcess, stdout:()=>string, stderr:()=>string, stop:()=>void}>}
 */
async function startServer(opts = {}) {
  const {
    dshHome,
    host = '127.0.0.1',
    port = 0,
    readyTimeoutMs = DEFAULT_READY_TIMEOUT_MS,
  } = opts;

  const node = resolveNode();
  const bin = resolveDshBin();
  const args = [bin, 'web', '--host', host, '--port', String(port)];

  const env = { ...process.env, ...node.extraEnv };
  if (dshHome) env.DSH_HOME = dshHome;

  const child = spawn(node.command, args, {
    env,
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  });

  let stdout = '';
  let stderr = '';
  let exitInfo = null;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.once('exit', (code, signal) => {
    exitInfo = { code, signal };
  });

  const deadline = Date.now() + readyTimeoutMs;
  let url = null;
  while (Date.now() < deadline && !exitInfo) {
    const match = URL_PATTERN.exec(stdout);
    if (match) {
      url = match[1];
      break;
    }
    await sleep(200);
  }

  if (url) {
    // The URL line is printed after the loader settles; confirm the UI answers.
    const ready = await waitUntilReady(url, readyTimeoutMs);
    if (!ready) console.warn(`[dsh-desktop] server printed ${url} but has not answered yet`);
  }

  if (!url) {
    child.kill();
    const tail = (stderr || stdout || '').split('\n').slice(-30).join('\n');
    const error = new Error(`DSH web server failed to start.${tail ? `\n--- output ---\n${tail}` : ''}`);
    error.stderr = stderr;
    error.stdout = stdout;
    throw error;
  }

  return {
    url,
    child,
    stdout: () => stdout,
    stderr: () => stderr,
    stop() {
      try {
        if (child.exitCode === null) child.kill();
      } catch {
        /* already gone */
      }
    },
  };
}

module.exports = { startServer, resolveDshBin, resolveNode };

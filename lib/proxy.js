'use strict';

/**
 * Bridge the Windows system (WinINET) proxy into the environment DSH reads.
 *
 * DSH's proxy support (`@deepseek-ai/dsh-http-proxy`) deliberately reads only
 * the standard proxy environment variables — upstream does not probe OS proxy
 * settings at all ("不会读取 macOS 或 Windows 的系统代理设置"). A desktop launch
 * therefore starts with no proxy configured, which is why `web_fetch` and the
 * other outbound callers bypass a machine-wide proxy.
 *
 * This module forwards the machine's configured proxy to the DSH child process
 * as the environment variables DSH does read:
 *   `http_proxy` / `HTTP_PROXY`, `https_proxy` / `HTTPS_PROXY`,
 *   `no_proxy` / `NO_PROXY`.
 *
 * Precedence: an explicitly set proxy variable always wins — the system proxy
 * is only forwarded when the user has not configured one. Set
 * `DSH_DESKTOP_NO_SYSTEM_PROXY=1` to disable the bridge entirely.
 */

const { execFileSync } = require('node:child_process');

/** WinINET proxy settings live in this per-user key. */
const INTERNET_SETTINGS = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

/** Hosts DSH already bypasses; kept here so child tools match the same list. */
const LOOPBACK = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];

/** Every environment name that carries proxy configuration. */
const PROXY_ENV_NAMES = ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY'];

/** Schemes `@deepseek-ai/dsh-http-proxy` accepts; anything else is dropped. */
const SUPPORTED_PROXY_PROTOCOLS = new Set(['http:', 'https:']);

/** Disable the bridge with any non-empty value. */
const DISABLE_ENV = 'DSH_DESKTOP_NO_SYSTEM_PROXY';

/** Read one registry value as text, or undefined when absent/unreadable. */
function readRegistryValue(name) {
  try {
    const output = execFileSync('reg', ['query', INTERNET_SETTINGS, '/v', name], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = /REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/m.exec(output);
    const raw = match ? match[1] : undefined;
    return raw === undefined || raw === '' ? undefined : raw;
  } catch {
    return undefined;
  }
}

/** Read the `ProxyEnable` switch, treating any unreadable value as disabled. */
function readProxyEnable() {
  try {
    const output = execFileSync('reg', ['query', INTERNET_SETTINGS, '/v', 'ProxyEnable'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = /REG_DWORD\s+0x([0-9a-f]+)/i.exec(output);
    return match ? Number.parseInt(match[1], 16) === 1 : false;
  } catch {
    return false;
  }
}

/**
 * Normalize a WinINET `ProxyServer` value into per-scheme proxy URLs.
 *
 * Accepts both the single form (`127.0.0.1:10808`) and the per-scheme form
 * (`http=127.0.0.1:10808;https=127.0.0.1:10808`). A bare `host:port` without a
 * scheme is read as `http://` — the WinINET convention. Unsupported protocols
 * (SOCKS, PAC) yield `undefined` for that scheme so DSH keeps connecting
 * directly rather than being handed a value it would reject.
 *
 * @param {string} raw - the registry value.
 * @returns {{http?: string, https?: string}}
 */
function normalizeProxyServer(raw) {
  const byScheme = new Map();
  let fallback;
  for (const entry of String(raw).split(';')) {
    const trimmed = entry.trim();
    if (trimmed === '') continue;
    const assignment = /^([a-z][a-z0-9+.-]*)=(.*)$/i.exec(trimmed);
    if (assignment === null) {
      fallback = trimmed;
      continue;
    }
    byScheme.set(assignment[1].toLowerCase(), assignment[2].trim());
  }

  const asUrl = (value) => {
    if (value === undefined || value === '') return undefined;
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
    try {
      return SUPPORTED_PROXY_PROTOCOLS.has(new URL(candidate).protocol) ? candidate : undefined;
    } catch {
      return undefined;
    }
  };

  const http = asUrl(byScheme.get('http') ?? fallback);
  const https = asUrl(byScheme.get('https') ?? fallback);
  const result = {};
  if (http !== undefined) result.http = http;
  if (https !== undefined) result.https = https;
  return result;
}

/**
 * Build a `no_proxy` list from the WinINET `ProxyOverride` value.
 *
 * `<local>` is a WinINET token rather than a host, so it is expanded to the
 * loopback literals. Entries carrying `/` (CIDR ranges such as `10.0.0.0/8`)
 * are dropped: the DSH matcher cannot express a range, and passing them
 * through would only produce entries that never match.
 *
 * @param {string} [override] - the registry value.
 * @returns {string} comma-separated bypass list.
 */
function buildNoProxy(override) {
  const entries = [...LOOPBACK];
  const seen = new Set(entries);
  for (const entry of String(override ?? '').split(';')) {
    const trimmed = entry.trim();
    if (trimmed === '' || trimmed === '*') continue;
    if (trimmed.toLowerCase() === '<local>') continue; // already covered by LOOPBACK
    if (trimmed.includes('/')) continue; // CIDR: not expressible as a bypass entry
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    entries.push(trimmed);
  }
  return entries.join(',');
}

/**
 * Read the machine's WinINET proxy configuration.
 * @returns {{proxy: {http?: string, https?: string}, override?: string}|null}
 *   `null` when no proxy is enabled or the settings are unreadable.
 */
function readWindowsSystemProxy() {
  if (process.platform !== 'win32') return null;
  if (!readProxyEnable()) return null;
  const server = readRegistryValue('ProxyServer');
  if (server === undefined) return null;
  const proxy = normalizeProxyServer(server);
  if (proxy.http === undefined && proxy.https === undefined) return null;
  return { proxy, override: readRegistryValue('ProxyOverride') };
}

/**
 * Forward the system proxy into a child-process environment, in place.
 *
 * Does nothing when the user already configured a proxy variable (their
 * explicit choice wins), when the bridge is disabled, or when no system proxy
 * is enabled.
 *
 * @param {Record<string, string|undefined>} env - environment to mutate.
 * @returns {{applied: boolean, reason: string, proxy?: string, noProxy?: string}}
 */
function applySystemProxy(env) {
  if ((process.env[DISABLE_ENV] ?? '') !== '') return { applied: false, reason: 'disabled' };
  if (PROXY_ENV_NAMES.some((name) => (env[name] ?? '') !== '')) return { applied: false, reason: 'explicit' };

  const system = readWindowsSystemProxy();
  if (system === null) return { applied: false, reason: 'none' };

  const { proxy, override } = system;
  if (proxy.http !== undefined) {
    env.http_proxy = proxy.http;
    env.HTTP_PROXY = proxy.http;
  }
  if (proxy.https !== undefined) {
    env.https_proxy = proxy.https;
    env.HTTPS_PROXY = proxy.https;
  }
  const noProxy = buildNoProxy(override);
  env.no_proxy = noProxy;
  env.NO_PROXY = noProxy;

  return { applied: true, reason: 'system', proxy: proxy.https ?? proxy.http, noProxy };
}

module.exports = {
  applySystemProxy,
  buildNoProxy,
  normalizeProxyServer,
  readWindowsSystemProxy,
  DISABLE_ENV,
  PROXY_ENV_NAMES,
};

import http from 'node:http';
import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadTargets, validateTargets } from './config.mjs';
import { DEFAULT_POLICY, normalizeSignal, publicTarget, unknownPacket } from './normalize.mjs';

export const UPSTREAM_URL = 'https://t-data.seoul.go.kr/apig/apiman-gateway/tapi/v2xSignalPhaseTimingFusionCurrentInfo/1.0';
const DEFAULT_WEB_ROOT = fileURLToPath(new URL('../web/', import.meta.url));
const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webp': 'image/webp',
});

function securityHeaders(response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
}

function json(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  const text = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text) });
  response.end(text);
}

/** Fixed-size buckets: no unbounded IP-key cache and no timer retaining the process. */
export function createRateLimiter({ windowMs = 60_000, perClientLimit = 90, globalLimit = 300, maxClients = 128 } = {}) {
  const clients = new Map();
  let globalStart = 0;
  let globalCount = 0;
  return (address, nowMs) => {
    if (!globalStart || nowMs - globalStart >= windowMs || nowMs < globalStart) {
      globalStart = nowMs;
      globalCount = 0;
    }
    if (++globalCount > globalLimit) return false;
    for (const [key, value] of clients) if (nowMs - value.start >= windowMs || nowMs < value.start) clients.delete(key);
    let bucket = clients.get(address);
    if (!bucket) {
      if (clients.size >= maxClients) return false;
      bucket = { start: nowMs, count: 0 };
      clients.set(address, bucket);
    }
    return ++bucket.count <= perClientLimit;
  };
}

class SafeUpstreamError extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

async function readLimitedJson(response, maxBytes) {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes)) {
    await response.body?.cancel().catch(() => {});
    throw new SafeUpstreamError('upstream-invalid');
  }
  if (!response.body?.getReader) throw new SafeUpstreamError('upstream-invalid');
  const reader = response.body.getReader();
  let total = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new SafeUpstreamError('upstream-invalid');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new SafeUpstreamError('upstream-invalid'); }
}

function createUpstream({ fetchImpl, apiKey, timeoutMs, maxBytes, maxConcurrent = 8 }) {
  const inFlight = new Map();
  return async (target) => {
    if (inFlight.has(target.intersectionId)) return inFlight.get(target.intersectionId);
    if (inFlight.size >= maxConcurrent) throw new SafeUpstreamError('upstream-unavailable');
    const operation = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const upstream = new URL(UPSTREAM_URL);
      // Every field is selected by this server, never copied from the browser query.
      upstream.searchParams.set('apikey', apiKey);
      upstream.searchParams.set('itstId', target.intersectionId);
      upstream.searchParams.set('type', 'json');
      upstream.searchParams.set('pageNo', '1');
      upstream.searchParams.set('numOfRows', '10');
      try {
        const response = await fetchImpl(upstream, {
          method: 'GET', redirect: 'error', signal: controller.signal,
          headers: { Accept: 'application/json' }, cache: 'no-store',
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw new SafeUpstreamError('upstream-unavailable');
        }
        return await readLimitedJson(response, maxBytes);
      } catch (error) {
        if (controller.signal.aborted) throw new SafeUpstreamError('upstream-timeout');
        if (error instanceof SafeUpstreamError) throw error;
        // fetch errors may contain the credential-bearing URL. Do not relay/log them.
        throw new SafeUpstreamError('upstream-unavailable');
      } finally { clearTimeout(timeout); }
    })();
    inFlight.set(target.intersectionId, operation);
    try { return await operation; }
    finally { inFlight.delete(target.intersectionId); }
  };
}

async function staticFile(request, response, pathname, webRoot) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch { json(response, 400, { error: 'invalid-request' }); return; }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some(part => part.startsWith('.'))) {
    json(response, 404, { error: 'not-found' }); return;
  }
  const requested = decoded === '/' ? '/index.html' : decoded;
  try {
    const root = await realpath(webRoot);
    const filename = await realpath(path.resolve(root, `.${requested}`));
    const relative = path.relative(root, filename);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('outside-web-root');
    const info = await stat(filename);
    if (!info.isFile() || info.size > 4 * 1024 * 1024 || !Object.hasOwn(MIME, path.extname(filename))) throw new Error('not-static-file');
    const data = await readFile(filename);
    response.writeHead(200, { 'Content-Type': MIME[path.extname(filename)], 'Content-Length': data.byteLength });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch { json(response, 404, { error: 'not-found' }); }
}

export async function createSignalServer(options = {}) {
  const registry = options.targetRegistry === undefined
    ? await loadTargets(options.targetsFile)
    : validateTargets(options.targetRegistry);
  const apiKey = typeof options.apiKey === 'string' ? options.apiKey.trim() : '';
  const now = options.now || Date.now;
  const policy = DEFAULT_POLICY;
  const rateLimit = createRateLimiter(options.rateLimit);
  const fetchUpstream = createUpstream({
    fetchImpl: options.fetchImpl || globalThis.fetch,
    apiKey, timeoutMs: options.upstreamTimeoutMs ?? 2_000,
    maxBytes: options.maxUpstreamBytes ?? 256 * 1024,
  });
  const configuredOrigin = options.publicOrigin ? new URL(options.publicOrigin).origin : null;
  const server = http.createServer(async (request, response) => {
    securityHeaders(response);
    const port = server.address()?.port;
    const allowedOrigins = configuredOrigin ? [configuredOrigin] : [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];
    const ownOrigin = `http://${request.headers.host || ''}`;
    if (!allowedOrigins.includes(ownOrigin) && !(configuredOrigin && request.headers.host === new URL(configuredOrigin).host)) {
      json(response, 403, { error: 'origin-not-allowed' }); return;
    }
    if ((request.headers.origin && !allowedOrigins.includes(request.headers.origin)) || request.headers['sec-fetch-site'] === 'cross-site') {
      json(response, 403, { error: 'origin-not-allowed' }); return;
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD'); json(response, 405, { error: 'method-not-allowed' }); return;
    }
    if ((request.headers['content-length'] && request.headers['content-length'] !== '0') || request.headers['transfer-encoding']) {
      json(response, 400, { error: 'invalid-request' }); return;
    }
    if (request.url.length > 1024) { json(response, 414, { error: 'invalid-request' }); return; }
    let url;
    try { url = new URL(request.url, allowedOrigins[0]); }
    catch { json(response, 400, { error: 'invalid-request' }); return; }
    if (!url.pathname.startsWith('/api/')) {
      await staticFile(request, response, url.pathname, options.webRoot || DEFAULT_WEB_ROOT); return;
    }
    if (!rateLimit(request.socket.remoteAddress || 'unknown', now())) {
      response.setHeader('Retry-After', '60'); json(response, 429, unknownPacket(null, 'rate-limited', now())); return;
    }
    if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); json(response, 405, { error: 'method-not-allowed' }); return; }
    if (url.pathname === '/api/health' && url.search === '') {
      const targets = [...registry.values()].filter(target => target.verified).map(publicTarget);
      json(response, 200, {
        ok: true, service: 'signal-drive', schemaVersion: 1, keyConfigured: Boolean(apiKey),
        configuredTargetCount: registry.size, verifiedTargetCount: targets.length, targets,
        policy: { maxSourceAgeMs: policy.maxSourceAgeMs, maxFutureSkewMs: policy.maxFutureSkewMs },
      }); return;
    }
    if (url.pathname !== '/api/signal') { json(response, 404, { error: 'not-found' }); return; }
    if ([...url.searchParams.keys()].some(key => key !== 'target') || url.searchParams.getAll('target').length !== 1 || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(url.searchParams.get('target') || '')) {
      json(response, 400, unknownPacket(null, 'invalid-request', now())); return;
    }
    const target = registry.get(url.searchParams.get('target'));
    if (!target) { json(response, 200, unknownPacket(null, 'target-not-configured', now())); return; }
    if (!target.verified) { json(response, 200, unknownPacket(target, 'mapping-unverified', now())); return; }
    if (!apiKey) { json(response, 200, unknownPacket(target, 'api-key-missing', now())); return; }
    try {
      const data = await fetchUpstream(target);
      json(response, 200, normalizeSignal(data, target, now(), policy));
    } catch (error) {
      json(response, 200, unknownPacket(target, error instanceof SafeUpstreamError ? error.reason : 'upstream-unavailable', now()));
    }
  });
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 40;
  return server;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createSignalServer, UPSTREAM_URL, createRateLimiter } from '../server/server.mjs';

const NOW = 1_793_838_000_000;
const registry = [{ id: 'synthetic-test', label: '합성 테스트 전용', intersectionId: '20386', approach: 'NW', movement: 'STRAIGHT', mappingVersion: 'test-1', verified: true, verificationEvidence: 'mock evidence only', verifiedAt: '2026-11-05T00:00:00Z' }];
const row = { itstId: '20386', trsmUtcTime: NOW - 200, nwStsgStatNm: 'protected-Movement-Allowed', nwStsgRmdrCs: 100 };

async function app(t, options = {}) {
  const server = await createSignalServer({ targetRegistry: [], now: () => NOW, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, get: async (route, headers) => {
    const response = await fetch(base + route, { headers });
    const body = await response.json();
    return { response, body };
  } };
}

test('기본 registry는 비어 있으며 임의 대상·클라이언트 키로 실시간을 열 수 없다', async t => {
  let calls = 0;
  const { get } = await app(t, { fetchImpl: async () => { calls++; throw new Error('must-not-call'); } });
  const health = await get('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.keyConfigured, false);
  assert.deepEqual(health.body.targets, []);
  const missing = await get('/api/signal?target=synthetic-test');
  assert.equal(missing.body.reason, 'target-not-configured');
  assert.equal(missing.body.phase, null);
  const bad = await get('/api/signal?target=synthetic-test&apikey=browser-test-key');
  assert.equal(bad.response.status, 400);
  assert.equal(bad.body.reason, 'invalid-request');
  assert.equal(calls, 0);
});

test('키 누락과 미승인 매핑은 요청 이전에 차단한다', async t => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return Response.json([row]); };
  const noKey = await app(t, { targetRegistry: registry, fetchImpl });
  assert.equal((await noKey.get('/api/signal?target=synthetic-test')).body.reason, 'api-key-missing');
  const held = await app(t, { targetRegistry: [{ ...registry[0], verified: false }], apiKey: 'DUMMY-ONLY', fetchImpl });
  assert.equal((await held.get('/api/signal?target=synthetic-test')).body.reason, 'mapping-unverified');
  assert.equal(calls, 0);
});

test('고정 원천·서버 키·정확 ID로만 요청하며 브라우저에 키를 돌려주지 않는다', async t => {
  let request;
  const { get } = await app(t, { targetRegistry: registry, apiKey: 'DUMMY-ONLY', fetchImpl: async (url, options) => {
    request = { url, options };
    return Response.json([row]);
  } });
  const { response, body } = await get('/api/signal?target=synthetic-test');
  assert.equal(body.status, 'verified');
  assert.equal(body.target.approach, 'NW');
  assert.equal(body.expiresAtMs - NOW, 9800);
  assert.equal(request.url.origin + request.url.pathname, UPSTREAM_URL);
  assert.equal(request.url.searchParams.get('itstId'), '20386');
  assert.equal(request.url.searchParams.get('apikey'), 'DUMMY-ONLY');
  assert.equal(request.options.redirect, 'error');
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  assert.equal(JSON.stringify(body).includes('DUMMY-ONLY'), false);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('upstream 오류·schema 오류·큰 응답에서는 색과 숫자를 숨긴다', async t => {
  for (const variant of [
    { fetchImpl: async () => { throw new Error('url?apikey=DUMMY-ONLY'); }, reason: 'upstream-unavailable' },
    { fetchImpl: async () => new Response('failure', { status: 503 }), reason: 'upstream-unavailable' },
    { fetchImpl: async () => new Response('<not-json>'), reason: 'upstream-invalid' },
    { fetchImpl: async () => Response.json({ error: 'unavailable' }), reason: 'upstream-invalid' },
    { fetchImpl: async () => new Response('a'.repeat(100)), maxUpstreamBytes: 20, reason: 'upstream-invalid' },
  ]) {
    const { get } = await app(t, { targetRegistry: registry, apiKey: 'DUMMY-ONLY', ...variant });
    const { body } = await get('/api/signal?target=synthetic-test');
    assert.equal(body.status, 'unknown');
    assert.equal(body.reason, variant.reason);
    assert.equal(body.phase, null);
    assert.equal(body.remainingDeciseconds, null);
    assert.equal(JSON.stringify(body).includes('DUMMY-ONLY'), false);
  }
});

test('upstream 요청을 제한 시간에 취소하고 다음 요청에서 복구한다', async t => {
  let calls = 0;
  const { get } = await app(t, {
    targetRegistry: registry, apiKey: 'DUMMY-ONLY', upstreamTimeoutMs: 25,
    fetchImpl: async (_, { signal }) => {
      if (++calls > 1) return Response.json([row]);
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }));
    },
  });
  assert.equal((await get('/api/signal?target=synthetic-test')).body.reason, 'upstream-timeout');
  assert.equal((await get('/api/signal?target=synthetic-test')).body.status, 'verified');
});

test('동일 교차로의 동시 요청은 하나의 upstream 요청을 공유한다', async t => {
  let calls = 0;
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const { get } = await app(t, { targetRegistry: registry, apiKey: 'DUMMY-ONLY', fetchImpl: async () => {
    calls++; await ready; return Response.json([row]);
  } });
  const a = get('/api/signal?target=synthetic-test');
  const b = get('/api/signal?target=synthetic-test');
  await new Promise(resolve => setTimeout(resolve, 20));
  release();
  const values = await Promise.all([a, b]);
  assert.equal(calls, 1);
  assert.ok(values.every(value => value.body.status === 'verified'));
});

test('cross-origin과 외부 Host 요청은 차단하고 키 관련 query를 전달하지 않는다', async t => {
  const { get, base } = await app(t);
  assert.equal((await get('/api/health', { Origin: 'https://unrelated.example' })).response.status, 403);
  // Fetch normalizes Host itself; use an actual HTTP request to verify rebinding protection.
  const hostStatus = await new Promise((resolve, reject) => {
    http.get(base + '/api/health', { headers: { Host: 'unrelated.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(hostStatus, 403);
  assert.equal((await get('/api/health', { 'Sec-Fetch-Site': 'cross-site' })).response.status, 403);
});

test('호출량 제한이 적용되며 윈도우 만료 후 복구한다', async t => {
  const { get } = await app(t, { rateLimit: { perClientLimit: 1 } });
  assert.equal((await get('/api/health')).response.status, 200);
  const limited = await get('/api/health');
  assert.equal(limited.response.status, 429);
  assert.equal(limited.body.reason, 'rate-limited');
  const limit = createRateLimiter({ windowMs: 100, perClientLimit: 1, maxClients: 1 });
  assert.equal(limit('one', NOW), true);
  assert.equal(limit('two', NOW), false);
  assert.equal(limit('two', NOW + 101), true);
});

test('web 폴더 정적 파일만 적절한 MIME으로 제공하고 symlink·경로 이탈을 차단한다', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'signal-server-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const webRoot = path.join(temporary, 'web');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(webRoot);
  await writeFile(path.join(webRoot, 'index.html'), '<!doctype html><title>test</title>');
  await writeFile(path.join(webRoot, 'app.mjs'), 'export const value=1;');
  await writeFile(path.join(temporary, 'private.json'), '{"private":true}');
  await symlink(path.join(temporary, 'private.json'), path.join(webRoot, 'leak.json'));
  const { base } = await app(t, { webRoot });
  assert.equal((await fetch(base + '/')).status, 200);
  assert.match((await fetch(base + '/app.mjs')).headers.get('content-type'), /javascript/);
  assert.equal((await fetch(base + '/leak.json')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e/private.json')).status, 404);
  assert.equal((await fetch(base + '/.env')).status, 404);
});

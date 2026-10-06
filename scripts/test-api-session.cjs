const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { webcrypto } = require('node:crypto');

const localRequire = createRequire(path.resolve(__dirname, '../frontend/package.json'));
const ts = localRequire('typescript');
const axios = localRequire('axios');
const source = fs.readFileSync(path.resolve(__dirname, '../frontend/src/lib/api.ts'), 'utf8')
  .replace('import.meta.env.VITE_API_BASE_URL', 'undefined');

function harness() {
  const values = new Map([['sentinel_access_token', 'old-token'], ['sentinel_refresh_token', 'refresh'], ['sentinel_demo_session', 'true']]);
  const events = [];
  const module = { exports: {} };
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compiled, { module, exports: module.exports, require: localRequire, crypto: webcrypto,
    CustomEvent: class { constructor(type) { this.type = type; } },
    window: { sessionStorage: { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key) },
      dispatchEvent: event => events.push(event.type) } });
  return { api: module.exports.api, values, events };
}

function reject(config, status) {
  return Promise.reject(new axios.AxiosError('test response', undefined, config, undefined, { status, data: {}, headers: {}, config }));
}

test('current-session 401 clears credentials and authenticated marker once', async () => {
  const { api, values, events } = harness();
  api.defaults.adapter = config => reject(config, 401);
  await assert.rejects(api.get('/workspace'));
  assert.equal(values.size, 0);
  assert.deepEqual(events, ['sentinel:auth-expired']);
});

test('late 401 from a previous token preserves a fresh login', async () => {
  const { api, values, events } = harness();
  api.defaults.adapter = config => { values.set('sentinel_access_token', 'new-token'); return reject(config, 401); };
  await assert.rejects(api.get('/workspace'));
  assert.equal(values.get('sentinel_access_token'), 'new-token');
  assert.deepEqual(events, []);
});

test('permission denial does not log out the current account', async () => {
  const { api, values, events } = harness();
  api.defaults.adapter = config => reject(config, 403);
  await assert.rejects(api.patch('/work-orders/test', {}));
  assert.equal(values.get('sentinel_access_token'), 'old-token');
  assert.deepEqual(events, []);
});

test('anonymous 401 does not emit a repeated expiry event', async () => {
  const { api, values, events } = harness();
  values.clear();
  api.defaults.adapter = config => reject(config, 401);
  await assert.rejects(api.get('/workspace'));
  assert.deepEqual(events, []);
});

test('each request carries its current token and a distinct trace identifier', async () => {
  const { api, values } = harness();
  const requests = [];
  api.defaults.adapter = config => { requests.push(config); return Promise.resolve({ status: 200, data: {}, headers: {}, config }); };
  await api.get('/workspace');
  values.set('sentinel_access_token', 'new-token');
  await api.get('/missions');
  assert.equal(requests[0].headers.Authorization, 'Bearer old-token');
  assert.equal(requests[1].headers.Authorization, 'Bearer new-token');
  assert.notEqual(requests[0].headers['X-Request-ID'], requests[1].headers['X-Request-ID']);
});

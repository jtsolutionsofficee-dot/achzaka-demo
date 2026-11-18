// End-to-end smoke test against a running server (it changes data: run it on a test DB, then reset).
//   BASE=http://127.0.0.1:4180 node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');

const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const jars = {};

async function call(who, method, path, body, extra = {}) {
  const headers = { ...(extra.headers || {}) };
  if (jars[who]) headers.cookie = jars[who];
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length && who) {
    const map = Object.fromEntries((jars[who] || '').split('; ').filter(Boolean).map((c) => c.split(/=(.*)/s).slice(0, 2)));
    for (const c of set) { const [kv] = c.split(';'); const [k, v] = kv.split(/=(.*)/s); if (v) map[k] = v; else delete map[k]; }
    jars[who] = Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ');
  }
  const buf = Buffer.from(await res.arrayBuffer());
  let json; try { json = JSON.parse(buf.toString('utf8')); } catch {}
  return { status: res.status, json, buf, type: res.headers.get('content-type') || '' };
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077' +
  '53de0000000c4944415408d763f8ffff3f0005fe02fea7d6a4ea0000000049454e44ae426082', 'hex');
const photoForm = (fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('photos', new Blob([PNG], { type: 'image/png' }), 'p.png');
  return fd;
};

test('health endpoints', async () => {
  const h = await call(null, 'GET', '/healthz');
  assert.equal(h.status, 200);
  assert.equal(h.json.ok, true);
  assert.equal((await call(null, 'GET', '/api/health')).status, 200);
});

test('password login per door', async () => {
  for (const [who, phone, password, door, role] of [
    ['dana', '050-100-0001', 'Dana2401', 'owner', 'customer'],
    ['eyal', '050-100-0003', 'Eyal2403', 'technician', 'employee'],
    ['ronit', '050-100-0006', 'Ronit2406', 'manager', 'manager'],
  ]) {
    const r = await call(who, 'POST', '/api/auth/login', { phone, password, door });
    assert.equal(r.status, 200, `${who} login`);
    assert.equal(r.json.user.role, role);
    assert.equal((await call(who, 'GET', '/api/me')).json.id, who);
  }
  assert.equal((await call('x', 'POST', '/api/auth/login', { phone: '050-100-0003', password: 'Eyal2403', door: 'manager' })).status, 403);
  assert.equal((await call('x', 'POST', '/api/auth/login', { phone: '050-100-0003', password: 'nope', door: 'technician' })).status, 401);
});

test('one-time code login (demo mode shows the code)', async (t) => {
  const r = await call('otp', 'POST', '/api/auth/otp/request', { phone: '050-100-0004' });
  if (r.status === 429) return t.skip('cooldown from an earlier run');
  assert.equal(r.status, 200);
  if (!r.json.code) return t.skip('server is not in demo mode, code goes by SMS');
  assert.equal((await call('otp', 'POST', '/api/auth/otp/verify', { phone: '050-100-0004', code: '000000', door: 'technician' })).status, 401);
  const v = await call('otp', 'POST', '/api/auth/otp/verify', { phone: '050-100-0004', code: r.json.code, door: 'technician' });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  assert.equal((await call('otp', 'POST', '/api/auth/otp/verify', { phone: '050-100-0004', code: r.json.code, door: 'technician' })).status, 401, 'code is single use');
});

test('starting state of the demo script', async () => {
  const rows = (await call('ronit', 'GET', '/api/calls')).json;
  const by = Object.fromEntries(rows.map((c) => [c.id, c]));
  assert.equal(by[2401].quote.status, 'pending');
  assert.equal(by[2401].sla.late, true);
  assert.equal(by[2402].assigneeId, 'eyal');
  assert.equal(by[2405].vendorName, 'קירור הצפון');
  assert.deepEqual((await call('eyal', 'GET', '/api/calls')).json.map((c) => c.id), [2402]);
  const firstDemo = rows.findIndex((c) => c.isDemo);
  assert.ok(firstDemo > 0 && rows.slice(firstDemo).every((c) => c.isDemo), 'demo history stays below live calls');
  assert.ok(rows.filter((c) => !c.isDemo).every((c) => c.id >= 2401), 'only live calls above the history');
});

test('owner opens a call with a photo; new id follows the sequence', async () => {
  const r = await call('dana', 'POST', '/api/calls', photoForm({ category: 'אינסטלציה', urgency: 'normal', description: 'בדיקת עשן אוטומטית', unit: 'חדר מכונות הבריכה' }));
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.ok(r.json.id > 2406, `new id ${r.json.id}`);
  const photos = [...(r.json.photos || []), ...(r.json.messages || []).flatMap((m) => m.photos || [])];
  assert.equal(photos.length, 1);
  const img = await fetch(BASE + photos[0].url);
  assert.equal(img.status, 200);
  const seen = (await call('ronit', 'GET', `/api/calls/${r.json.id}`)).json;
  assert.equal(seen.description, 'בדיקת עשן אוטומטית');
});

test('quote approval by the owner', async () => {
  const r = await call('dana', 'POST', '/api/calls/2401/quote/decision', { decision: 'approved' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.quote.status, 'approved');
  assert.equal((await call('dana', 'POST', '/api/calls/2401/quote/decision', { decision: 'approved' })).status, 400);
});

test('technician: navigation, dial, finish needs a photo', async () => {
  const c = (await call('eyal', 'GET', '/api/calls/2402')).json;
  assert.match(c.wazeUrl, /^https:\/\/www\.waze\.com\/ul\?q=/);
  assert.match(c.telUrl, /^tel:0\d+$/);
  assert.equal(c.canClose, false);
  assert.equal((await call('eyal', 'PATCH', '/api/calls/2402', { status: 'closed' })).status, 400);
  assert.equal((await call('eyal', 'PATCH', '/api/calls/2402', { status: 'done' })).status, 400);
  const up = await call('eyal', 'POST', '/api/calls/2402/messages', photoForm({ phase: 'after', body: 'סיום' }));
  assert.equal(up.status, 201);
  assert.equal(up.json.canClose, true);
  const done = await call('eyal', 'PATCH', '/api/calls/2402', { status: 'closed' });
  assert.equal(done.status, 200);
  assert.equal(done.json.status, 'closed');
  assert.equal((await call('eyal', 'GET', '/api/calls/2401')).status, 404, 'tech cannot see other calls');
});

test('manager screens answer', async () => {
  for (const p of ['/api/buildings', '/api/team', '/api/assets', '/api/maintenance', '/api/vendors', '/api/parts',
    '/api/contracts', '/api/reports', '/api/notifications', '/api/emails', '/api/sms', '/api/invoices', '/api/part-movements', '/api/users',
    '/api/buildings/sea/units']) {
    const r = await call('ronit', 'GET', p);
    assert.equal(r.status, 200, `${p} -> ${r.status} ${r.buf.toString().slice(0, 200)}`);
  }
  assert.equal((await call('ronit', 'GET', '/api/calls/notanumber')).status, 404);
  assert.equal((await call('dana', 'GET', '/api/home')).status, 200, 'owner home');
});

test('exports: Excel and PDF', async () => {
  const x = await call('ronit', 'GET', '/api/reports/calls.xlsx');
  assert.equal(x.status, 200);
  assert.equal(x.buf.subarray(0, 2).toString(), 'PK');
  const p = await call('ronit', 'GET', '/api/reports/calls.pdf');
  assert.equal(p.status, 200);
  assert.equal(p.buf.subarray(0, 5).toString(), '%PDF-');
});

test('logout ends the session', async () => {
  const before = jars.dana;
  assert.equal((await call('dana', 'DELETE', '/api/session')).status, 200);
  jars.dana = before;
  assert.equal((await call('dana', 'GET', '/api/me')).status, 204, 'no session: empty 204');
});

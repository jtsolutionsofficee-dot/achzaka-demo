// Diary (יומן) API. Changes data: run on a test server only.
//   BASE=http://127.0.0.1:4180 node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const jar = {};
async function call(who, method, path, body) {
  const headers = {};
  if (jar[who]) headers.cookie = jar[who];
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length) jar[who] = set.map((c) => c.split(';')[0]).join('; ');
  let json; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
const login = (who, phone, password, door) => call(who, 'POST', '/api/auth/login', { phone, password, door });

test('diary: rules generate visits, reassignment, role views', async () => {
  assert.equal((await login('m', '050-100-0006', 'Ronit2406', 'manager')).status, 200);
  assert.equal((await login('e', '050-100-0003', 'Eyal2403', 'technician')).status, 200);
  assert.equal((await login('c', '050-100-0001', 'Dana2401', 'owner')).status, 200);

  const week = await call('m', 'GET', '/api/schedule');
  assert.equal(week.status, 200);
  assert.equal(week.json.dayStarts.length, 7);
  assert.ok(week.json.visits.length > 0);
  assert.ok(week.json.visits.some((v) => !v.technicianId), 'has an unassigned visit');

  const bad = await call('m', 'POST', '/api/schedule/rules', { title: 'x' });
  assert.equal(bad.status, 400);
  const made = await call('m', 'POST', '/api/schedule/rules', { title: 'בדיקת בדיקה', buildingId: 'herzl', technicianId: 'michal', weekday: 5, time: '08:00', everyWeeks: 1, durationMin: 60 });
  assert.equal(made.status, 200);
  assert.ok(made.json.generated >= 5, 'weekly rule creates ~6 weeks of visits');

  const free = week.json.visits.find((v) => v.ruleId && v.technicianId !== 'eyal'); // not a call visit, so the call script is untouched
  const moved = await call('m', 'PATCH', `/api/visits/${free.id}`, { technicianId: 'eyal', startsAt: free.startsAt });
  assert.equal(moved.status, 200);
  const after = await call('m', 'GET', `/api/schedule?from=${week.json.from}`);
  assert.equal(after.json.visits.find((v) => v.id === free.id).technicianId, 'eyal');

  assert.equal((await call('e', 'PATCH', `/api/visits/${free.id}`, { technicianId: null })).status, 403);
  const mine = await call('e', 'GET', `/api/schedule?from=${week.json.from}`);
  assert.ok(mine.json.visits.length > 0 && mine.json.visits.every((v) => v.technicianId === 'eyal'));

  const owner = await call('c', 'GET', '/api/schedule');
  assert.equal(owner.status, 200);
  assert.ok(owner.json.next && owner.json.next.buildingId === 'sea');

  assert.equal((await call('m', 'DELETE', `/api/schedule/rules/${made.json.id}`)).status, 200);
});

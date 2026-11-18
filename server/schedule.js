// Smart diary: recurring assignments generate upcoming visits automatically.
// Times are wall-clock Asia/Jerusalem regardless of the server's own zone.
const crypto = require('crypto');

const TZ = 'Asia/Jerusalem';
const DAY = 24 * 60 * 60 * 1000;
const HORIZON_DAYS = 42;
const COLORS = ['#2563eb', '#16a34a', '#d97706', '#7c3aed', '#0d9488', '#db2777'];

function tzParts(ts) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' });
  const o = Object.fromEntries(f.formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday);
  return { y: +o.year, m: +o.month, d: +o.day, hh: +o.hour, mm: +o.minute, wd };
}
// UTC ms for a local Jerusalem wall time.
function localTs(y, m, d, minutes = 0) {
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const p = tzParts(guess);
  const shown = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  return guess - (shown - guess);
}
function dayStart(ts) { const p = tzParts(ts); return localTs(p.y, p.m, p.d, 0); }
function addDays(ts, n) { const p = tzParts(ts + n * DAY + 12 * 3600e3); return localTs(p.y, p.m, p.d, 0); }
function weekStart(ts) { const s = dayStart(ts); return addDays(s, -tzParts(s).wd); }
function dateKey(ts) { const p = tzParts(ts); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; }
function minutesOf(ts) { const p = tzParts(ts); return p.hh * 60 + p.mm; }
function parseTime(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); if (!m) return null; const v = +m[1] * 60 + +m[2]; return v >= 0 && v < 1440 ? v : null; }

async function generate(db, now = Date.now()) {
  const rules = await db.prepare('SELECT * FROM schedule_rules WHERE active = 1').all();
  const from = dayStart(now);
  const until = addDays(from, HORIZON_DAYS);
  const exists = db.prepare('SELECT id FROM visits WHERE rule_id = ? AND occ = ?');
  const ins = db.prepare(`INSERT INTO visits (rule_id, call_id, building_id, technician_id, starts_at, duration_min, title, status, moved, occ, created_at)
    VALUES (?, NULL, ?, ?, ?, ?, ?, 'scheduled', 0, ?, ?)`);
  let made = 0;
  for (const r of rules) {
    const anchor = weekStart(Math.max(r.start_at, 0));
    for (let day = from; day < until; day = addDays(day, 1)) {
      if (tzParts(day).wd !== r.weekday || day < dayStart(r.start_at)) continue;
      const weeks = Math.round((weekStart(day) - anchor) / (7 * DAY));
      if (weeks % (r.every_weeks || 1) !== 0) continue;
      const occ = dateKey(day);
      if (await exists.get(r.id, occ)) continue;
      const p = tzParts(day);
      await ins.run(r.id, r.building_id, r.technician_id, localTs(p.y, p.m, p.d, r.time_min), r.duration_min, r.title, occ, now);
      made += 1;
    }
  }
  return made;
}

function colorMap(techs) { return Object.fromEntries(techs.map((t, i) => [t.id, COLORS[i % COLORS.length]])); }

function withConflicts(list) {
  const out = list.map((v) => ({ ...v, conflict: false }));
  const byTech = {};
  out.forEach((v) => { if (v.technicianId) (byTech[v.technicianId] ||= []).push(v); });
  for (const arr of Object.values(byTech)) {
    arr.sort((a, b) => a.startsAt - b.startsAt);
    for (let i = 0; i < arr.length; i += 1) {
      for (let j = i + 1; j < arr.length && arr[j].startsAt < arr[i].startsAt + arr[i].durationMin * 60000; j += 1) {
        arr[i].conflict = true; arr[j].conflict = true;
      }
    }
  }
  return out;
}

// Demo reset: a believable week for the existing technicians and properties.
async function seedDemo(db, now = Date.now()) {
  await db.prepare('DELETE FROM visits').run();
  await db.prepare('DELETE FROM schedule_rules').run();
  const ws = weekStart(now);
  const ins = db.prepare(`INSERT INTO schedule_rules (id, building_id, technician_id, weekday, time_min, duration_min, every_weeks, title, start_at, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`);
  const rules = [
    ['r-pool', 'sea', 'omer', 0, 8 * 60, 90, 1, 'בדיקת חדר מכונות בריכה'],
    ['r-elec', 'givah', 'michal', 1, 10 * 60, 120, 2, 'בדיקת לוח חשמל וגנרטור'],
    ['r-pent', 'herzl', 'dani', 3, 9 * 60, 120, 1, 'סבב אחזקה שבועי'],
    ['r-ac', 'sea', 'omer', 4, 13 * 60, 90, 4, 'ניקוי פילטרים במזגן המרכזי'],
    ['r-garden', 'givah', 'dani', 2, 7 * 60 + 30, 60, 1, 'השקיה ותאורת גינה'],
    ['r-plumb', 'sea', 'eyal', 1, 14 * 60, 60, 2, 'בדיקת לחץ מים ומשאבות'],
  ];
  for (const r of rules) await ins.run(...r, ws, now);
  await generate(db, ws);
  const call = db.prepare(`INSERT INTO visits (rule_id, call_id, building_id, technician_id, starts_at, duration_min, title, status, moved, occ, created_at)
    VALUES (NULL, ?, ?, ?, ?, ?, ?, 'scheduled', 0, NULL, ?)`);
  const at = (dayOffset, hh, mm = 0) => { const p = tzParts(addDays(dayStart(now), dayOffset)); return localTs(p.y, p.m, p.d, hh * 60 + mm); };
  await call.run(2402, 'herzl', 'eyal', at(0, 11), 90, 'נזילה מתחת לכיור', now);
  await call.run(2401, 'sea', null, at(0, 15), 120, 'פיצוץ צינור בחדר המכונות', now);
  await call.run(2403, 'sea', 'dani', at(1, 9, 30), 120, 'מעלית הבית נעצרת', now);
  await call.run(2406, 'givah', 'dani', at(1, 12), 60, 'טיפול משאבת השקיה', now);
  await call.run(2405, 'sea', null, at(2, 12), 90, 'רעש במזגן המרכזי', now);
}

module.exports = { TZ, DAY, COLORS, tzParts, localTs, dayStart, addDays, weekStart, dateKey, minutesOf, parseTime, generate, colorMap, withConflicts, seedDemo, newRuleId: () => `r-${crypto.randomBytes(5).toString('hex')}` };

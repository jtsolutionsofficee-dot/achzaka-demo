const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
// Photos live in UPLOAD_DIR (a Render Disk in production), else data/uploads.
const UPLOADS = path.resolve(process.env.UPLOAD_DIR || path.join(DATA, 'uploads'));
// SQLite is the local fallback when DATABASE_URL is not set.
const DB_PATH = path.resolve(process.env.SQLITE_PATH || path.join(DATA, 'achzaka.db'));
// Demo seed + the demo-script reset on every start. On by default only for the local SQLite demo.
const DEMO_DATA = process.env.DEMO_DATA != null ? process.env.DEMO_DATA === '1' : !process.env.DATABASE_URL;

const STATUSES = ['new', 'assigned', 'on_the_way', 'in_progress', 'waiting_parts', 'waiting_customer', 'done', 'closed'];
const URGENCIES = ['normal', 'urgent', 'emergency'];
const CATEGORIES = ['אינסטלציה', 'חשמל', 'מעלית', 'מיזוג', 'איטום', 'ניקיון', 'בטיחות', 'אחר'];
const PAUSE_STATUSES = ['waiting_parts', 'waiting_customer'];
const ASSET_STATUSES = ['ok', 'needs_service', 'down'];
const CONTRACT_TYPES = ['retainer_full', 'retainer_basic', 'per_call'];

const STATUS_LABEL = {
  new: 'חדשה',
  assigned: 'שויכה',
  on_the_way: 'בדרך',
  in_progress: 'בטיפול',
  waiting_parts: 'ממתינה לחלק',
  waiting_customer: 'ממתינה ללקוח',
  done: 'בוצע',
  closed: 'נסגר',
};

const URGENCY_LABEL = {
  normal: 'רגילה',
  urgent: 'דחוף',
  emergency: 'חירום',
};

const ASSET_STATUS_LABEL = {
  ok: 'תקין',
  needs_service: 'דורש טיפול',
  down: 'מושבת',
};

const CONTRACT_LABEL = {
  retainer_full: 'ריטיינר מלא',
  retainer_basic: 'ריטיינר בסיסי',
  per_call: 'לפי קריאה',
};

const CADENCE_LABEL = {
  monthly: 'חודשי',
  quarterly: 'רבעוני',
};

const SLA_HOURS = { emergency: 2, urgent: 8, normal: 48 };

function svgCard() { return photoTile(); }
function svgCardOld({ title, subtitle, tone }) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900">
  <rect width="1200" height="900" fill="${tone}"/>
  <rect x="0" y="0" width="1200" height="18" fill="#2563eb"/>
  <text x="1060" y="400" text-anchor="end" fill="#dbeafe" font-family="Heebo, Arial, sans-serif" font-size="32">${esc(subtitle)}</text>
  <text x="1060" y="500" text-anchor="end" fill="#F6F4EF" font-family="Heebo, Arial, sans-serif" font-size="58" font-weight="700">${esc(title)}</text>
  <text x="1060" y="820" text-anchor="end" fill="rgba(246,244,239,0.72)" font-family="Heebo, Arial, sans-serif" font-size="26">אחזקה · תיעוד מהשטח</text>
</svg>`;
}

async function hasColumn(db, table, column) {
  return db.hasColumn(table, column);
}

async function addColumn(db, table, column, ddl) {
  if (!(await hasColumn(db, table, column))) (await db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`));
}

async function open() {
  fs.mkdirSync(UPLOADS, { recursive: true });
  let db;
  if (process.env.DATABASE_URL) {
    db = store.createPg(process.env.DATABASE_URL);
    // Final schema for PostgreSQL; the SQLite-era CREATE/ALTER steps below are then no-ops.
    (await db.exec(fs.readFileSync(path.join(__dirname, 'sql', 'schema.pg.sql'), 'utf8')));
  } else {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = store.createSqlite(DB_PATH);
  }
  (await db.exec(`
    CREATE TABLE IF NOT EXISTS buildings (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      profile TEXT NOT NULL,
      contract_name TEXT NOT NULL,
      contract_detail TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      role_label TEXT NOT NULL,
      title TEXT,
      trade TEXT,
      building_id TEXT,
      phone TEXT,
      FOREIGN KEY (building_id) REFERENCES buildings(id)
    );
    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY,
      building_id TEXT NOT NULL,
      unit TEXT NOT NULL,
      customer_id TEXT,
      reporter_name TEXT,
      category TEXT NOT NULL,
      urgency TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      assignee_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (building_id) REFERENCES buildings(id),
      FOREIGN KEY (customer_id) REFERENCES users(id),
      FOREIGN KEY (assignee_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      call_id INTEGER NOT NULL,
      user_id TEXT NOT NULL,
      body TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (call_id) REFERENCES calls(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY,
      call_id INTEGER NOT NULL,
      message_id INTEGER,
      user_id TEXT,
      filename TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (call_id) REFERENCES calls(id),
      FOREIGN KEY (message_id) REFERENCES messages(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      call_id INTEGER NOT NULL,
      actor_id TEXT,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (call_id) REFERENCES calls(id),
      FOREIGN KEY (actor_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      location TEXT NOT NULL,
      serial TEXT NOT NULL,
      next_service_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      FOREIGN KEY (building_id) REFERENCES buildings(id)
    );
    CREATE TABLE IF NOT EXISTS pm_plans (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      name TEXT NOT NULL,
      cadence TEXT NOT NULL,
      next_due_at INTEGER NOT NULL,
      last_call_id INTEGER,
      FOREIGN KEY (asset_id) REFERENCES assets(id)
    );
    CREATE TABLE IF NOT EXISTS vendors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      trade TEXT NOT NULL,
      phone TEXT NOT NULL,
      notes TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS parts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sku TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      min_quantity INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS part_uses (
      id INTEGER PRIMARY KEY,
      call_id INTEGER NOT NULL,
      part_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (call_id) REFERENCES calls(id),
      FOREIGN KEY (part_id) REFERENCES parts(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS contracts (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      monthly_fee INTEGER NOT NULL,
      included_calls INTEGER,
      response_emergency INTEGER NOT NULL,
      response_urgent INTEGER NOT NULL,
      response_normal INTEGER NOT NULL,
      FOREIGN KEY (building_id) REFERENCES buildings(id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY,
      user_id TEXT NOT NULL,
      call_id INTEGER,
      text TEXT NOT NULL,
      read_at INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_calls_building ON calls(building_id);
    CREATE INDEX IF NOT EXISTS idx_calls_assignee ON calls(assignee_id);
    CREATE INDEX IF NOT EXISTS idx_calls_customer ON calls(customer_id);
    CREATE INDEX IF NOT EXISTS idx_messages_call ON messages(call_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_photos_call ON photos(call_id);
    CREATE INDEX IF NOT EXISTS idx_events_call ON events(call_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_assets_building ON assets(building_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_part_uses_call ON part_uses(call_id);
  `));
  (await migrate(db));
  if (DEMO_DATA) {
    (await seed(db));
    (await seedExtras(db));
    (await ensureDemo(db));
  } else {
    (await bootstrapAdmin(db));
  }
  (await db.syncSequences());
  return db;
}

async function migrate(db) {
  (await addColumn(db, 'calls', 'vendor_id', 'TEXT'));
  (await addColumn(db, 'calls', 'asset_id', 'TEXT'));
  (await addColumn(db, 'calls', 'pm_plan_id', 'TEXT'));
  (await addColumn(db, 'calls', 'paused_ms', 'INTEGER NOT NULL DEFAULT 0'));
  (await addColumn(db, 'calls', 'pause_started_at', 'INTEGER'));
  (await addColumn(db, 'calls', 'quote_amount', 'INTEGER'));
  (await addColumn(db, 'calls', 'quote_note', 'TEXT'));
  (await addColumn(db, 'calls', 'quote_status', 'TEXT'));
  (await addColumn(db, 'calls', 'quote_decided_at', 'INTEGER'));
  (await addColumn(db, 'calls', 'is_demo', 'INTEGER NOT NULL DEFAULT 0'));
  (await addColumn(db, 'photos', 'phase', "TEXT NOT NULL DEFAULT 'report'"));
  (await db.prepare(`
    UPDATE calls
    SET pause_started_at = updated_at
    WHERE status IN ('waiting_parts', 'waiting_customer') AND pause_started_at IS NULL
  `).run());
  (await db.prepare(`
    UPDATE photos
    SET phase = 'work'
    WHERE message_id IS NOT NULL
      AND phase = 'report'
      AND user_id IN (SELECT id FROM users WHERE role IN ('employee', 'manager'))
  `).run());
  (await addColumn(db, 'buildings', 'lat', 'REAL'));
  (await addColumn(db, 'buildings', 'lng', 'REAL'));
  (await db.exec(`
    CREATE TABLE IF NOT EXISTS sms_log (
      id INTEGER PRIMARY KEY,
      to_phone TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      building_id TEXT NOT NULL,
      description TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (building_id) REFERENCES buildings(id)
    );
    CREATE TABLE IF NOT EXISTS part_movements (
      id INTEGER PRIMARY KEY,
      part_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      note TEXT,
      call_id INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (part_id) REFERENCES parts(id)
    );
    CREATE INDEX IF NOT EXISTS idx_sms_created ON sms_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_movements_part ON part_movements(part_id, created_at);
  `));
  (await addColumn(db, 'users', 'password_hash', 'TEXT'));
  (await addColumn(db, 'users', 'access', 'TEXT'));
  (await addColumn(db, 'users', 'unit_id', 'TEXT'));
  (await addColumn(db, 'buildings', 'city', 'TEXT'));
  (await db.exec(`
    CREATE TABLE IF NOT EXISTS units (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL,
      label TEXT NOT NULL,
      floor TEXT,
      FOREIGN KEY (building_id) REFERENCES buildings(id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_units_building ON units(building_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_units_label ON units(building_id, label);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `));
  (await addColumn(db, 'users', 'email', 'TEXT'));
  (await db.exec(`
    CREATE TABLE IF NOT EXISTS outbound_emails (
      id INTEGER PRIMARY KEY,
      call_id INTEGER NOT NULL,
      building_id TEXT NOT NULL,
      to_user_id TEXT,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      created_by TEXT,
      FOREIGN KEY (call_id) REFERENCES calls(id),
      FOREIGN KEY (building_id) REFERENCES buildings(id)
    );
    CREATE INDEX IF NOT EXISTS idx_emails_created ON outbound_emails(created_at);
    CREATE INDEX IF NOT EXISTS idx_emails_call ON outbound_emails(call_id);
    CREATE TABLE IF NOT EXISTS login_codes (
      id INTEGER PRIMARY KEY,
      phone TEXT NOT NULL,
      code_hash TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_login_codes_phone ON login_codes(phone, created_at);
    CREATE TABLE IF NOT EXISTS schedule_rules (
      id TEXT PRIMARY KEY,
      building_id TEXT NOT NULL,
      technician_id TEXT,
      weekday INTEGER NOT NULL,
      time_min INTEGER NOT NULL,
      duration_min INTEGER NOT NULL,
      every_weeks INTEGER NOT NULL,
      title TEXT NOT NULL,
      start_at INTEGER NOT NULL,
      active INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (building_id) REFERENCES buildings(id)
    );
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY,
      rule_id TEXT,
      call_id INTEGER,
      building_id TEXT NOT NULL,
      technician_id TEXT,
      starts_at INTEGER NOT NULL,
      duration_min INTEGER NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      moved INTEGER NOT NULL,
      occ TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (building_id) REFERENCES buildings(id)
    );
    CREATE INDEX IF NOT EXISTS idx_visits_start ON visits(starts_at);
    CREATE INDEX IF NOT EXISTS idx_visits_rule ON visits(rule_id, occ);
  `));
}

// Demo photo placeholder: light 4:3 tile with a line camera icon, no text (design review B6).
function photoTile() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#f1f3f6"/><g transform="translate(340 250) scale(5)" fill="none" stroke="#64748b" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h3l1.5-2h5L14 7h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="10" cy="11.5" r="3"/></g></svg>`;
}

function writePhoto(filename, spec) {
  const full = path.join(UPLOADS, filename);
  fs.writeFileSync(full, photoTile(spec));
  return filename;
}

// Production with an empty database: create the first manager from ADMIN_PHONE / ADMIN_PASSWORD.
async function bootstrapAdmin(db) {
  const count = (await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n;
  if (count) return;
  const phone = digitsPhone(process.env.ADMIN_PHONE || '');
  const password = process.env.ADMIN_PASSWORD || '';
  if (!phone || password.length < 8) {
    console.warn('No users yet: set ADMIN_PHONE and ADMIN_PASSWORD (8+ chars) to create the first manager.');
    return;
  }
  (await db.prepare(`
    INSERT INTO users (id, name, role, role_label, title, phone, password_hash, access)
    VALUES ('admin', ?, 'manager', 'מנהל', 'מנהל תפעול', ?, ?, NULL)
  `).run(process.env.ADMIN_NAME || 'מנהל', phone, hashPassword(password)));
  console.log('Created first manager for', phone);
}

async function seed(db) {
  const count = (await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n;
  if (count) return;

  const now = Date.now();
  const h = 60 * 60 * 1000;

  const tx = db.txFn(async () => {
    const b = db.prepare(`INSERT INTO buildings (id, name, address, profile, contract_name, contract_detail) VALUES (?, ?, ?, ?, ?, ?)`);
    (await b.run('sea', 'וילה הגלים', 'רחוב הדקלים 8', 'וילה על קו הים · בריכה · חדר מכונות', 'אחזקה שוטפת', 'מענה חירום עד שעתיים, דחוף עד 8 שעות, רגיל עד 48 שעות. אחזקה שוטפת של הבית.'));
    (await b.run('herzl', 'דירת הפנטהאוז', 'שדרות רוטשילד 3', 'פנטהאוז · מרפסת · חדר רחצה', 'אחזקה שוטפת', 'אחזקה שוטפת של הדירה. חירום עד שעתיים, דחוף עד 8 שעות, רגיל עד 48 שעות.'));
    (await b.run('givah', 'בית האקליפטוס', 'רחוב האלון 15', 'בית פרטי · גינה · חניה', 'אחזקה שוטפת', 'אחזקה שוטפת של הבית והגינה. חירום עד שעתיים, דחוף עד 8 שעות, רגיל עד 48 שעות.'));

    const u = db.prepare(`INSERT INTO users (id, name, role, role_label, title, trade, building_id, phone) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    (await u.run('dana', 'דנה לוי', 'customer', 'בעל הנכס', 'בעל הנכס', null, 'sea', '052-400-1101'));
    (await u.run('avi', 'אבי שרון', 'customer', 'בעל הנכס', 'בעל הנכס', null, 'herzl', '054-400-1102'));
    (await u.run('eyal', 'אייל ברק', 'employee', 'טכנאי', 'טכנאי שטח', 'אינסטלציה', null, '050-400-2101'));
    (await u.run('michal', 'מיכל אזולי', 'employee', 'טכנאית', 'טכנאית שטח', 'חשמל', null, '050-400-2102'));
    (await u.run('dani', 'דני פרץ', 'employee', 'טכנאי', 'טכנאי שטח', 'אחזקה כללית', null, '050-400-2103'));
    (await u.run('ronit', 'רונית כהן', 'manager', 'מנהלת', 'מנהלת תפעול', null, null, '03-400-1000'));

    const call = db.prepare(`INSERT INTO calls (id, building_id, unit, customer_id, reporter_name, category, urgency, description, status, assignee_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const msg = db.prepare(`INSERT INTO messages (call_id, user_id, body, created_at) VALUES (?, ?, ?, ?)`);
    const ev = db.prepare(`INSERT INTO events (call_id, actor_id, text, created_at) VALUES (?, ?, ?, ?)`);
    const ph = db.prepare(`INSERT INTO photos (call_id, message_id, user_id, filename, phase, created_at) VALUES (?, NULL, ?, ?, 'report', ?)`);

    const t1 = now - 3 * h;
    (await call.run(2401, 'sea', 'חדר מכונות הבריכה', 'dana', 'דנה לוי', 'אינסטלציה', 'emergency', 'פיצוץ צינור בחדר המכונות של הבריכה, מים על הרצפה', 'new', null, t1, t1 + 20 * 60000));
    (await ev.run(2401, 'dana', 'הקריאה נפתחה', t1));
    (await msg.run(2401, 'dana', 'המים ממשיכים לצאת מחדר המכונות של הבריכה. אין לי גישה לברז הראשי.', t1 + 10 * 60000));
    (await msg.run(2401, 'ronit', 'הקריאה במוקד. עדיין בלי טכנאי משובץ, מטפלים בזה עכשיו.', t1 + 20 * 60000));
    (await ph.run(2401, 'dana', writePhoto('seed-2401-a.svg', { title: 'פיצוץ בחדר המכונות', subtitle: 'וילה הגלים · בריכה', tone: '#14181f' }), t1));
    (await ph.run(2401, 'dana', writePhoto('seed-2401-b.svg', { title: 'מים על רצפת חדר המכונות', subtitle: 'וילה הגלים · בריכה', tone: '#1e40af' }), t1 + 60000));

    const t2 = now - 5 * h;
    (await call.run(2402, 'herzl', 'חדר הרחצה', 'avi', 'אבי שרון', 'אינסטלציה', 'urgent', 'נזילה מתחת לכיור בחדר הרחצה', 'in_progress', 'eyal', t2, t2 + 3 * h));
    (await ev.run(2402, 'avi', 'הקריאה נפתחה', t2));
    (await ev.run(2402, 'ronit', 'הקריאה שובצה לאייל ברק', t2 + 1 * h));
    (await ev.run(2402, 'eyal', 'הסטטוס עודכן לבדרך', t2 + 2.5 * h));
    (await ev.run(2402, 'eyal', 'הסטטוס עודכן לבטיפול', t2 + 3 * h));
    (await msg.run(2402, 'avi', 'שמתי דלי. הנזילה מהסיפון, לא מהברז.', t2 + 15 * 60000));
    (await msg.run(2402, 'eyal', 'הגעתי לחדר הרחצה. סגרתי את המים לכיור ובודק את החיבור.', t2 + 3 * h));
    (await ph.run(2402, 'avi', writePhoto('seed-2402.svg', { title: 'נזילה בחדר הרחצה', subtitle: 'דירת הפנטהאוז', tone: '#1e40af' }), t2));

    const t3 = now - 60 * h;
    (await call.run(2403, 'sea', 'מעלית הבית', 'dana', 'דנה לוי', 'מעלית', 'normal', 'מעלית הבית נעצרת בין קומת הכניסה לקומת השינה', 'waiting_parts', 'dani', t3, t3 + 5 * h));
    (await ev.run(2403, 'dana', 'הקריאה נפתחה', t3));
    (await ev.run(2403, 'ronit', 'הקריאה שובצה לדני פרץ', t3 + 40 * 60000));
    (await ev.run(2403, 'dani', 'הסטטוס עודכן לבטיפול', t3 + 2 * h));
    (await ev.run(2403, 'dani', 'הסטטוס עודכן לממתינה לחלק', t3 + 3 * h));
    (await msg.run(2403, 'dana', 'המעלית נעצרה באמצע. יצאתי, אבל היא לא עולה לקומת השינה.', t3 + 20 * 60000));
    (await msg.run(2403, 'dani', 'כרטיס הפיקוד שרוף. החלק הוזמן, המעלית מושבתת עד שיגיע.', t3 + 3 * h));
    (await msg.run(2403, 'ronit', 'בעל הנכס עודכן שמעלית הבית מושבתת עד להגעת החלק.', t3 + 5 * h));
    (await ph.run(2403, 'dana', writePhoto('seed-2403.svg', { title: 'מעלית הבית נעצרת', subtitle: 'וילה הגלים', tone: '#334155' }), t3));

    const t4 = now - 5 * 24 * h;
    (await call.run(2404, 'givah', 'שביל הגינה', null, 'בעל הנכס', 'חשמל', 'normal', 'אין תאורה בשביל הגינה ובכניסה לבית', 'done', 'michal', t4, t4 + 26 * h));
    (await ev.run(2404, 'ronit', 'הקריאה נפתחה', t4));
    (await ev.run(2404, 'ronit', 'הקריאה שובצה למיכל אזולי', t4 + 2 * h));
    (await ev.run(2404, 'michal', 'הסטטוס עודכן לבטיפול', t4 + 6 * h));
    (await ev.run(2404, 'michal', 'הסטטוס עודכן לבוצע', t4 + 26 * h));
    (await msg.run(2404, 'ronit', 'דווח על חושך בשביל הגינה ובכניסה לבית האקליפטוס.', t4 + 5 * 60000));
    (await msg.run(2404, 'michal', 'הוחלפו שני גופי תאורה ושרוול בלוח. התאורה חזרה.', t4 + 26 * h));
    (await ph.run(2404, 'ronit', writePhoto('seed-2404.svg', { title: 'אין תאורה בשביל הגינה', subtitle: 'בית האקליפטוס', tone: '#1e3a34' }), t4));
  });

  (await tx());
}

async function seedExtras(db) {
  if ((await db.prepare('SELECT COUNT(*) AS n FROM assets').get()).n) return;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const h = 60 * 60 * 1000;

  const tx = db.txFn(async () => {
    const a = db.prepare(`INSERT INTO assets (id, building_id, name, kind, location, serial, next_service_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    (await a.run('sea-elev-r', 'sea', 'מעלית הבית', 'elevator', 'מעלית פנימית', 'EL-SEA-R-441', now + 12 * day, 'needs_service'));
    (await a.run('sea-elev-l', 'sea', 'מערכת חימום בריכה', 'pump', 'חדר מכונות הבריכה', 'PL-SEA-L-442', now + 40 * day, 'ok'));
    (await a.run('sea-pump', 'sea', 'משאבת בריכה', 'pump', 'חדר מכונות הבריכה', 'PM-SEA-19', now + 20 * day, 'ok'));
    (await a.run('sea-gen', 'sea', 'גנרטור חירום', 'generator', 'חדר טכני', 'GN-SEA-07', now + 18 * day, 'ok'));
    (await a.run('sea-ac', 'sea', 'מזגן מרכזי', 'ac', 'חדר מכונות', 'AC-SEA-03', now + 9 * day, 'needs_service'));
    (await a.run('herzl-elev', 'herzl', 'מזגן הסלון', 'ac', 'סלון', 'AC-PNT-12', now + 25 * day, 'ok'));
    (await a.run('herzl-boiler', 'herzl', 'דוד מים', 'boiler', 'חדר שירות', 'BL-PNT-2', now + 33 * day, 'ok'));
    (await a.run('givah-elev', 'givah', 'מזגן הבית', 'ac', 'סלון', 'AC-EUC-5', now + 15 * day, 'ok'));
    (await a.run('givah-pump', 'givah', 'משאבת השקיה', 'pump', 'גינה', 'PM-EUC-2', now - 4 * day, 'down'));

    const p = db.prepare(`INSERT INTO pm_plans (id, asset_id, name, cadence, next_due_at) VALUES (?, ?, ?, ?, ?)`);
    (await p.run('pm-sea-elev', 'sea-elev-r', 'בדיקת מעלית הבית', 'monthly', now + 5 * day));
    (await p.run('pm-sea-gen', 'sea-gen', 'הפעלת גנרטור רבעונית', 'quarterly', now + 18 * day));
    (await p.run('pm-herzl-boiler', 'herzl-boiler', 'שטיפת דוד רבעונית', 'quarterly', now + 40 * day));
    (await p.run('pm-givah-pump', 'givah-pump', 'טיפול משאבת השקיה', 'monthly', now - 4 * day));

    const v = db.prepare(`INSERT INTO vendors (id, name, trade, phone, notes) VALUES (?, ?, ?, ?, ?)`);
    (await v.run('v-elev', 'מעליות שרון', 'מעלית', '03-555-2100', 'קבלן מעליות. מענה לחלקי פיקוד והשבתות.'));
    (await v.run('v-ac', 'קירור הצפון', 'מיזוג', '03-555-2144', 'מיזוג לבתים. עובדים מול המוקד, לא מול בעל הנכס.'));

    const part = db.prepare(`INSERT INTO parts (id, name, sku, quantity, min_quantity) VALUES (?, ?, ?, ?, ?)`);
    (await part.run('p-siphon', 'סיפון כיור', 'SIP-40', 12, 4));
    (await part.run('p-board', 'כרטיס פיקוד מעלית', 'ELV-220', 1, 2));
    (await part.run('p-lamp', 'גוף תאורה LED מדרגות', 'LMP-18', 24, 6));
    (await part.run('p-flex', 'צינור גמיש 1/2', 'FLX-12', 8, 3));

    const c = db.prepare(`INSERT INTO contracts (id, building_id, name, type, monthly_fee, included_calls, response_emergency, response_urgent, response_normal)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    (await c.run('ct-sea', 'sea', 'אחזקה שוטפת · וילה הגלים', 'retainer_full', 4800, null, 2, 8, 48));
    (await c.run('ct-herzl', 'herzl', 'אחזקה שוטפת · דירת הפנטהאוז', 'per_call', 0, null, 2, 8, 48));
    (await c.run('ct-givah', 'givah', 'אחזקה שוטפת · בית האקליפטוס', 'retainer_basic', 2200, 6, 2, 8, 48));

    (await db.prepare(`UPDATE calls SET asset_id = ? WHERE id = 2403`).run('sea-elev-r'));
    (await db.prepare(`
      UPDATE calls
      SET quote_amount = ?, quote_note = ?, quote_status = 'pending'
      WHERE id = 2402 AND quote_status IS NULL
    `).run(480, 'החלפת סיפון וצינור גמיש'));

    const t5 = now - 6 * h;
    (await db.prepare(`INSERT INTO calls (id, building_id, unit, customer_id, reporter_name, category, urgency, description, status, assignee_id, vendor_id, asset_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`).run(
      2405, 'sea', 'חדר מכונות', 'dana', 'דנה לוי', 'מיזוג', 'normal',
      'רעש חזק ורטט במזגן המרכזי', 'assigned', 'v-ac', 'sea-ac', t5, t5 + h,
    ));
    (await db.prepare(`INSERT INTO events (call_id, actor_id, text, created_at) VALUES (?, ?, ?, ?)`).run(2405, 'ronit', 'הקריאה נפתחה', t5));
    (await db.prepare(`INSERT INTO events (call_id, actor_id, text, created_at) VALUES (?, ?, ?, ?)`).run(2405, 'ronit', 'הקריאה הועברה לספק קירור הצפון', t5 + h));
    (await db.prepare(`INSERT INTO messages (call_id, user_id, body, created_at) VALUES (?, ?, ?, ?)`).run(2405, 'dana', 'הרעש נשמע בסלון, בעיקר בערב.', t5 + 20 * 60000));
    (await db.prepare(`INSERT INTO messages (call_id, user_id, body, created_at) VALUES (?, ?, ?, ?)`).run(2405, 'ronit', 'העברנו את הקריאה לקירור הצפון. הם חוזרים עם מועד הגעה.', t5 + h));

    const n = db.prepare(`INSERT INTO notifications (user_id, call_id, text, read_at, created_at) VALUES (?, ?, ?, ?, ?)`);
    (await n.run('ronit', 2401, 'נפתחה קריאה 2401 בוילה הגלים: פיצוץ צינור בחדר המכונות של הבריכה', null, now - 3 * h));
    (await n.run('ronit', 2402, 'הודעה חדשה בקריאה 2402 מאבי שרון', null, now - 4 * h));
    (await n.run('ronit', 2404, 'מיכל אזולי עדכנה את קריאה 2404 לבוצע', now - 2 * day, now - 4 * day));
  });
  (await tx());
}

function includedLabel(contract) {
  if (!contract) return '';
  if (contract.type === 'per_call') return 'לפי קריאה';
  if (contract.included_calls == null) return 'ללא הגבלה';
  return `${contract.included_calls} קריאות בחודש`;
}

function slaOf(call, now = Date.now()) {
  const hours = Number(call.sla_hours) || SLA_HOURS[call.urgency] || 48;
  const terminal = call.status === 'done' || call.status === 'closed';
  const pausedNow = PAUSE_STATUSES.includes(call.status) && !terminal;
  let paused = Number(call.paused_ms) || 0;
  if (call.pause_started_at && pausedNow) {
    paused += Math.max(0, now - call.pause_started_at);
  }
  const end = terminal ? call.updated_at : now;
  const elapsed = Math.max(0, end - call.created_at - paused);
  const limit = hours * 60 * 60 * 1000;
  const remainingMs = limit - elapsed;
  return {
    hours,
    dueAt: (terminal ? call.updated_at : now) + remainingMs,
    late: !terminal && remainingMs < 0,
    remainingMs,
    paused: pausedNow,
    elapsedMs: elapsed,
  };
}

const DEMO_PHONES = {
  dana: '0501000001',
  avi: '0501000002',
  eyal: '0501000003',
  michal: '0501000004',
  dani: '0501000005',
  ronit: '0501000006',
};

const INVOICE_STATUS = {
  draft: 'טיוטה',
  sent: 'נשלח',
  paid: 'שולם',
};

const SMS_PENDING = 'ממתין לחיבור SMS';
const EMAIL_PENDING = 'ממתין לחיבור מייל';

function digitsPhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function displayPhone(value) {
  const d = digitsPhone(value);
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return d || '';
}

function shapeUser(row, building) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    roleLabel: row.role_label,
    title: row.title,
    trade: row.trade,
    phone: displayPhone(row.phone),
    phoneDigits: digitsPhone(row.phone),
    buildingId: row.building_id,
    buildingName: building ? building.name : null,
    buildingAddress: building ? building.address : null,
  };
}

const DEMO_PASSWORDS = {
  dana: 'Dana2401',
  avi: 'Avi2402',
  eyal: 'Eyal2403',
  michal: 'Michal2404',
  dani: 'Dani2405',
  ronit: 'Ronit2406',
};

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const expected = Buffer.from(parts[2], 'hex');
  if (expected.length !== 32) return false;
  const got = crypto.scryptSync(String(password), parts[1], 32);
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(got, expected);
}


async function retargetLuxury(db) {
  const buildings = [
    ['sea', 'וילה הגלים', 'רחוב הדקלים 8', 'קיסריה', 32.5002, 34.9045, 'וילה על קו הים · בריכה · חדר מכונות', 'אחזקה שוטפת', 'מענה חירום עד שעתיים, דחוף עד 8 שעות, רגיל עד 48 שעות. אחזקה שוטפת של הבית.'],
    ['herzl', 'דירת הפנטהאוז', 'שדרות רוטשילד 3', 'קיסריה', 32.4895, 34.9102, 'פנטהאוז · מרפסת · חדר רחצה', 'אחזקה שוטפת', 'אחזקה שוטפת של הדירה. חירום עד שעתיים, דחוף עד 8 שעות, רגיל עד 48 שעות.'],
    ['givah', 'בית האקליפטוס', 'רחוב האלון 15', 'קיסריה', 32.4940, 34.8988, 'בית פרטי · גינה · חניה', 'אחזקה שוטפת', 'אחזקה שוטפת של הבית והגינה. חירום עד שעתיים, דחוף עד 8 שעות, רגיל עד 48 שעות.'],
  ];
  const updB = db.prepare(`UPDATE buildings SET name = ?, address = ?, city = ?, lat = ?, lng = ?, profile = ?, contract_name = ?, contract_detail = ? WHERE id = ?`);
  for (const row of buildings) (await updB.run(row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[0]));

  (await db.prepare(`UPDATE users SET role_label = 'בעל הנכס', title = 'בעל הנכס', access = 'chair', building_id = 'sea', unit_id = NULL WHERE id = 'dana'`).run());
  (await db.prepare(`UPDATE users SET role_label = 'בעל הנכס', title = 'בעל הנכס', access = 'chair', building_id = 'herzl', unit_id = NULL WHERE id = 'avi'`).run());

  const updC = db.prepare(`UPDATE contracts SET name = ? WHERE id = ?`);
  (await updC.run('אחזקה שוטפת · וילה הגלים', 'ct-sea'));
  (await updC.run('אחזקה שוטפת · דירת הפנטהאוז', 'ct-herzl'));
  (await updC.run('אחזקה שוטפת · בית האקליפטוס', 'ct-givah'));

  const updA = db.prepare(`UPDATE assets SET name = ?, kind = ?, location = ? WHERE id = ?`);
  (await updA.run('מעלית הבית', 'elevator', 'מעלית פנימית', 'sea-elev-r'));
  (await updA.run('מערכת חימום בריכה', 'pump', 'חדר מכונות הבריכה', 'sea-elev-l'));
  (await updA.run('משאבת בריכה', 'pump', 'חדר מכונות הבריכה', 'sea-pump'));
  (await updA.run('גנרטור חירום', 'generator', 'חדר טכני', 'sea-gen'));
  (await updA.run('מזגן מרכזי', 'ac', 'חדר מכונות', 'sea-ac'));
  (await updA.run('מזגן הסלון', 'ac', 'סלון', 'herzl-elev'));
  (await updA.run('דוד מים', 'boiler', 'חדר שירות', 'herzl-boiler'));
  (await updA.run('מזגן הבית', 'ac', 'סלון', 'givah-elev'));
  (await updA.run('משאבת השקיה', 'pump', 'גינה', 'givah-pump'));

  const updP = db.prepare(`UPDATE pm_plans SET name = ? WHERE id = ?`);
  (await updP.run('בדיקת מעלית הבית', 'pm-sea-elev'));
  (await updP.run('טיפול משאבת השקיה', 'pm-givah-pump'));
  (await db.prepare(`UPDATE vendors SET notes = ? WHERE id = 'v-ac'`).run('מיזוג לבתים. עובדים מול המוקד, לא מול בעל הנכס.'));

  (await db.prepare(`UPDATE calls SET unit = ?, description = ?, customer_id = 'dana', reporter_name = 'דנה לוי' WHERE id = 2401`).run('חדר מכונות הבריכה', 'פיצוץ צינור בחדר המכונות של הבריכה, מים על הרצפה'));
  (await db.prepare(`UPDATE calls SET building_id = 'herzl', unit = ?, description = ?, customer_id = 'avi', reporter_name = 'אבי שרון' WHERE id = 2402`).run('חדר הרחצה', 'נזילה מתחת לכיור בחדר הרחצה'));
  (await db.prepare(`UPDATE calls SET unit = ?, description = ? WHERE id = 2403`).run('מעלית הבית', 'מעלית הבית נעצרת בין קומת הכניסה לקומת השינה'));
  (await db.prepare(`UPDATE calls SET unit = ?, description = ?, reporter_name = 'בעל הנכס' WHERE id = 2404`).run('שביל הגינה', 'אין תאורה בשביל הגינה ובכניסה לבית'));
  (await db.prepare(`
    UPDATE calls
    SET building_id = 'sea', unit = ?, description = ?, status = 'assigned', assignee_id = NULL, vendor_id = 'v-ac', asset_id = 'sea-ac', customer_id = 'dana', reporter_name = 'דנה לוי'
    WHERE id = 2405
  `).run('חדר מכונות', 'רעש חזק ורטט במזגן המרכזי'));
  (await db.prepare(`UPDATE calls SET unit = 'גינה', description = 'תחזוקה מונעת: טיפול משאבת השקיה' WHERE id = 2406`).run());

  const msg = db.prepare('UPDATE messages SET body = ? WHERE id = ?');
  (await msg.run('המים ממשיכים לצאת מחדר המכונות של הבריכה. אין לי גישה לברז הראשי.', 1));
  (await msg.run('הגעתי לחדר הרחצה. סגרתי את המים לכיור ובודק את החיבור.', 4));
  (await msg.run('המעלית נעצרה באמצע. יצאתי, אבל היא לא עולה לקומת השינה.', 5));
  (await msg.run('בעל הנכס עודכן שמעלית הבית מושבתת עד להגעת החלק.', 7));
  (await msg.run('דווח על חושך בשביל הגינה ובכניסה לבית האקליפטוס.', 8));
  (await msg.run('הרעש נשמע בסלון, בעיקר בערב.', 10));
  (await msg.run('העברנו את הקריאה לקירור הצפון. הם חוזרים עם מועד הגעה.', 11));
  (await db.prepare(`UPDATE messages SET body = 'תחזוקה מונעת: טיפול משאבת השקיה' WHERE call_id = 2406 AND body LIKE '%משאבה%'`).run());

  const swaps = [
    ['מגדלי הים', 'וילה הגלים'],
    ['הירקון 18, תל אביב', 'רחוב הדקלים 8, קיסריה'],
    ['הירקון', 'הדקלים'],
    ['תל אביב', 'קיסריה'],
    ['רמת גן', 'קיסריה'],
    ['גבעתיים', 'קיסריה'],
    ['הרצל 12', 'דירת הפנטהאוז'],
    ['גבעת הפרחים 5', 'בית האקליפטוס'],
    ['גבעת הפרחים', 'בית האקליפטוס'],
    ['ועד בית האקליפטוס', 'בעל הנכס'],
    ['יו"ר ועד בית', 'בעל הנכס'],
    ['יו"ר ועד', 'בעל הנכס'],
    ['פיצוץ צינור בלובי', 'פיצוץ צינור בחדר המכונות של הבריכה'],
    ['נזילה מתחת לכיור במטבח', 'נזילה מתחת לכיור בחדר הרחצה'],
  ];
  for (const table of ['notifications', 'sms_log', 'messages', 'events']) {
    const col = table === 'notifications' || table === 'events' ? 'text' : 'body';
    const rows = (await db.prepare(`SELECT id, ${col} AS value FROM ${table}`).all());
    const write = db.prepare(`UPDATE ${table} SET ${col} = ? WHERE id = ?`);
    for (const row of rows) {
      let next = row.value || '';
      for (const [from, to] of swaps) next = next.split(from).join(to);
      if (next !== row.value) (await write.run(next, row.id));
    }
  }

  const ensureUnit = db.prepare('SELECT id FROM units WHERE building_id = ? LIMIT 1');
  const insertUnit = db.prepare('INSERT INTO units (id, building_id, label, floor) VALUES (?, ?, ?, ?)');
  for (const row of buildings) {
    if (!(await ensureUnit.get(row[0]))) (await insertUnit.run(`un-${row[0]}`, row[0], row[1], ''));
  }

  fs.writeFileSync(path.join(UPLOADS, 'seed-2401-a.svg'), photoTile());
  fs.writeFileSync(path.join(UPLOADS, 'seed-2401-b.svg'), photoTile());
  fs.writeFileSync(path.join(UPLOADS, 'seed-2402.svg'), svgCard({ title: 'נזילה בחדר הרחצה', subtitle: 'דירת הפנטהאוז', tone: '#1e40af' }));
  fs.writeFileSync(path.join(UPLOADS, 'seed-2403.svg'), svgCard({ title: 'מעלית הבית נעצרת', subtitle: 'וילה הגלים', tone: '#334155' }));
  fs.writeFileSync(path.join(UPLOADS, 'seed-2404.svg'), svgCard({ title: 'אין תאורה בשביל הגינה', subtitle: 'בית האקליפטוס', tone: '#1e3a34' }));
}

// Demo history for the manager's weekly chart. Rebuilt on every start relative to now,
// ids 1001-1099 (below the live 24xx range), flagged is_demo = 1, never at דנה's
// property (sea), no customer and never assigned to eyal.
async function seedDemoHistory(db) {
  const DAY = 24 * 60 * 60 * 1000;
  const H = 60 * 60 * 1000;
  const now = Date.now();
  const items = [
    ['herzl', 'חדר הרחצה', 'אינסטלציה', 'נזילה מהברז במקלחת'],
    ['givah', 'גינה', 'אחר', 'ממטרה שבורה בגינה'],
    ['herzl', 'סלון', 'מיזוג', 'המזגן בסלון לא מקרר'],
    ['givah', 'מטבח', 'חשמל', 'שקע לא עובד במטבח'],
    ['herzl', 'מרפסת', 'איטום', 'רטיבות בתקרת המרפסת'],
    ['givah', 'כניסה', 'חשמל', 'תאורת הכניסה מהבהבת'],
    ['herzl', 'מטבח', 'אינסטלציה', 'סתימה בכיור המטבח'],
    ['givah', 'חדר שירות', 'אינסטלציה', 'דוד המים מטפטף'],
  ];
  const techs = ['michal', 'dani'];
  const tx = db.txFn(async () => {
    for (const t of ['messages', 'photos', 'events', 'notifications', 'part_uses']) {
      try { (await db.prepare(`DELETE FROM ${t} WHERE call_id IN (SELECT id FROM calls WHERE is_demo = 1)`).run()); } catch {}
    }
    (await db.prepare('DELETE FROM calls WHERE is_demo = 1').run());
    const ins = db.prepare(`
      INSERT INTO calls (id, building_id, unit, customer_id, reporter_name, category, urgency, description, status, assignee_id, vendor_id,
        quote_amount, quote_note, quote_status, quote_decided_at, created_at, updated_at, paused_ms, is_demo)
      VALUES (?, ?, ?, NULL, 'בעל הנכס', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
    `);
    const VENDOR_FOR = { 'מיזוג': 'v-ac', 'איטום': 'v-seal' };
    const QUOTES = [380, 520, 760, 1150, 290, 640, 450];
    let id = 1001;
    let n = 0;
    for (let day = 13; day >= 1; day -= 1) {
      const perDay = 2 + ((day * 7) % 3);
      for (let k = 0; k < perDay; k += 1, n += 1) {
        const [b, unit, cat, desc] = items[n % items.length];
        const created = now - day * DAY + (8 + k * 3 + (n % 2)) * H;
        const ageDays = (now - created) / DAY;
        const span = Math.min((1 + (n % 3)) * 0.4 * DAY + (n % 5) * H, ageDays * DAY - H);
        const status = n % 4 === 0 ? 'done' : 'closed';
        const vendor = VENDOR_FOR[cat] || null;
        const quoted = n % 3 === 0;
        (await ins.run(
          id++, b, unit, cat, n % 6 === 0 ? 'urgent' : 'normal', desc, status, vendor ? null : techs[n % 2], vendor,
          quoted ? QUOTES[n % QUOTES.length] : null, quoted ? `${desc} · חלקים ועבודה` : null, quoted ? 'approved' : null,
          quoted ? Math.round(created + 2 * H) : null, created, Math.round(created + span),
        ));
      }
    }
  });
  (await tx());
}

// Fictional, generic demo content so equipment / maintenance / vendors / parts / billing / mail screens are not
// sparse. Fixed ids + ON CONFLICT DO NOTHING: safe on every start, works on SQLite and PostgreSQL.
async function seedShowcase(db) {
  const DAY = 24 * 60 * 60 * 1000;
  const H = 60 * 60 * 1000;
  const now = Date.now();
  const put = async (sql, rows) => { const st = db.prepare(sql); for (const r of rows) (await st.run(...r)); };
  (await put(`INSERT INTO vendors (id, name, trade, phone, notes) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`, [
    ['v-plumb', 'אינסטלציה מהירה', 'אינסטלציה', '03-555-2160', 'פיצוצים ונזילות, זמינות 24/7.'],
    ['v-elec', 'חשמל השרון', 'חשמל', '03-555-2172', 'לוחות חשמל, גנרטורים ותאורת חוץ.'],
    ['v-seal', 'איטום פלוס', 'איטום', '03-555-2188', 'איטום גגות ומרפסות, אחריות 5 שנים.'],
    ['v-pool', 'בריכות הים', 'בריכות', '03-555-2195', 'טיפול שבועי, משאבות ומערכות חימום.'],
  ]));
  (await put(`INSERT INTO users (id, name, role, role_label, title, trade, phone) VALUES (?, ?, 'employee', 'טכנאי', 'טכנאי שטח', ?, ?) ON CONFLICT DO NOTHING`, [
    ['omer', 'עומר נחום', 'בריכות ומיזוג', '0501000007'],
  ]));
  (await put(`INSERT INTO parts (id, name, sku, quantity, min_quantity) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`, [
    ['p-filter', 'מסנן משאבת בריכה', 'FLT-75', 3, 2],
    ['p-chlor', 'טבליות כלור 5 ק״ג', 'CHL-05', 1, 3],
    ['p-cap', 'קבל למזגן 35µF', 'CAP-35', 7, 2],
    ['p-valve', 'ברז ניל ½', 'VLV-12', 14, 5],
    ['p-breaker', 'מפסק פחת 40A', 'BRK-40', 4, 2],
    ['p-silicone', 'סיליקון סניטרי', 'SIL-01', 18, 6],
  ]));
  (await put(`INSERT INTO assets (id, building_id, name, kind, location, serial, next_service_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`, [
    ['sea-solar', 'sea', 'מערכת סולארית', 'boiler', 'גג', 'SOL-2208', now + 40 * DAY, 'ok'],
    ['herzl-pump', 'herzl', 'משאבת לחץ מים', 'pump', 'חדר שירות', 'PMP-5521', now + 9 * DAY, 'ok'],
    ['herzl-ac2', 'herzl', 'מזגן חדר השינה', 'ac', 'חדר שינה', 'AC-7731', now + 3 * DAY, 'needs_service'],
    ['givah-gen', 'givah', 'גנרטור גיבוי', 'generator', 'מחסן', 'GEN-1904', now + 55 * DAY, 'ok'],
  ]));
  (await put(`INSERT INTO pm_plans (id, asset_id, name, cadence, next_due_at, last_call_id) VALUES (?, ?, ?, ?, ?, NULL) ON CONFLICT DO NOTHING`, [
    ['pm-sea-pump', 'sea-pump', 'ניקוי מסנן משאבת הבריכה', 'monthly', now + 6 * DAY],
    ['pm-sea-ac', 'sea-ac', 'ניקוי פילטרים במזגן המרכזי', 'quarterly', now + 2 * DAY],
    ['pm-herzl-ac', 'herzl-elev', 'טיפול מזגן הסלון', 'quarterly', now + 16 * DAY],
    ['pm-herzl-pump', 'herzl-pump', 'בדיקת משאבת לחץ', 'quarterly', now + 9 * DAY],
    ['pm-givah-ac', 'givah-elev', 'טיפול מזגן הבית', 'quarterly', now + 6 * DAY],
    ['pm-sea-solar', 'sea-solar', 'בדיקת מערכת סולארית', 'quarterly', now + 40 * DAY],
  ]));
  (await put(`INSERT INTO invoices (id, number, building_id, description, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`, [
    [101, '0991', 'sea', 'ריטיינר חודשי · ספטמבר', 4800, 'paid', now - 42 * DAY],
    [102, '0992', 'givah', 'ריטיינר חודשי · ספטמבר', 2200, 'paid', now - 42 * DAY],
    [103, '0993', 'herzl', 'תיקון מזגן הסלון', 760, 'paid', now - 20 * DAY],
    [104, '0994', 'givah', 'החלפת ממטרות בגינה', 520, 'paid', now - 15 * DAY],
    [105, '1005', 'sea', 'קריאה 2405 · טיפול במזגן המרכזי (ספק)', 1350, 'draft', now - 2 * H],
  ]));
  (await put(`INSERT INTO part_movements (id, part_id, direction, quantity, note, call_id, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?) ON CONFLICT DO NOTHING`, [
    [101, 'p-filter', 'in', 4, 'קבלת סחורה', now - 21 * DAY],
    [102, 'p-filter', 'out', 1, 'ניקוי משאבת בריכה', now - 9 * DAY],
    [103, 'p-chlor', 'in', 4, 'קבלת סחורה', now - 30 * DAY],
    [104, 'p-chlor', 'out', 3, 'טיפול שבועי בבריכה', now - 6 * DAY],
    [105, 'p-cap', 'out', 1, 'תיקון מזגן הסלון', now - 20 * DAY],
    [106, 'p-valve', 'out', 2, 'החלפת ברזים בחדר השירות', now - 4 * DAY],
  ]));
  (await put(`INSERT INTO outbound_emails (id, call_id, building_id, to_user_id, to_email, subject, body, status, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ronit') ON CONFLICT DO NOTHING`, [
    [101, 2405, 'sea', 'dana', 'dana.levi@villa-demo.invalid', 'קירור הצפון בדרך אליכם', 'הספק קירור הצפון יגיע לבדיקת המזגן המרכזי. נעדכן במועד המדויק.', EMAIL_PENDING, now - 5 * H],
    [102, 2402, 'herzl', 'avi', 'avi.sharon@villa-demo.invalid', 'הטכנאי בטיפול בנזילה', 'אייל ברק נמצא בדירה ומטפל בנזילה בחדר הרחצה.', EMAIL_PENDING, now - 3 * H],
  ]));
  // drop leftovers from early testing (calls that no longer exist)
  (await db.prepare(`DELETE FROM sms_log WHERE body LIKE '%קריאה 24%' AND body NOT LIKE '%2401%' AND body NOT LIKE '%2402%' AND body NOT LIKE '%2403%' AND body NOT LIKE '%2404%' AND body NOT LIKE '%2405%' AND body NOT LIKE '%2406%'`).run());
  (await put(`INSERT INTO sms_log (id, to_phone, body, created_at, status) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`, [
    [101, DEMO_PHONES.dani, 'שובצת לתחזוקה מונעת: טיפול משאבת השקיה בבית האקליפטוס', now - 26 * H, SMS_PENDING],
    [102, DEMO_PHONES.michal, 'שובצת לקריאה: תאורת הכניסה מהבהבת בבית האקליפטוס', now - 30 * H, SMS_PENDING],
    [103, DEMO_PHONES.dana, 'עדכון מהמוקד: קירור הצפון יגיעו לבדיקת המזגן המרכזי', now - 5 * H, SMS_PENDING],
  ]));
  (await put(`INSERT INTO notifications (id, user_id, call_id, text, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`, [
    [101, 'eyal', 2402, 'שובצת לקריאה 2402: נזילה מתחת לכיור בחדר הרחצה', now - 4 * H, now - 4 * H],
    [102, 'eyal', 2402, 'הודעה חדשה בקריאה 2402 מאבי שרון: שמתי דלי. הנזילה מהסיפון, לא מהברז.', null, now - 3 * H],
  ]));
  // the script starts with 2401's quote pending: drop stale "approved" notices from earlier runs
  (await db.prepare(`DELETE FROM notifications WHERE call_id = 2401 AND text LIKE '%2401 אושרה%'`).run());
  // planned maintenance call goes to a technician so nothing waits unassigned
  (await db.prepare(`UPDATE calls SET assignee_id = 'dani', status = 'assigned' WHERE id = 2406 AND assignee_id IS NULL AND status = 'new'`).run());
}

async function ensureDemo(db) {
  const setPhone = db.prepare('UPDATE users SET phone = ? WHERE id = ?');
  for (const [id, phone] of Object.entries(DEMO_PHONES)) (await setPhone.run(phone, id));

  const DEMO_EMAILS = {
    dana: 'dana.levi@villa-demo.invalid',
    avi: 'avi.sharon@villa-demo.invalid',
  };
  const setEmail = db.prepare(`UPDATE users SET email = ? WHERE id = ? AND (email IS NULL OR trim(email) = '')`);
  for (const [id, email] of Object.entries(DEMO_EMAILS)) (await setEmail.run(email, id));

  const setHash = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
  for (const [id, password] of Object.entries(DEMO_PASSWORDS)) {
    const row = (await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id));
    if (!row) continue;
    if (!row.password_hash || !verifyPassword(password, row.password_hash)) {
      (await setHash.run(hashPassword(password), id));
    }
  }
  (await retargetLuxury(db));
  (await require('./schedule').seedDemo(db));
  (await seedShowcase(db));
  (await seedDemoHistory(db));

  const now = Date.now();
  const h = 60 * 60 * 1000;
  (await db.prepare(`
    UPDATE calls
    SET status = 'new',
        urgency = 'emergency',
        assignee_id = NULL,
        vendor_id = NULL,
        quote_amount = 350,
        quote_note = 'החלפת מקטע צנרת בחדר המכונות',
        quote_status = 'pending',
        quote_decided_at = NULL,
        paused_ms = 0,
        pause_started_at = NULL,
        created_at = ?,
        updated_at = ?
    WHERE id = 2401
  `).run(now - Math.round(3.5 * h), now - Math.round(3.4 * h)));

  (await db.prepare(`
    UPDATE calls
    SET status = 'in_progress',
        urgency = 'urgent',
        assignee_id = 'eyal',
        vendor_id = NULL,
        quote_amount = 480,
        quote_note = 'החלפת סיפון וצינור גמיש בחדר הרחצה',
        quote_status = 'pending',
        quote_decided_at = NULL
    WHERE id = 2402
  `).run());

  const staffPhotos = (await db.prepare(`
    SELECT p.id, p.filename
    FROM photos p
    LEFT JOIN users u ON u.id = p.user_id
    WHERE p.call_id = 2402
      AND (p.phase IN ('work', 'after') OR u.role = 'employee')
  `).all());
  const delPhoto = db.prepare('DELETE FROM photos WHERE id = ?');
  for (const photo of staffPhotos) {
    (await delPhoto.run(photo.id));
    if (!photo.filename || photo.filename.startsWith('seed-')) continue;
    const full = path.join(UPLOADS, photo.filename);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }

  if ((await db.prepare('SELECT COUNT(*) AS n FROM sms_log').get()).n === 0) {
    const ins = db.prepare('INSERT INTO sms_log (to_phone, body, created_at, status) VALUES (?, ?, ?, ?)');
    (await ins.run(DEMO_PHONES.ronit, 'נפתחה קריאה 2401 בוילה הגלים: פיצוץ צינור בחדר המכונות של הבריכה', now - 3 * h, SMS_PENDING));
    (await ins.run(DEMO_PHONES.eyal, 'שובצת לקריאה 2402: נזילה מתחת לכיור בחדר הרחצה', now - 4 * h, SMS_PENDING));
  }

  if ((await db.prepare('SELECT COUNT(*) AS n FROM invoices').get()).n === 0) {
    const ins = db.prepare(`
      INSERT INTO invoices (number, building_id, description, amount, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    (await ins.run('1001', 'sea', 'ריטיינר חודשי', 4800, 'sent', now - 12 * 24 * h));
    (await ins.run('1002', 'herzl', 'ריטיינר חודשי', 0, 'draft', now - 12 * 24 * h));
    (await ins.run('1003', 'givah', 'ריטיינר חודשי', 2200, 'paid', now - 12 * 24 * h));
    (await ins.run('1004', 'herzl', 'קריאה 2402 · החלפת סיפון', 480, 'draft', now - 5 * h));
  }

  if ((await db.prepare('SELECT COUNT(*) AS n FROM part_movements').get()).n === 0) {
    const use = (await db.prepare(`SELECT created_at FROM part_uses WHERE call_id = 2402 AND part_id = 'p-siphon' ORDER BY id LIMIT 1`).get());
    const ins = db.prepare(`
      INSERT INTO part_movements (part_id, direction, quantity, note, call_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    (await ins.run('p-siphon', 'in', 12, 'מלאי פתיחה', null, now - 40 * 24 * h));
    (await ins.run('p-siphon', 'out', 1, 'שימוש בקריאה 2402', 2402, use ? use.created_at : now - 2 * h));
    (await ins.run('p-lamp', 'in', 24, 'מלאי פתיחה', null, now - 40 * 24 * h));
    (await ins.run('p-flex', 'in', 8, 'קבלת סחורה', null, now - 15 * 24 * h));
  }
}

module.exports = {
  ROOT,
  DATA,
  UPLOADS,
  DB_PATH,
  DEMO_DATA,
  STATUSES,
  URGENCIES,
  CATEGORIES,
  PAUSE_STATUSES,
  ASSET_STATUSES,
  CONTRACT_TYPES,
  STATUS_LABEL,
  URGENCY_LABEL,
  ASSET_STATUS_LABEL,
  CONTRACT_LABEL,
  CADENCE_LABEL,
  INVOICE_STATUS,
  SMS_PENDING,
  EMAIL_PENDING,
  DEMO_PHONES,
  SLA_HOURS,
  open,
  slaOf,
  shapeUser,
  includedLabel,
  digitsPhone,
  displayPhone,
  hashPassword,
  verifyPassword,
};

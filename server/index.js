const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const dbmod = require('./db');
const reportExport = require('./reportExport');

let db; // set by start() once the database is open and seeded
const DIST = path.join(dbmod.ROOT, 'client', 'dist');

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg']);
const KIND_CATEGORY = {
  elevator: 'מעלית',
  pump: 'אינסטלציה',
  boiler: 'אינסטלציה',
  generator: 'חשמל',
  ac: 'מיזוג',
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, dbmod.UPLOADS),
  filename: (req, file, cb) => {
    const raw = path.extname(file.originalname || '').toLowerCase();
    const ext = ALLOWED_EXT.has(raw) ? raw : '.jpg';
    cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      cb(new Error('אפשר להעלות רק תמונות'));
      return;
    }
    cb(null, true);
  },
});

async function mapAsync(list, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += 1) out.push(await fn(list[i], i));
  return out;
}

async function filterAsync(list, fn) {
  const out = [];
  for (let i = 0; i < list.length; i += 1) if (await fn(list[i], i)) out.push(list[i]);
  return out;
}

const CALL_SELECT = `
  SELECT c.*,
    b.name AS building_name,
    b.address AS address,
    b.city AS city,
    b.profile AS building_profile,
    b.contract_name AS building_contract_name,
    b.contract_detail AS contract_detail,
    cu.name AS customer_name,
    cu.phone AS customer_phone,
    e.name AS assignee_name,
    e.trade AS assignee_trade,
    v.name AS vendor_name,
    a.name AS asset_name,
    ct.id AS contract_id,
    ct.name AS contract_title,
    ct.type AS contract_type,
    ct.monthly_fee AS monthly_fee,
    ct.included_calls AS included_calls,
    ct.response_emergency AS response_emergency,
    ct.response_urgent AS response_urgent,
    ct.response_normal AS response_normal,
    CASE c.urgency
      WHEN 'emergency' THEN COALESCE(ct.response_emergency, 2)
      WHEN 'urgent' THEN COALESCE(ct.response_urgent, 8)
      ELSE COALESCE(ct.response_normal, 48)
    END AS sla_hours,
    (SELECT body FROM messages m WHERE m.call_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
    (SELECT created_at FROM messages m WHERE m.call_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
    (SELECT COUNT(*) FROM photos p WHERE p.call_id = c.id) AS photo_count,
    (SELECT COUNT(*) FROM photos p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE p.call_id = c.id
        AND (p.phase IN ('work', 'after') OR u.role = 'employee')
    ) AS work_photo_count
  FROM calls c
  JOIN buildings b ON b.id = c.building_id
  LEFT JOIN users cu ON cu.id = c.customer_id
  LEFT JOIN users e ON e.id = c.assignee_id
  LEFT JOIN vendors v ON v.id = c.vendor_id
  LEFT JOIN assets a ON a.id = c.asset_id
  LEFT JOIN contracts ct ON ct.building_id = c.building_id
`;

function shapeCall(row, viewer) {
  const manager = viewer && viewer.role === 'manager';
  const staff = viewer && (viewer.role === 'manager' || viewer.role === 'employee');
  const contract = row.contract_id ? {
    id: row.contract_id,
    name: row.contract_title,
    type: row.contract_type,
    typeLabel: dbmod.CONTRACT_LABEL[row.contract_type] || row.contract_title,
    monthlyFee: row.monthly_fee,
    includedCalls: row.included_calls,
    includedLabel: dbmod.includedLabel({ type: row.contract_type, included_calls: row.included_calls }),
    responseEmergency: row.response_emergency,
    responseUrgent: row.response_urgent,
    responseNormal: row.response_normal,
  } : null;
  return {
    id: row.id,
    buildingId: row.building_id,
    buildingName: row.building_name,
    address: row.address,
    buildingProfile: manager ? row.building_profile : undefined,
    contractName: manager ? (contract ? contract.name : row.building_contract_name) : undefined,
    contractDetail: manager ? row.contract_detail : undefined,
    contract: manager ? contract : undefined,
    unit: row.unit,
    customerId: row.customer_id,
    customerName: row.customer_name || row.reporter_name,
    customerPhone: staff ? dbmod.displayPhone(row.customer_phone) : undefined,
    isDemo: row.is_demo ? true : undefined,
    wazeUrl: staff && (row.address || row.city)
      ? `https://www.waze.com/ul?q=${encodeURIComponent([row.address, row.city].filter(Boolean).join(', '))}&navigate=yes`
      : undefined,
    telUrl: staff && row.customer_phone ? `tel:${dbmod.digitsPhone(row.customer_phone)}` : undefined,
    category: row.category,
    urgency: row.urgency,
    description: row.description,
    status: row.status,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    assigneeTrade: row.assignee_trade,
    vendorId: row.vendor_id || null,
    vendorName: row.vendor_name || null,
    assetId: row.asset_id || null,
    assetName: row.asset_name || null,
    pmPlanId: row.pm_plan_id || null,
    quote: row.quote_status ? {
      amount: row.quote_amount,
      note: row.quote_note,
      status: row.quote_status,
      decidedAt: row.quote_decided_at,
    } : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessage: row.last_message,
    lastMessageAt: row.last_message_at,
    photoCount: row.photo_count,
    hasCompletionPhoto: Number(row.work_photo_count) > 0,
    sla: dbmod.slaOf(row),
  };
}

async function loadCallRow(id) {
  return (await db.prepare(`${CALL_SELECT} WHERE c.id = ?`).get(id));
}

function isChair(user) {
  return !!(user && user.role === 'customer' && user.access === 'chair');
}

function canSee(user, row) {
  if (!user || !row) return false;
  if (user.role === 'manager') return true;
  if (user.role === 'employee') return row.assignee_id === user.id;
  if (user.role !== 'customer') return false;
  if (!user.building_id || row.building_id !== user.building_id) return false;
  if (isChair(user)) return true;
  if (row.customer_id === user.id) return true;
  if (user.unit_label && row.unit && row.unit === user.unit_label) return true;
  return false;
}

function presentPhoto(p) {
  return { id: p.id, url: `/uploads/${p.filename}`, createdAt: p.created_at, phase: p.phase || 'report' };
}

async function workPhotoCount(callId) {
  return (await db.prepare(`
    SELECT COUNT(*) AS n
    FROM photos p
    LEFT JOIN users u ON u.id = p.user_id
    WHERE p.call_id = ?
      AND (p.phase IN ('work', 'after') OR u.role = 'employee')
  `).get(callId)).n;
}

async function partsUsed(callId) {
  return (await db.prepare(`
    SELECT pu.id, pu.quantity, pu.created_at, pu.part_id, pu.user_id, p.name, p.sku, u.name AS user_name
    FROM part_uses pu
    JOIN parts p ON p.id = pu.part_id
    JOIN users u ON u.id = pu.user_id
    WHERE pu.call_id = ?
    ORDER BY pu.created_at ASC, pu.id ASC
  `).all(callId)).map((r) => ({
    id: r.id,
    partId: r.part_id,
    name: r.name,
    sku: r.sku,
    quantity: r.quantity,
    userId: r.user_id,
    userName: r.user_name,
    createdAt: r.created_at,
  }));
}

async function hydrate(row, viewer) {
  const messages = (await db.prepare(`
    SELECT m.id, m.body, m.created_at, m.user_id, u.name AS author_name, u.role AS author_role, u.role_label AS author_role_label, u.trade AS author_trade
    FROM messages m JOIN users u ON u.id = m.user_id
    WHERE m.call_id = ?
    ORDER BY m.created_at ASC, m.id ASC
  `).all(row.id));
  const photos = (await db.prepare(`SELECT * FROM photos WHERE call_id = ? ORDER BY created_at ASC, id ASC`).all(row.id));
  const events = (await db.prepare(`
    SELECT e.id, e.text, e.created_at, e.actor_id, u.name AS actor_name
    FROM events e LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.call_id = ?
    ORDER BY e.created_at ASC, e.id ASC
  `).all(row.id));
  const shapedMessages = messages.map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.created_at,
    authorId: m.user_id,
    authorName: m.author_name,
    authorRole: m.author_role,
    authorRoleLabel: m.author_role_label,
    authorTrade: m.author_trade,
    photos: photos.filter((p) => p.message_id === m.id).map(presentPhoto),
  }));
  return {
    ...shapeCall(row, viewer),
    messages: shapedMessages,
    photos: photos.filter((p) => !p.message_id && (p.phase || 'report') === 'report').map(presentPhoto),
    workPhotos: photos.filter((p) => !p.message_id && (p.phase === 'work' || p.phase === 'after')).map(presentPhoto),
    events: events.map((e) => ({
      id: e.id,
      text: e.text,
      createdAt: e.created_at,
      actorId: e.actor_id,
      actorName: e.actor_name,
    })),
    partsUsed: (await partsUsed(row.id)),
    canClose: (await workPhotoCount(row.id)) > 0,
    owner: viewer && viewer.role === 'manager' ? (await presentOwner(row)) : undefined,
    mail: (await presentMail(row.id, viewer)),
  };
}

async function propertyOwner(row) {
  if (!row) return null;
  if (row.customer_id) {
    const customer = (await db.prepare('SELECT * FROM users WHERE id = ?').get(row.customer_id));
    if (customer && customer.role === 'customer' && customer.building_id === row.building_id && customer.access === 'chair') {
      return customer;
    }
  }
  return (await db.prepare(`
    SELECT * FROM users
    WHERE role = 'customer' AND access = 'chair' AND building_id = ?
    ORDER BY name
    LIMIT 1
  `).get(row.building_id)) || null;
}

async function presentOwner(row) {
  const owner = (await propertyOwner(row));
  if (!owner) return null;
  return { id: owner.id, name: owner.name, email: owner.email || '' };
}

async function presentMail(callId, viewer) {
  if (!viewer || viewer.role === 'employee') return undefined;
  const rows = (await db.prepare(`
    SELECT id, subject, body, to_email, status, created_at
    FROM outbound_emails
    WHERE call_id = ?
    ORDER BY created_at DESC, id DESC
  `).all(callId));
  if (viewer.role === 'customer') {
    return rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      status: r.status,
      createdAt: r.created_at,
    }));
  }
  return rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    body: r.body,
    to: r.to_email,
    status: r.status,
    createdAt: r.created_at,
  }));
}

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || email.length > 120) return '';
  if (!/^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z0-9.-]+$/.test(email)) return '';
  return email;
}

async function currentUser(req) {
  const token = req.cookies && req.cookies.achzaka_sid;
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = (await db.prepare('SELECT * FROM sessions WHERE token = ?').get(token));
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    (await db.prepare('DELETE FROM sessions WHERE token = ?').run(token));
    return null;
  }
  const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id));
  if (!user) return null;
  if (user.unit_id) {
    const unit = (await db.prepare('SELECT label FROM units WHERE id = ?').get(user.unit_id));
    user.unit_label = unit ? unit.label : null;
  } else {
    user.unit_label = null;
  }
  return user;
}

async function requireUser(req, res, roles) {
  const user = (await currentUser(req));
  if (!user) {
    res.status(401).json({ error: 'נדרשת כניסה' });
    return null;
  }
  if (roles && !roles.includes(user.role)) {
    res.status(403).json({ error: 'אין הרשאה לאזור הזה' });
    return null;
  }
  return user;
}

function cleanup(files) {
  for (const f of files || []) {
    fs.unlink(f.path, () => {});
  }
}

async function publicUser(row) {
  const building = row.building_id
    ? (await db.prepare('SELECT id, name, address FROM buildings WHERE id = ?').get(row.building_id))
    : null;
  const shaped = dbmod.shapeUser(row, building);
  if (!shaped) return null;
  return {
    ...shaped,
    access: row.access || (row.role === 'customer' ? 'tenant' : null),
  };
}

const DOOR_ERROR = {
  manager: 'החשבון הזה אינו מנהל',
  owner: 'החשבון הזה אינו בעל נכס',
  technician: 'החשבון הזה אינו טכנאי',
};

function accountDoor(row) {
  if (row.role === 'manager') return 'manager';
  if (row.role === 'employee') return 'technician';
  if (row.role === 'customer' && row.access === 'chair') return 'owner';
  return null;
}

async function addNotification(userId, callId, text, now) {
  if (!userId) return;
  (await db.prepare(`INSERT INTO notifications (user_id, call_id, text, created_at) VALUES (?, ?, ?, ?)`).run(userId, callId || null, text, now));
}

async function notifyManagers(text, callId, now, exceptId) {
  const rows = (await db.prepare(`SELECT id FROM users WHERE role = 'manager'`).all());
  for (const r of rows) {
    if (r.id !== exceptId) (await addNotification(r.id, callId, text, now));
  }
}

async function allowedSmsPhones() {
  return new Set((await db.prepare('SELECT phone FROM users').all()).map((row) => dbmod.digitsPhone(row.phone)).filter(Boolean));
}

function twilioCreds() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return null;
  return { sid, token, from };
}

// Real Twilio REST only when all three credentials exist. Otherwise the caller
// leaves the row at ממתין לחיבור SMS and nothing is sent. Never mark נשלח without a 2xx.
function sendTwilioSms(to, body) {
  const creds = twilioCreds();
  if (!creds) return Promise.resolve({ attempted: false });
  const params = new URLSearchParams({ To: to, From: creds.from, Body: body });
  const auth = Buffer.from(`${creds.sid}:${creds.token}`).toString('base64');
  // Hard timeout so a stuck Twilio never pins sockets or delays later work.
  return fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(creds.sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
    signal: AbortSignal.timeout(8000),
  }).then((resp) => ({ attempted: true, ok: resp.ok })).catch(() => ({ attempted: true, ok: false }));
}

async function queueSms(toPhone, body) {
  const to = dbmod.digitsPhone(toPhone);
  if (!to || !(await allowedSmsPhones()).has(to)) return;
  const now = Date.now();
  const info = (await db.prepare('INSERT INTO sms_log (to_phone, body, created_at, status) VALUES (?, ?, ?, ?)').run(
    to,
    body,
    now,
    dbmod.SMS_PENDING,
  ));
  if (!twilioCreds()) return;
  const id = Number(info.lastInsertRowid);
  sendTwilioSms(to, body).then(async (result) => {
    if (!result.attempted) return;
    (await db.prepare('UPDATE sms_log SET status = ? WHERE id = ?').run(result.ok ? 'נשלח' : 'נכשל', id));
  });
}

async function smsManager(body) {
  const manager = (await db.prepare(`SELECT phone FROM users WHERE role = 'manager' ORDER BY name LIMIT 1`).get());
  if (manager) (await queueSms(manager.phone, body));
}

async function notifyParties(row, senderId, text, now) {
  const ids = new Set();
  if (row.customer_id) ids.add(row.customer_id);
  if (row.assignee_id) ids.add(row.assignee_id);
  (await db.prepare(`SELECT id FROM users WHERE role = 'manager'`).all()).forEach((r) => ids.add(r.id));
  ids.delete(senderId);
  for (const id of ids) (await addNotification(id, row.id, text, now));
}

function shapeAsset(row) {
  return {
    id: row.id,
    buildingId: row.building_id,
    buildingName: row.building_name,
    name: row.name,
    kind: row.kind,
    location: row.location,
    serial: row.serial,
    nextServiceAt: row.next_service_at,
    status: row.status,
    statusLabel: dbmod.ASSET_STATUS_LABEL[row.status] || row.status,
  };
}

const IS_PROD = process.env.NODE_ENV === 'production';
// DEMO_OTP shows login codes on screen; it can never be on in production.
const DEMO_MODE = process.env.DEMO_OTP === '1' && !IS_PROD;
if (IS_PROD && process.env.DEMO_OTP === '1') console.warn('DEMO_OTP=1 ignored because NODE_ENV=production');

const app = express();
// Express 4 does not catch rejected promises from async handlers; route them to the error handler.
for (const method of ['get', 'post', 'put', 'patch', 'delete', 'use']) {
  const original = app[method].bind(app);
  app[method] = (...args) => original(...args.map((fn) => (typeof fn === 'function' && fn.length < 4
    ? (req, res, next) => {
      try {
        const out = fn(req, res, next);
        if (out && typeof out.catch === 'function') out.catch(next);
      } catch (err) {
        next(err);
      }
    }
    : fn)));
}
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'achzaka', demo: DEMO_MODE });
});

// Render health check: the process is up and the database answers.
app.get('/healthz', async (req, res) => {
  try {
    await db.get('SELECT 1 AS ok');
    res.set('Cache-Control', 'no-store').json({ ok: true, db: db.kind });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'database unavailable' });
  }
});

const ownerRole = { role: 'customer', access: 'chair', roleLabel: 'בעל הנכס', title: 'בעל הנכס' };
const ROLE_SPECS = {
  tenant: { role: 'customer', access: 'tenant', roleLabel: 'דייר', title: 'דייר' },
  'דייר': { role: 'customer', access: 'tenant', roleLabel: 'דייר', title: 'דייר' },
  chair: ownerRole,
  'יו"ר ועד': ownerRole,
  'בעל הנכס': ownerRole,
  'בעל נכס': ownerRole,
  technician: { role: 'employee', access: null, roleLabel: 'טכנאי', title: 'טכנאי שטח' },
  employee: { role: 'employee', access: null, roleLabel: 'טכנאי', title: 'טכנאי שטח' },
  'טכנאי': { role: 'employee', access: null, roleLabel: 'טכנאי', title: 'טכנאי שטח' },
  manager: { role: 'manager', access: null, roleLabel: 'מנהל', title: 'מנהל' },
  'מנהל': { role: 'manager', access: null, roleLabel: 'מנהל', title: 'מנהל' },
};

async function findByPhone(phone) {
  const digits = dbmod.digitsPhone(phone);
  if (!digits) return null;
  return (await db.prepare('SELECT * FROM users').all()).find((row) => dbmod.digitsPhone(row.phone) === digits) || null;
}

async function clearSession(req, res) {
  const token = req.cookies && req.cookies.achzaka_sid;
  if (token) (await db.prepare('DELETE FROM sessions WHERE token = ?').run(token));
  res.clearCookie('achzaka_sid', { path: '/' });
  res.clearCookie('achzaka_uid', { path: '/' });
}

async function issueSession(res, user, req) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  (await db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    token,
    user.id,
    now,
    now + 1000 * 60 * 60 * 24 * 30,
  ));
  const forwarded = req && String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const secure = !!(req && (req.secure || forwarded === 'https'));
  res.cookie('achzaka_sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 30,
  });
  res.clearCookie('achzaka_uid', { path: '/' });
}

async function directoryUser(row) {
  const building = row.building_id
    ? (await db.prepare('SELECT id, name FROM buildings WHERE id = ?').get(row.building_id))
    : null;
  const unit = row.unit_id
    ? (await db.prepare('SELECT id, label, floor, building_id FROM units WHERE id = ?').get(row.unit_id))
    : null;
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    roleLabel: row.role_label,
    access: row.access || (row.role === 'customer' ? 'tenant' : null),
    title: row.title,
    trade: row.trade,
    phone: dbmod.displayPhone(row.phone),
    buildingId: row.building_id || null,
    buildingName: building ? building.name : null,
    unitId: unit ? unit.id : null,
    unitLabel: unit ? unit.label : null,
    unitFloor: unit ? unit.floor : null,
  };
}

function presentUnit(row) {
  return { id: row.id, buildingId: row.building_id, label: row.label, floor: row.floor || '' };
}

app.post('/api/auth/login', async (req, res) => {
  const phone = dbmod.digitsPhone(req.body && req.body.phone);
  const password = String((req.body && req.body.password) != null ? req.body.password : '');
  const user = phone ? (await findByPhone(phone)) : null;
  if (!user) return res.status(401).json({ error: 'המספר לא מוכר' });
  if (!user.password_hash || !dbmod.verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'הסיסמה שגויה' });
  }
  const door = req.body && req.body.door != null ? String(req.body.door).trim() : '';
  if (door) {
    if (!Object.prototype.hasOwnProperty.call(DOOR_ERROR, door) || accountDoor(user) !== door) {
      (await clearSession(req, res));
      return res.status(403).json({ error: DOOR_ERROR[door] || 'החשבון הזה אינו תואם לתפקיד שנבחר' });
    }
  }
  (await issueSession(res, user, req));
  res.json({ user: (await publicUser(user)) });
});

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_COOLDOWN_MS = 30 * 1000;

// DEMO_OTP=1 returns the code for any known phone while Twilio is not configured,
// including someone the manager just added. Unknown phones still get only { pending: true }.
// Turn DEMO_OTP off once real SMS exists. With TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
// and TWILIO_FROM_NUMBER all set, the code is sent by SMS and is never returned.
function otpPayload(phone, code) {
  const payload = { pending: true };
  if (DEMO_MODE && !twilioCreds() && phone) {
    payload.code = code;
  }
  return payload;
}

app.post('/api/auth/otp/request', async (req, res) => {
  const phone = dbmod.digitsPhone(req.body && req.body.phone);
  if (!phone) return res.json({ pending: true });
  const now = Date.now();
  const recent = (await db.prepare('SELECT created_at FROM login_codes WHERE phone = ? ORDER BY id DESC LIMIT 1').get(phone));
  if (recent && now - recent.created_at < OTP_COOLDOWN_MS) {
    return res.status(429).json({ error: 'אפשר לבקש קוד נוסף בעוד חצי דקה' });
  }
  const user = (await findByPhone(phone));
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const codeHash = dbmod.hashPassword(code);
  (await db.prepare('UPDATE login_codes SET used_at = ? WHERE phone = ? AND used_at IS NULL').run(now, phone));
  (await db.prepare('INSERT INTO login_codes (phone, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    phone,
    user ? codeHash : null,
    now,
    now + OTP_TTL_MS,
  ));
  if (user && twilioCreds()) {
    sendTwilioSms(phone, `קוד הכניסה לאחזקה: ${code}`).catch(() => {});
  }
  res.json(user ? otpPayload(phone, code) : { pending: true });
});

app.post('/api/auth/otp/verify', async (req, res) => {
  const phone = dbmod.digitsPhone(req.body && req.body.phone);
  const code = String((req.body && req.body.code) != null ? req.body.code : '').replace(/\D/g, '');
  const door = req.body && req.body.door != null ? String(req.body.door).trim() : '';
  const user = phone ? (await findByPhone(phone)) : null;
  const row = phone
    ? (await db.prepare(`
        SELECT * FROM login_codes
        WHERE phone = ? AND used_at IS NULL AND code_hash IS NOT NULL AND expires_at > ?
        ORDER BY id DESC LIMIT 1
      `).get(phone, Date.now()))
    : null;
  const match = !!(row && code.length === 6 && dbmod.verifyPassword(code, row.code_hash));
  if (!user || !match) return res.status(401).json({ error: 'הקוד שגוי' });
  if (!Object.prototype.hasOwnProperty.call(DOOR_ERROR, door) || accountDoor(user) !== door) {
    (await clearSession(req, res));
    return res.status(403).json({ error: DOOR_ERROR[door] || 'החשבון הזה אינו תואם לתפקיד שנבחר' });
  }
  const consumed = (await db.prepare('UPDATE login_codes SET used_at = ? WHERE id = ? AND used_at IS NULL').run(Date.now(), row.id));
  if (!consumed.changes) return res.status(401).json({ error: 'הקוד שגוי' });
  (await issueSession(res, user, req));
  res.json({ user: (await publicUser(user)) });
});

app.delete('/api/session', async (req, res) => {
  (await clearSession(req, res));
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  const user = (await currentUser(req));
  if (!user) return res.status(204).end();
  res.json((await publicUser(user)));
});

app.get('/api/buildings', async (req, res) => {
  const user = (await requireUser(req, res));
  if (!user) return;
  let rows = (await db.prepare('SELECT * FROM buildings ORDER BY name').all());
  if (user.role === 'customer') {
    rows = user.building_id ? rows.filter((b) => b.id === user.building_id) : [];
  }
  res.json(await mapAsync(rows, async (b) => {
    const base = { id: b.id, name: b.name, address: b.address, city: b.city || '', lat: b.lat, lng: b.lng };
    if (user.role !== 'manager') return base;
    const open = (await db.prepare(`SELECT COUNT(*) AS n FROM calls WHERE building_id = ? AND status NOT IN ('done', 'closed')`).get(b.id)).n;
    const contract = (await db.prepare('SELECT name FROM contracts WHERE building_id = ?').get(b.id));
    return {
      ...base,
      profile: b.profile,
      contractName: contract ? contract.name : b.contract_name,
      contractDetail: b.contract_detail,
      openCalls: open,
    };
  }));
});

app.get('/api/team', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const rows = (await db.prepare(`SELECT * FROM users WHERE role = 'employee' ORDER BY name`).all());
  res.json(await mapAsync(rows, async (r) => {
    const openCalls = (await db.prepare(`SELECT COUNT(*) AS n FROM calls WHERE assignee_id = ? AND status NOT IN ('done', 'closed')`).get(r.id)).n;
    return {
      id: r.id,
      name: r.name,
      trade: r.trade,
      phone: dbmod.displayPhone(r.phone),
      title: r.title,
      openCalls,
    };
  }));
});

app.get('/api/assets', async (req, res) => {
  const user = (await requireUser(req, res));
  if (!user) return;
  if (user.role === 'employee') return res.status(403).json({ error: 'אין הרשאה לאזור הזה' });
  const params = [];
  let sql = `
    SELECT a.*, b.name AS building_name
    FROM assets a JOIN buildings b ON b.id = a.building_id
    WHERE 1=1
  `;
  if (user.role === 'customer') {
    if (!user.building_id) return res.json([]);
    sql += ' AND a.building_id = ?';
    params.push(user.building_id);
  } else if (req.query.buildingId) {
    sql += ' AND a.building_id = ?';
    params.push(req.query.buildingId);
  }
  sql += ' ORDER BY b.name, a.name';
  res.json((await db.prepare(sql).all(...params)).map(shapeAsset));
});

app.get('/api/maintenance', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const now = Date.now();
  const rows = (await db.prepare(`
    SELECT p.*, a.name AS asset_name, a.location AS asset_location, a.building_id, b.name AS building_name, a.status AS asset_status
    FROM pm_plans p
    JOIN assets a ON a.id = p.asset_id
    JOIN buildings b ON b.id = a.building_id
    ORDER BY p.next_due_at ASC
  `).all());
  res.json(rows.map((r) => ({
    id: r.id,
    name: r.name,
    cadence: r.cadence,
    cadenceLabel: dbmod.CADENCE_LABEL[r.cadence] || r.cadence,
    nextDueAt: r.next_due_at,
    overdue: r.next_due_at < now,
    lastCallId: r.last_call_id,
    assetId: r.asset_id,
    assetName: r.asset_name,
    assetLocation: r.asset_location,
    assetStatus: r.asset_status,
    buildingId: r.building_id,
    buildingName: r.building_name,
  })));
});

app.post('/api/maintenance/:id/call', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const plan = (await db.prepare(`
    SELECT p.*, a.name AS asset_name, a.kind, a.location, a.building_id, b.name AS building_name
    FROM pm_plans p
    JOIN assets a ON a.id = p.asset_id
    JOIN buildings b ON b.id = a.building_id
    WHERE p.id = ?
  `).get(req.params.id));
  if (!plan) return res.status(404).json({ error: 'תוכנית התחזוקה לא נמצאה' });
  const now = Date.now();
  const category = KIND_CATEGORY[plan.kind] || 'אחר';
  const description = `תחזוקה מונעת: ${plan.name}`;
  const info = (await db.prepare(`
    INSERT INTO calls (building_id, unit, customer_id, reporter_name, category, urgency, description, status, assignee_id, asset_id, pm_plan_id, created_at, updated_at)
    VALUES (?, ?, NULL, ?, ?, 'normal', ?, 'new', NULL, ?, ?, ?, ?)
  `).run(plan.building_id, plan.location, 'תחזוקה מונעת', category, description, plan.asset_id, plan.id, now, now));
  const id = Number(info.lastInsertRowid);
  const bump = plan.cadence === 'quarterly' ? 90 : 30;
  (await db.prepare(`UPDATE pm_plans SET last_call_id = ?, next_due_at = ? WHERE id = ?`).run(id, now + bump * 24 * 60 * 60 * 1000, plan.id));
  (await db.prepare(`INSERT INTO events (call_id, actor_id, text, created_at) VALUES (?, ?, ?, ?)`).run(id, user.id, 'נפתחה קריאה מתחזוקה מונעת', now));
  (await db.prepare(`INSERT INTO messages (call_id, user_id, body, created_at) VALUES (?, ?, ?, ?)`).run(id, user.id, description, now));
  (await notifyManagers(`נפתחה קריאת תחזוקה ${id}: ${plan.name}`, id, now, user.id));
  (await smsManager(`נפתחה קריאה ${id} ב${plan.building_name}: ${description}`));
  res.status(201).json((await hydrate((await loadCallRow(id)), user)));
});

app.get('/api/vendors', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const rows = (await db.prepare(`SELECT * FROM vendors ORDER BY name`).all());
  res.json(await mapAsync(rows, async (v) => ({
    id: v.id,
    name: v.name,
    trade: v.trade,
    phone: v.phone,
    notes: v.notes,
    openCalls: (await db.prepare(`SELECT COUNT(*) AS n FROM calls WHERE vendor_id = ? AND status NOT IN ('done', 'closed')`).get(v.id)).n,
  })));
});

app.get('/api/parts', async (req, res) => {
  const user = (await requireUser(req, res, ['manager', 'employee']));
  if (!user) return;
  const rows = (await db.prepare(`SELECT * FROM parts ORDER BY name`).all());
  res.json(rows.map((p) => {
    const base = { id: p.id, name: p.name, sku: p.sku, quantity: p.quantity };
    if (user.role !== 'manager') return base;
    return { ...base, minQuantity: p.min_quantity, low: p.quantity < p.min_quantity };
  }));
});

app.get('/api/contracts', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const rows = (await db.prepare(`
    SELECT ct.*, b.name AS building_name, b.address
    FROM contracts ct JOIN buildings b ON b.id = ct.building_id
    ORDER BY b.name
  `).all());
  res.json(await mapAsync(rows, async (r) => ({
    id: r.id,
    buildingId: r.building_id,
    buildingName: r.building_name,
    address: r.address,
    name: r.name,
    type: r.type,
    typeLabel: dbmod.CONTRACT_LABEL[r.type] || r.type,
    monthlyFee: r.monthly_fee,
    includedCalls: r.included_calls,
    includedLabel: dbmod.includedLabel(r),
    responseEmergency: r.response_emergency,
    responseUrgent: r.response_urgent,
    responseNormal: r.response_normal,
    openCalls: (await db.prepare(`SELECT COUNT(*) AS n FROM calls WHERE building_id = ? AND status NOT IN ('done', 'closed')`).get(r.building_id)).n,
  })));
});

app.get('/api/reports', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const calls = (await db.prepare(CALL_SELECT).all()).map((row) => shapeCall(row, user));
  const buildings = (await db.prepare(`SELECT id, name FROM buildings ORDER BY name`).all());
  const byBuilding = buildings.map((b) => ({
    id: b.id,
    name: b.name,
    total: calls.filter((c) => c.buildingId === b.id).length,
    open: calls.filter((c) => c.buildingId === b.id && c.status !== 'done' && c.status !== 'closed').length,
  }));
  const byStatus = dbmod.STATUSES.map((status) => ({
    status,
    label: dbmod.STATUS_LABEL[status],
    count: calls.filter((c) => c.status === status).length,
  }));
  const team = (await db.prepare(`SELECT id, name, trade FROM users WHERE role = 'employee' ORDER BY name`).all());
  const technicianLoad = team.map((t) => ({
    id: t.id,
    name: t.name,
    trade: t.trade,
    openCalls: calls.filter((c) => c.assigneeId === t.id && c.status !== 'done' && c.status !== 'closed').length,
  }));
  const overdue = calls.filter((c) => c.status !== 'done' && c.status !== 'closed' && c.sla && c.sla.late).length;
  res.json({ byBuilding, byStatus, technicianLoad, overdue });
});

async function reportCalls(user) {
  return (await db.prepare(CALL_SELECT).all()).map((row) => shapeCall(row, user));
}

// Start of the current month in Israel time, as epoch ms.
function israelMonthStart(now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', timeZoneName: 'longOffset',
  }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const offset = (parts.timeZoneName || 'GMT+03:00').replace('GMT', '') || '+00:00';
  return Date.parse(`${parts.year}-${parts.month}-01T00:00:00${offset}`);
}

// Business-value numbers for the manager board, all computed from stored calls.
app.get('/api/kpis', async (req, res) => {
  const user = await requireUser(req, res, ['manager']);
  if (!user) return;
  const now = Date.now();
  const since = now - 30 * 24 * 60 * 60 * 1000;
  const resolved = await db.all(`${CALL_SELECT} WHERE c.status IN ('done', 'closed') AND c.updated_at >= ?`, since);
  let met = 0;
  let totalMs = 0;
  for (const row of resolved) {
    const handled = Math.max(0, Number(row.updated_at) - Number(row.created_at) - (Number(row.paused_ms) || 0));
    totalMs += handled;
    const hours = Number(row.sla_hours) || dbmod.SLA_HOURS[row.urgency] || 48;
    if (handled <= hours * 60 * 60 * 1000) met += 1;
  }
  const monthStart = israelMonthStart(now);
  const quotes = await db.get(
    `SELECT COALESCE(SUM(quote_amount), 0) AS total, COUNT(*) AS n FROM calls WHERE quote_status = 'approved' AND quote_decided_at >= ?`,
    monthStart,
  );
  const unassigned = await db.get(
    `SELECT COUNT(*) AS n FROM calls WHERE status NOT IN ('done', 'closed') AND assignee_id IS NULL AND vendor_id IS NULL`,
  );
  res.json({
    windowDays: 30,
    resolved: resolved.length,
    slaMetPct: resolved.length ? Math.round((met / resolved.length) * 100) : null,
    slaMet: met,
    avgHandlingHours: resolved.length ? Math.round((totalMs / resolved.length / 3600000) * 10) / 10 : null,
    approvedQuotesMonth: Number(quotes.total) || 0,
    approvedQuotesCount: Number(quotes.n) || 0,
    monthStart,
    openUnassigned: Number(unassigned.n) || 0,
  });
});

app.get('/api/reports/calls.xlsx', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  try {
    const buffer = await reportExport.buildXlsx((await reportCalls(user)));
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', reportExport.contentDisposition('דוח-קריאות.xlsx'));
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'לא הצלחנו להפיק את קובץ האקסל' });
  }
});

app.get('/api/reports/calls.pdf', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  try {
    const buffer = await reportExport.buildPdf((await reportCalls(user)));
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', reportExport.contentDisposition('דוח-קריאות.pdf'));
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'לא הצלחנו להפיק את קובץ ה-PDF' });
  }
});

app.get('/api/notifications', async (req, res) => {
  const user = (await requireUser(req, res));
  if (!user) return;
  let rows = (await db.prepare(`
    SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50
  `).all(user.id));
  if (user.role === 'customer') {
    rows = await filterAsync(rows, async (r) => {
      if (!r.call_id) return !!user.building_id;
      return canSee(user, (await loadCallRow(r.call_id)));
    });
  } else if (user.role === 'employee') {
    rows = await filterAsync(rows, async (r) => !r.call_id || canSee(user, (await loadCallRow(r.call_id))));
  }
  res.json(rows.map((r) => ({
    id: r.id,
    callId: r.call_id,
    text: r.text,
    readAt: r.read_at,
    createdAt: r.created_at,
  })));
});

app.post('/api/notifications/read-all', async (req, res) => {
  const user = (await requireUser(req, res));
  if (!user) return;
  const now = Date.now();
  (await db.prepare(`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`).run(now, user.id));
  res.json({ ok: true });
});

app.post('/api/notifications/:id/read', async (req, res) => {
  const user = (await requireUser(req, res));
  if (!user) return;
  const row = (await db.prepare(`SELECT * FROM notifications WHERE id = ? AND user_id = ?`).get(req.params.id, user.id));
  if (!row) return res.status(404).json({ error: 'ההתראה לא נמצאה' });
  if (!row.read_at) {
    (await db.prepare(`UPDATE notifications SET read_at = ? WHERE id = ?`).run(Date.now(), row.id));
  }
  res.json({ ok: true });
});

app.get('/api/calls', async (req, res) => {
  const user = (await requireUser(req, res));
  if (!user) return;
  const params = [];
  let sql = `${CALL_SELECT} WHERE 1=1`;
  if (user.role === 'customer') {
    if (!user.building_id) return res.json([]);
    if (isChair(user)) {
      sql += ' AND c.building_id = ?';
      params.push(user.building_id);
    } else {
      const bits = ['c.customer_id = ?'];
      const bitParams = [user.id];
      if (user.unit_label) {
        bits.push('c.unit = ?');
        bitParams.push(user.unit_label);
      }
      sql += ` AND c.building_id = ? AND (${bits.join(' OR ')})`;
      params.push(user.building_id, ...bitParams);
    }
  } else if (user.role === 'employee') {
    sql += ' AND c.assignee_id = ?';
    params.push(user.id);
  }
  if (req.query.status && dbmod.STATUSES.includes(req.query.status)) {
    sql += ' AND c.status = ?';
    params.push(req.query.status);
  }
  if (req.query.buildingId) {
    if (user.role === 'customer' && req.query.buildingId !== user.building_id) {
      return res.json([]);
    }
    sql += ' AND c.building_id = ?';
    params.push(req.query.buildingId);
  }
  if (req.query.urgency && dbmod.URGENCIES.includes(req.query.urgency)) {
    sql += ' AND c.urgency = ?';
    params.push(req.query.urgency);
  }
  if (req.query.assigneeId && user.role === 'manager') {
    sql += ' AND c.assignee_id = ?';
    params.push(req.query.assigneeId);
  }
  const rows = (await db.prepare(sql).all(...params)).map((row) => shapeCall(row, user));
  if (user.role === 'employee') {
    const rank = { emergency: 0, urgent: 1, normal: 2 };
    rows.sort((a, b) => {
      const ca = a.status === 'done' || a.status === 'closed' ? 1 : 0;
      const cb = b.status === 'done' || b.status === 'closed' ? 1 : 0;
      if (ca !== cb) return ca - cb;
      if (rank[a.urgency] !== rank[b.urgency]) return rank[a.urgency] - rank[b.urgency];
      return b.updatedAt - a.updatedAt;
    });
  } else {
    rows.sort((a, b) => (a.isDemo ? 1 : 0) - (b.isDemo ? 1 : 0) || b.createdAt - a.createdAt);
  }
  res.json(rows);
});

app.get('/api/calls/:id', async (req, res) => {
  const user = (await requireUser(req, res));
  if (!user) return;
  const row = (await loadCallRow(req.params.id));
  if (!row || !canSee(user, row)) return res.status(404).json({ error: 'הקריאה לא נמצאה' });
  res.json((await hydrate(row, user)));
});

app.post('/api/calls', upload.array('photos', 8), async (req, res) => {
  const user = (await requireUser(req, res, ['customer']));
  if (!user) return cleanup(req.files);
  const buildingId = (req.body.buildingId || user.building_id || '').trim();
  const unit = (req.body.unit || '').trim();
  const category = (req.body.category || '').trim();
  const urgency = (req.body.urgency || '').trim();
  const description = (req.body.description || '').trim().replace(/\s+/g, ' ');
  const building = (await db.prepare('SELECT * FROM buildings WHERE id = ?').get(buildingId));
  if (!building || buildingId !== user.building_id) {
    cleanup(req.files);
    return res.status(400).json({ error: 'אפשר לפתוח קריאה רק בנכס שלך' });
  }
  if (!unit || unit.length > 80) {
    cleanup(req.files);
    return res.status(400).json({ error: 'חסר מיקום בנכס' });
  }
  if (!dbmod.CATEGORIES.includes(category)) {
    cleanup(req.files);
    return res.status(400).json({ error: 'בחרו קטגוריה' });
  }
  if (!dbmod.URGENCIES.includes(urgency)) {
    cleanup(req.files);
    return res.status(400).json({ error: 'בחרו דחיפות' });
  }
  if (description.length < 2 || description.length > 280) {
    cleanup(req.files);
    return res.status(400).json({ error: 'כתבו תיאור קצר של התקלה' });
  }
  const now = Date.now();
  const info = (await db.prepare(`
    INSERT INTO calls (building_id, unit, customer_id, reporter_name, category, urgency, description, status, assignee_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'new', NULL, ?, ?)
  `).run(buildingId, unit, user.id, user.name, category, urgency, description, now, now));
  const id = Number(info.lastInsertRowid);
  (await db.prepare(`INSERT INTO events (call_id, actor_id, text, created_at) VALUES (?, ?, ?, ?)`).run(id, user.id, 'הקריאה נפתחה', now));
  const message = (await db.prepare(`INSERT INTO messages (call_id, user_id, body, created_at) VALUES (?, ?, ?, ?)`).run(id, user.id, description, now));
  const messageId = Number(message.lastInsertRowid);
  const ins = db.prepare(`INSERT INTO photos (call_id, message_id, user_id, filename, phase, created_at) VALUES (?, ?, ?, ?, 'report', ?)`);
  for (const f of req.files || []) (await ins.run(id, messageId, user.id, f.filename, now));
  (await notifyManagers(`נפתחה קריאה ${id} ב${building.name}: ${description}`, id, now, null));
  (await smsManager(`נפתחה קריאה ${id} ב${building.name}: ${description}`));
  res.status(201).json((await hydrate((await loadCallRow(id)), user)));
});

app.post('/api/calls/:id/messages', upload.array('photos', 8), async (req, res) => {
  const user = (await requireUser(req, res));
  if (!user) return cleanup(req.files);
  const row = (await loadCallRow(req.params.id));
  if (!row || !canSee(user, row)) {
    cleanup(req.files);
    return res.status(404).json({ error: 'הקריאה לא נמצאה' });
  }
  const body = (req.body.body || '').trim();
  const files = req.files || [];
  if (!body && files.length === 0) return res.status(400).json({ error: 'חסרה הודעה או תמונה' });
  if (body.length > 2000) {
    cleanup(files);
    return res.status(400).json({ error: 'ההודעה ארוכה מדי' });
  }
  let phase = 'extra';
  if (user.role === 'employee' || user.role === 'manager') {
    phase = req.body.phase === 'after' ? 'after' : 'work';
  }
  const now = Date.now();
  const info = (await db.prepare(`INSERT INTO messages (call_id, user_id, body, created_at) VALUES (?, ?, ?, ?)`).run(row.id, user.id, body, now));
  const messageId = Number(info.lastInsertRowid);
  const ins = db.prepare(`INSERT INTO photos (call_id, message_id, user_id, filename, phase, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const f of files) (await ins.run(row.id, messageId, user.id, f.filename, phase, now));
  (await db.prepare(`UPDATE calls SET updated_at = ? WHERE id = ?`).run(now, row.id));
  const preview = body || (phase === 'after' ? 'תמונת סיום' : 'תמונה חדשה');
  (await notifyParties(row, user.id, `הודעה חדשה בקריאה ${row.id} מ${user.name}: ${preview}`, now));
  if (user.role === 'customer') {
    (await smsManager(`הודעה חדשה בקריאה ${row.id} מ${user.name}: ${preview}`.slice(0, 320)));
  }
  res.status(201).json((await hydrate((await loadCallRow(row.id)), user)));
});

app.post('/api/calls/:id/parts', async (req, res) => {
  const user = (await requireUser(req, res, ['manager', 'employee']));
  if (!user) return;
  const row = (await loadCallRow(req.params.id));
  if (!row || !canSee(user, row)) return res.status(404).json({ error: 'הקריאה לא נמצאה' });
  const partId = (req.body && req.body.partId) || '';
  const quantity = Number(req.body && req.body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    return res.status(400).json({ error: 'כמות לא תקינה' });
  }
  const part = (await db.prepare(`SELECT * FROM parts WHERE id = ?`).get(partId));
  if (!part) return res.status(400).json({ error: 'החלק לא נמצא' });
  if (part.quantity < quantity) return res.status(400).json({ error: 'אין מספיק במלאי' });
  const now = Date.now();
  const tx = db.txFn(async () => {
    (await db.prepare(`UPDATE parts SET quantity = quantity - ? WHERE id = ?`).run(quantity, part.id));
    (await db.prepare(`INSERT INTO part_uses (call_id, part_id, user_id, quantity, created_at) VALUES (?, ?, ?, ?, ?)`).run(row.id, part.id, user.id, quantity, now));
    (await db.prepare(`INSERT INTO part_movements (part_id, direction, quantity, note, call_id, created_at) VALUES (?, 'out', ?, ?, ?, ?)`).run(part.id, quantity, `שימוש בקריאה ${row.id}`, row.id, now));
    (await db.prepare(`INSERT INTO events (call_id, actor_id, text, created_at) VALUES (?, ?, ?, ?)`).run(row.id, user.id, `נרשם שימוש: ${part.name} × ${quantity}`, now));
    (await db.prepare(`UPDATE calls SET updated_at = ? WHERE id = ?`).run(now, row.id));
  });
  (await tx());
  res.status(201).json((await hydrate((await loadCallRow(row.id)), user)));
});

app.post('/api/calls/:id/quote', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const row = (await loadCallRow(req.params.id));
  if (!row) return res.status(404).json({ error: 'הקריאה לא נמצאה' });
  if (row.quote_status === 'approved') return res.status(400).json({ error: 'ההצעה כבר אושרה' });
  const amount = Number(req.body && req.body.amount);
  const note = ((req.body && req.body.note) || '').trim();
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000) {
    return res.status(400).json({ error: 'סכום לא תקין' });
  }
  if (note.length > 280) return res.status(400).json({ error: 'ההערה ארוכה מדי' });
  const now = Date.now();
  const ils = Math.round(amount);
  (await db.prepare(`
    UPDATE calls
    SET quote_amount = ?, quote_note = ?, quote_status = 'pending', quote_decided_at = NULL, updated_at = ?
    WHERE id = ?
  `).run(ils, note, now, row.id));
  (await db.prepare(`INSERT INTO events (call_id, actor_id, text, created_at) VALUES (?, ?, ?, ?)`).run(row.id, user.id, `נרשמה הצעת מחיר: ${ils} ש״ח`, now));
  if (row.customer_id) (await addNotification(row.customer_id, row.id, `הצעת מחיר חדשה בקריאה ${row.id}: ${ils} ש״ח`, now));
  res.json((await hydrate((await loadCallRow(row.id)), user)));
});

app.post('/api/calls/:id/quote/decision', async (req, res) => {
  const user = (await requireUser(req, res, ['customer']));
  if (!user) return;
  const row = (await loadCallRow(req.params.id));
  if (!row || !canSee(user, row)) return res.status(404).json({ error: 'הקריאה לא נמצאה' });
  if (!isChair(user) && row.customer_id !== user.id) return res.status(403).json({ error: 'אין הרשאה לאזור הזה' });
  if (row.quote_status !== 'pending') return res.status(400).json({ error: 'אין הצעה שממתינה להחלטה' });
  const decision = req.body && req.body.decision;
  if (decision !== 'approved' && decision !== 'rejected') {
    return res.status(400).json({ error: 'אפשר לאשר או לדחות' });
  }
  const now = Date.now();
  (await db.prepare(`UPDATE calls SET quote_status = ?, quote_decided_at = ?, updated_at = ? WHERE id = ?`).run(decision, now, now, row.id));
  const label = decision === 'approved' ? 'אושרה' : 'נדחתה';
  (await db.prepare(`INSERT INTO events (call_id, actor_id, text, created_at) VALUES (?, ?, ?, ?)`).run(row.id, user.id, `הצעת המחיר ${label}`, now));
  (await notifyManagers(`הצעת המחיר בקריאה ${row.id} ${label} על ידי ${user.name}`, row.id, now, null));
  res.json((await hydrate((await loadCallRow(row.id)), user)));
});

app.patch('/api/calls/:id', async (req, res) => {
  const user = (await requireUser(req, res, ['manager', 'employee']));
  if (!user) return;
  const row = (await loadCallRow(req.params.id));
  if (!row || !canSee(user, row)) return res.status(404).json({ error: 'הקריאה לא נמצאה' });
  const body = req.body || {};
  if (user.role === 'employee' && (body.assigneeId !== undefined || body.urgency !== undefined || body.vendorId !== undefined)) {
    return res.status(403).json({ error: 'טכנאי יכול לעדכן סטטוס בלבד' });
  }

  let status = row.status;
  let urgency = row.urgency;
  let assigneeId = row.assignee_id;
  let vendorId = row.vendor_id;
  const events = [];
  const now = Date.now();
  let notifyAssignee = null;

  if (body.urgency !== undefined) {
    if (!dbmod.URGENCIES.includes(body.urgency)) return res.status(400).json({ error: 'דחיפות לא תקינה' });
    if (body.urgency !== urgency) {
      urgency = body.urgency;
      events.push(`הדחיפות שונתה ל${dbmod.URGENCY_LABEL[urgency]}`);
    }
  }

  if (body.assigneeId !== undefined) {
    const next = body.assigneeId || null;
    if (next !== assigneeId) {
      if (next) {
        const emp = (await db.prepare(`SELECT * FROM users WHERE id = ? AND role = 'employee'`).get(next));
        if (!emp) return res.status(400).json({ error: 'הטכנאי לא נמצא' });
        assigneeId = emp.id;
        if (vendorId) {
          vendorId = null;
          events.push('הספק הוסר');
        }
        events.push(`הקריאה שובצה ל${emp.name}`);
        notifyAssignee = emp.id;
        if (status === 'new' && !body.status) status = 'assigned';
      } else {
        assigneeId = null;
        events.push('השיבוץ הוסר');
        if (status === 'assigned' && !body.status && !vendorId) status = 'new';
      }
    }
  }

  if (body.vendorId !== undefined) {
    const next = body.vendorId || null;
    if (next !== vendorId) {
      if (next) {
        const vendor = (await db.prepare(`SELECT * FROM vendors WHERE id = ?`).get(next));
        if (!vendor) return res.status(400).json({ error: 'הספק לא נמצא' });
        vendorId = vendor.id;
        if (assigneeId) {
          assigneeId = null;
          notifyAssignee = null;
          events.push('השיבוץ לטכנאי הוסר');
        }
        events.push(`הקריאה הועברה לספק ${vendor.name}`);
        if (status === 'new' && !body.status) status = 'assigned';
      } else {
        vendorId = null;
        events.push('הספק הוסר');
        if (status === 'assigned' && !body.status && !assigneeId) status = 'new';
      }
    }
  }

  if (body.status !== undefined) {
    if (!dbmod.STATUSES.includes(body.status)) return res.status(400).json({ error: 'סטטוס לא תקין' });
    if (body.status !== status) {
      if ((body.status === 'closed' || body.status === 'done') && (await workPhotoCount(row.id)) < 1) {
        return res.status(400).json({ error: 'אי אפשר לסגור את הקריאה בלי תמונת עבודה או תמונת אחרי' });
      }
      status = body.status;
      events.push(`הסטטוס עודכן ל${dbmod.STATUS_LABEL[status]}`);
    }
  }

  if (!events.length) return res.json((await hydrate(row, user)));

  let pausedMs = Number(row.paused_ms) || 0;
  let pauseStarted = row.pause_started_at || null;
  if (status !== row.status) {
    const was = dbmod.PAUSE_STATUSES.includes(row.status);
    const nextPaused = dbmod.PAUSE_STATUSES.includes(status);
    if (was && !nextPaused) {
      if (pauseStarted) pausedMs += Math.max(0, now - pauseStarted);
      pauseStarted = null;
    } else if (!was && nextPaused) {
      pauseStarted = now;
    }
  }

  const tx = db.txFn(async () => {
    (await db.prepare(`
      UPDATE calls
      SET status = ?, urgency = ?, assignee_id = ?, vendor_id = ?, paused_ms = ?, pause_started_at = ?, updated_at = ?
      WHERE id = ?
    `).run(status, urgency, assigneeId, vendorId, pausedMs, pauseStarted, now, row.id));
    const ins = db.prepare(`INSERT INTO events (call_id, actor_id, text, created_at) VALUES (?, ?, ?, ?)`);
    for (const [i, text] of events.entries()) await ins.run(row.id, user.id, text, now + i);
  });
  (await tx());
  if (notifyAssignee) {
    (await addNotification(notifyAssignee, row.id, `שובצת לקריאה ${row.id}: ${row.description}`, now));
    const tech = (await db.prepare('SELECT phone FROM users WHERE id = ?').get(notifyAssignee));
    if (tech) (await queueSms(tech.phone, `שובצת לקריאה ${row.id}: ${row.description}`));
  }
  res.json((await hydrate((await loadCallRow(row.id)), user)));
});

app.get('/api/home', async (req, res) => {
  const user = (await requireUser(req, res, ['customer']));
  if (!user) return;
  if (!user.building_id) {
    return res.json({ property: null, openCalls: [], care: [], lastVisit: null, pendingQuotes: [] });
  }
  const building = (await db.prepare('SELECT id, name, address, city FROM buildings WHERE id = ?').get(user.building_id));
  const rows = (await db.prepare(`${CALL_SELECT} WHERE c.building_id = ?`).all(user.building_id))
    .filter((row) => canSee(user, row))
    .map((row) => shapeCall(row, user));
  const openCalls = rows.filter((c) => c.status !== 'done' && c.status !== 'closed');
  const visits = rows.filter((c) => c.status === 'in_progress' || c.status === 'done' || c.status === 'closed');
  visits.sort((a, b) => b.updatedAt - a.updatedAt);
  const last = visits[0] || null;
  const now = Date.now();
  const care = (await db.prepare(`
    SELECT p.id, p.name, p.cadence, p.next_due_at, a.name AS asset_name
    FROM pm_plans p
    JOIN assets a ON a.id = p.asset_id
    WHERE a.building_id = ?
    ORDER BY p.next_due_at ASC
  `).all(user.building_id)).map((r) => ({
    id: r.id,
    name: r.name,
    assetName: r.asset_name,
    cadence: r.cadence,
    cadenceLabel: dbmod.CADENCE_LABEL[r.cadence] || r.cadence,
    nextDueAt: r.next_due_at,
    overdue: r.next_due_at < now,
  }));
  const pendingQuotes = rows.filter((c) => c.quote && c.quote.status === 'pending').map((c) => ({
    callId: c.id,
    description: c.description,
    note: c.quote.note || '',
    amount: c.quote.amount,
  }));
  res.json({
    property: building ? {
      id: building.id,
      name: building.name,
      address: building.address,
      city: building.city || '',
    } : null,
    openCalls: openCalls.map((c) => ({
      id: c.id,
      description: c.description,
      status: c.status,
      urgency: c.urgency,
      unit: c.unit,
      buildingName: c.buildingName,
    })),
    care,
    lastVisit: last ? {
      id: last.id,
      description: last.description,
      status: last.status,
      visitorName: last.assigneeName || last.vendorName || null,
      visitorKind: last.assigneeName ? 'technician' : (last.vendorName ? 'vendor' : null),
      hasCompletionPhoto: !!last.hasCompletionPhoto,
      updatedAt: last.updatedAt,
    } : null,
    pendingQuotes,
    nextVisit: await nextVisitFor(user.building_id),
  });
});

app.post('/api/calls/:id/email', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const row = (await loadCallRow(req.params.id));
  if (!row) return res.status(404).json({ error: 'הקריאה לא נמצאה' });
  const owner = (await propertyOwner(row));
  if (!owner) return res.status(400).json({ error: 'אין בעל נכס משויך לנכס הזה' });
  const subject = String((req.body && req.body.subject) || '').trim().replace(/\s+/g, ' ');
  const body = String((req.body && req.body.body) || '').trim();
  if (subject.length < 2 || subject.length > 140) return res.status(400).json({ error: 'חסר נושא' });
  if (body.length < 2 || body.length > 4000) return res.status(400).json({ error: 'חסרה הודעה' });
  let email = (owner.email || '').trim().toLowerCase();
  if (!email) {
    email = cleanEmail(req.body && req.body.email);
    if (!email) return res.status(400).json({ error: 'כתובת מייל לא תקינה' });
    (await db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, owner.id));
  }
  const now = Date.now();
  const info = (await db.prepare(`
    INSERT INTO outbound_emails (call_id, building_id, to_user_id, to_email, subject, body, status, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.building_id, owner.id, email, subject, body, dbmod.EMAIL_PENDING, now, user.id));
  const emailId = Number(info.lastInsertRowid);
  // SMTP_URL is not invented. Unset leaves ממתין לחיבור מייל. Set sends via nodemailer.
  if (process.env.SMTP_URL) {
    try {
      const transport = nodemailer.createTransport(process.env.SMTP_URL);
      const message = { to: email, subject, text: body };
      if (process.env.SMTP_FROM) message.from = process.env.SMTP_FROM;
      await Promise.race([
        transport.sendMail(message),
        new Promise((_, reject) => setTimeout(() => reject(new Error('smtp-timeout')), 10000)),
      ]);
      (await db.prepare('UPDATE outbound_emails SET status = ? WHERE id = ?').run('נשלח', emailId));
    } catch (err) {
      console.error('email send failed');
      (await db.prepare('UPDATE outbound_emails SET status = ? WHERE id = ?').run('שגיאה', emailId));
    }
  }
  (await db.prepare('INSERT INTO events (call_id, actor_id, text, created_at) VALUES (?, ?, ?, ?)').run(
    row.id,
    user.id,
    `נרשמה הודעת מייל לבעל הנכס: ${subject}`,
    now,
  ));
  res.status(201).json((await hydrate((await loadCallRow(row.id)), user)));
});

app.get('/api/emails', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const rows = (await db.prepare(`
    SELECT e.id, e.call_id, e.to_email, e.subject, e.status, e.created_at, b.name AS building_name
    FROM outbound_emails e
    LEFT JOIN buildings b ON b.id = e.building_id
    ORDER BY e.created_at DESC, e.id DESC
    LIMIT 100
  `).all());
  res.json(rows.map((r) => ({
    id: r.id,
    callId: r.call_id,
    createdAt: r.created_at,
    buildingName: r.building_name || '',
    to: r.to_email,
    subject: r.subject,
    status: r.status,
  })));
});

app.get('/api/sms', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const rows = (await db.prepare('SELECT * FROM sms_log ORDER BY created_at DESC, id DESC LIMIT 100').all());
  res.json(rows.map((r) => ({
    id: r.id,
    to: dbmod.displayPhone(r.to_phone),
    toDigits: dbmod.digitsPhone(r.to_phone),
    body: r.body,
    status: r.status,
    createdAt: r.created_at,
  })));
});

app.get('/api/invoices', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const rows = (await db.prepare(`
    SELECT i.*, b.name AS building_name
    FROM invoices i JOIN buildings b ON b.id = i.building_id
    ORDER BY i.created_at DESC, i.id DESC
  `).all());
  res.json(rows.map((r) => ({
    id: r.id,
    number: r.number,
    buildingId: r.building_id,
    buildingName: r.building_name,
    description: r.description,
    amount: r.amount,
    status: r.status,
    statusLabel: dbmod.INVOICE_STATUS[r.status] || r.status,
    createdAt: r.created_at,
  })));
});

app.patch('/api/invoices/:id', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const row = (await db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id));
  if (!row) return res.status(404).json({ error: 'החשבונית לא נמצאה' });
  const status = req.body && req.body.status;
  if (status !== 'sent' && status !== 'paid') return res.status(400).json({ error: 'אפשר לסמן נשלח או שולם' });
  (await db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, row.id));
  const next = (await db.prepare(`
    SELECT i.*, b.name AS building_name
    FROM invoices i JOIN buildings b ON b.id = i.building_id
    WHERE i.id = ?
  `).get(row.id));
  res.json({
    id: next.id,
    number: next.number,
    buildingId: next.building_id,
    buildingName: next.building_name,
    description: next.description,
    amount: next.amount,
    status: next.status,
    statusLabel: dbmod.INVOICE_STATUS[next.status] || next.status,
    createdAt: next.created_at,
  });
});

app.get('/api/part-movements', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const rows = (await db.prepare(`
    SELECT m.*, p.name AS part_name, p.sku
    FROM part_movements m JOIN parts p ON p.id = m.part_id
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 100
  `).all());
  res.json(rows.map((r) => ({
    id: r.id,
    partId: r.part_id,
    partName: r.part_name,
    sku: r.sku,
    direction: r.direction,
    directionLabel: r.direction === 'in' ? 'כניסה' : 'יציאה',
    quantity: r.quantity,
    note: r.note,
    callId: r.call_id,
    createdAt: r.created_at,
  })));
});

app.post('/api/parts/:id/receive', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const part = (await db.prepare('SELECT * FROM parts WHERE id = ?').get(req.params.id));
  if (!part) return res.status(404).json({ error: 'החלק לא נמצא' });
  const quantity = Number(req.body && req.body.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    return res.status(400).json({ error: 'כמות לא תקינה' });
  }
  const note = ((req.body && req.body.note) || 'קבלת סחורה').trim().slice(0, 160) || 'קבלת סחורה';
  const now = Date.now();
  const tx = db.txFn(async () => {
    (await db.prepare('UPDATE parts SET quantity = quantity + ? WHERE id = ?').run(quantity, part.id));
    (await db.prepare(`INSERT INTO part_movements (part_id, direction, quantity, note, call_id, created_at) VALUES (?, 'in', ?, ?, NULL, ?)`).run(part.id, quantity, note, now));
  });
  (await tx());
  const next = (await db.prepare('SELECT * FROM parts WHERE id = ?').get(part.id));
  res.status(201).json({
    id: next.id,
    name: next.name,
    sku: next.sku,
    quantity: next.quantity,
    minQuantity: next.min_quantity,
    low: next.quantity < next.min_quantity,
  });
});

app.post('/api/buildings', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const address = String(body.address || '').trim();
  const city = String(body.city || '').trim() || 'קיסריה';
  const contractType = String(body.contractType || '').trim();
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'חסר שם נכס' });
  if (!address || address.length > 160) return res.status(400).json({ error: 'חסרה כתובת' });
  if (city.length > 80) return res.status(400).json({ error: 'שם עיר ארוך מדי' });
  if (contractType && !dbmod.CONTRACT_TYPES.includes(contractType)) {
    return res.status(400).json({ error: 'סוג חוזה לא תקין' });
  }
  const id = `b-${crypto.randomBytes(4).toString('hex')}`;
  const typeLabel = contractType ? (dbmod.CONTRACT_LABEL[contractType] || contractType) : 'ללא חוזה';
  const pin = (await demoMapPin());
  (await db.prepare(`
    INSERT INTO buildings (id, name, address, city, lat, lng, profile, contract_name, contract_detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    address,
    city,
    pin.lat,
    pin.lng,
    city ? `${address} · ${city}` : address,
    typeLabel,
    contractType ? 'נוסף מהמוקד' : 'אין חוזה עדיין',
  ));
  if (contractType) {
    (await db.prepare(`
      INSERT INTO contracts (id, building_id, name, type, monthly_fee, included_calls, response_emergency, response_urgent, response_normal)
      VALUES (?, ?, ?, ?, 0, NULL, 2, 8, 48)
    `).run(`ct-${id}`, id, `${typeLabel} · ${name}`, contractType));
  }
  (await db.prepare('INSERT INTO units (id, building_id, label, floor) VALUES (?, ?, ?, ?)').run(`un-${id}`, id, name, ''));
  const row = (await db.prepare('SELECT * FROM buildings WHERE id = ?').get(id));
  res.status(201).json({
    id: row.id,
    name: row.name,
    address: row.address,
    city: row.city || '',
    contractType: contractType || null,
    lat: row.lat,
    lng: row.lng,
    openCalls: 0,
  });
});

// A new property has no surveyed point. Drop a demo pin beside the portfolio
// so it shows on the map at once. Not a real address.
async function demoMapPin() {
  const rows = (await db.prepare('SELECT lat, lng FROM buildings WHERE lat IS NOT NULL AND lng IS NOT NULL').all());
  const lat0 = rows.length ? rows.reduce((sum, row) => sum + row.lat, 0) / rows.length : 32.495;
  const lng0 = rows.length ? rows.reduce((sum, row) => sum + row.lng, 0) / rows.length : 34.904;
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM buildings').get()).n;
  const angle = n * 0.95;
  const radius = 0.0035 + (n % 4) * 0.0012;
  return {
    lat: Math.round((lat0 + Math.sin(angle) * radius) * 1e6) / 1e6,
    lng: Math.round((lng0 + Math.cos(angle) * radius) * 1e6) / 1e6,
  };
}

app.get('/api/buildings/:id/units', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const building = (await db.prepare('SELECT id FROM buildings WHERE id = ?').get(req.params.id));
  if (!building) return res.status(404).json({ error: 'הנכס לא נמצא' });
  const rows = (await db.prepare('SELECT * FROM units WHERE building_id = ? ORDER BY floor, label').all(building.id));
  res.json(rows.map(presentUnit));
});

app.post('/api/buildings/:id/units', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const building = (await db.prepare('SELECT id FROM buildings WHERE id = ?').get(req.params.id));
  if (!building) return res.status(404).json({ error: 'הנכס לא נמצא' });
  const label = String((req.body && req.body.label) || '').trim();
  const floor = String((req.body && req.body.floor) || '').trim();
  if (!label || label.length > 40) return res.status(400).json({ error: 'חסר שם' });
  if (floor.length > 20) return res.status(400).json({ error: 'קומה ארוכה מדי' });
  const exists = (await db.prepare('SELECT id FROM units WHERE building_id = ? AND label = ?').get(building.id, label));
  if (exists) return res.status(400).json({ error: 'כבר קיים רשומה בשם הזה' });
  const id = `un-${crypto.randomBytes(4).toString('hex')}`;
  (await db.prepare('INSERT INTO units (id, building_id, label, floor) VALUES (?, ?, ?, ?)').run(id, building.id, label, floor));
  res.status(201).json(presentUnit((await db.prepare('SELECT * FROM units WHERE id = ?').get(id))));
});

app.get('/api/users', async (req, res) => {
  const user = (await requireUser(req, res, ['manager']));
  if (!user) return;
  const rows = (await db.prepare(`
    SELECT * FROM users
    ORDER BY CASE role WHEN 'manager' THEN 0 WHEN 'employee' THEN 1 ELSE 2 END, name
  `).all());
  res.json(await mapAsync(rows, (r) => directoryUser(r)));
});

app.post('/api/users', async (req, res) => {
  const actor = (await requireUser(req, res, ['manager']));
  if (!actor) return;
  const body = req.body || {};
  const name = String(body.name || '').trim().replace(/\s+/g, ' ');
  const phone = dbmod.digitsPhone(body.phone);
  const password = String(body.password != null ? body.password : '');
  const spec = ROLE_SPECS[String(body.role || '').trim()];
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'חסר שם' });
  if (phone.length < 9 || phone.length > 15) return res.status(400).json({ error: 'מספר טלפון לא תקין' });
  if (password.length < 6 || password.length > 80) return res.status(400).json({ error: 'הסיסמה חייבת להכיל לפחות 6 תווים' });
  if (!spec) return res.status(400).json({ error: 'בחרו תפקיד' });
  if ((await findByPhone(phone))) return res.status(400).json({ error: 'המספר כבר רשום' });
  let buildingId = null;
  let unitId = null;
  let trade = null;
  if (spec.role === 'employee') {
    trade = String(body.trade || 'אחזקה').trim() || 'אחזקה';
    if (trade.length > 40) return res.status(400).json({ error: 'המקצוע ארוך מדי' });
  }
  if ((spec.access === 'chair' || spec.access === 'tenant') && body.buildingId) {
    const building = (await db.prepare('SELECT id FROM buildings WHERE id = ?').get(String(body.buildingId)));
    if (!building) return res.status(400).json({ error: 'הנכס לא נמצא' });
    buildingId = building.id;
  }
  const id = `u-${crypto.randomBytes(4).toString('hex')}`;
  (await db.prepare(`
    INSERT INTO users (id, name, role, role_label, title, trade, building_id, phone, password_hash, access, unit_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    spec.role,
    spec.roleLabel,
    spec.title,
    trade,
    buildingId,
    phone,
    dbmod.hashPassword(password),
    spec.access,
    unitId,
  ));
  res.status(201).json((await directoryUser((await db.prepare('SELECT * FROM users WHERE id = ?').get(id)))));
});

app.patch('/api/users/:id', async (req, res) => {
  const actor = (await requireUser(req, res, ['manager']));
  if (!actor) return;
  const user = (await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id));
  if (!user) return res.status(404).json({ error: 'המשתמש לא נמצא' });
  const body = req.body || {};
  if (user.role === 'manager') return res.status(400).json({ error: 'אי אפשר לשייך מנהלת לנכס' });
  if (user.role === 'employee') {
    return res.json((await directoryUser(user)));
  }
  const building = (await db.prepare('SELECT id FROM buildings WHERE id = ?').get(String(body.buildingId || '')));
  if (!building) return res.status(400).json({ error: 'בחרו נכס' });
  const access = user.access === 'tenant' ? 'tenant' : 'chair';
  (await db.prepare('UPDATE users SET building_id = ?, unit_id = NULL, access = ? WHERE id = ?').run(building.id, access, user.id));
  res.json((await directoryUser((await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)))));
});

// ---------- Smart diary ----------
const sched = require('./schedule');

async function technicians() {
  return db.prepare(`SELECT id, name, trade FROM users WHERE role = 'employee' ORDER BY name`).all();
}

async function visitRows(fromTs, toTs, where = '', ...params) {
  return db.prepare(`
    SELECT v.*, b.name AS building_name, u.name AS technician_name, r.every_weeks, c.status AS call_status
    FROM visits v
    LEFT JOIN calls c ON c.id = v.call_id
    JOIN buildings b ON b.id = v.building_id
    LEFT JOIN users u ON u.id = v.technician_id
    LEFT JOIN schedule_rules r ON r.id = v.rule_id
    WHERE v.starts_at >= ? AND v.starts_at < ? AND v.status <> 'cancelled' ${where}
    ORDER BY v.starts_at ASC
  `).all(fromTs, toTs, ...params);
}

function shapeVisit(v, colors) {
  return {
    id: Number(v.id),
    startsAt: Number(v.starts_at),
    durationMin: Number(v.duration_min),
    title: v.title,
    buildingId: v.building_id,
    buildingName: v.building_name,
    technicianId: v.technician_id || null,
    technicianName: v.technician_name || null,
    color: v.technician_id ? colors[v.technician_id] || '#64748b' : null,
    callId: v.call_id != null ? Number(v.call_id) : null,
    ruleId: v.rule_id || null,
    everyWeeks: v.every_weeks != null ? Number(v.every_weeks) : null,
    moved: !!Number(v.moved),
    state: !v.technician_id ? 'unassigned'
      : ['done', 'closed'].includes(v.call_status) || (!v.call_id && Number(v.starts_at) + Number(v.duration_min) * 60000 < Date.now()) ? 'done'
      : ['waiting_parts', 'waiting_customer'].includes(v.call_status) ? 'waiting' : 'planned',
  };
}

function shapeRule(r, colors) {
  return {
    id: r.id, buildingId: r.building_id, buildingName: r.building_name, technicianId: r.technician_id,
    technicianName: r.technician_name, color: colors[r.technician_id] || '#64748b', weekday: Number(r.weekday),
    time: `${String(Math.floor(r.time_min / 60)).padStart(2, '0')}:${String(r.time_min % 60).padStart(2, '0')}`,
    durationMin: Number(r.duration_min), everyWeeks: Number(r.every_weeks), title: r.title,
  };
}

async function nextVisitFor(buildingId) {
  await sched.generate(db);
  const colors = sched.colorMap(await technicians());
  const now = Date.now();
  const rows = await visitRows(now, now + 60 * sched.DAY, 'AND v.building_id = ?', buildingId);
  return rows[0] ? shapeVisit(rows[0], colors) : null;
}

app.get('/api/schedule', async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  await sched.generate(db);
  const techs = await technicians();
  const colors = sched.colorMap(techs);
  const now = Date.now();
  if (user.role === 'customer') {
    if (!user.building_id) return res.json({ next: null, visits: [] });
    const rows = await visitRows(now, now + 60 * sched.DAY, 'AND v.building_id = ?', user.building_id);
    const visits = rows.map((v) => shapeVisit(v, colors));
    return res.json({ next: visits[0] || null, visits: visits.slice(0, 5) });
  }
  const view = ['day', 'week', 'month'].includes(req.query.view) ? req.query.view : 'week';
  let at = Number(req.query.at) || Number(req.query.from) || now;
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(req.query.d || ''));
  if (dm) at = sched.localTs(+dm[1], +dm[2], +dm[3], 12 * 60);
  let from; let days; let prev; let next;
  if (view === 'day') {
    from = sched.dayStart(at); days = 1; prev = sched.addDays(from, -1); next = sched.addDays(from, 1);
  } else if (view === 'month') {
    const p = sched.tzParts(at);
    const first = sched.localTs(p.y, p.m, 1, 0);
    from = sched.weekStart(first); days = 42;
    prev = sched.localTs(p.m === 1 ? p.y - 1 : p.y, p.m === 1 ? 12 : p.m - 1, 1, 12 * 60);
    next = sched.localTs(p.m === 12 ? p.y + 1 : p.y, p.m === 12 ? 1 : p.m + 1, 1, 12 * 60);
  } else {
    from = sched.weekStart(at); days = 7; prev = sched.addDays(from, -7); next = sched.addDays(from, 7);
  }
  const to = sched.addDays(from, days);
  const dayStarts = Array.from({ length: days }, (_, i) => sched.addDays(from, i));
  const monthOf = sched.tzParts(at).m;
  const range = { view, at, from, days, dayStarts, today: sched.dayStart(now), prev, next, prevWeek: prev, nextWeek: next, month: monthOf };
  if (user.role === 'employee') {
    const rows = await visitRows(from, to, 'AND v.technician_id = ?', user.id);
    return res.json({ ...range, visits: sched.withConflicts(rows.map((v) => shapeVisit(v, colors))) });
  }
  if (user.role !== 'manager') return res.status(403).json({ error: 'אין הרשאה' });
  const rows = await visitRows(from, to);
  const rules = (await db.prepare(`
    SELECT r.*, b.name AS building_name, u.name AS technician_name FROM schedule_rules r
    JOIN buildings b ON b.id = r.building_id LEFT JOIN users u ON u.id = r.technician_id
    WHERE r.active = 1 ORDER BY r.weekday, r.time_min`).all()).map((r) => shapeRule(r, colors));
  res.json({
    ...range,
    technicians: techs.map((t) => ({ id: t.id, name: t.name, trade: t.trade, color: colors[t.id] })),
    visits: sched.withConflicts(rows.map((v) => shapeVisit(v, colors))),
    rules,
  });
});

app.post('/api/schedule/rules', async (req, res) => {
  const user = await requireUser(req, res, ['manager']);
  if (!user) return;
  const b = req.body || {};
  const timeMin = sched.parseTime(b.time);
  const weekday = Number(b.weekday);
  const everyWeeks = [1, 2, 4].includes(Number(b.everyWeeks)) ? Number(b.everyWeeks) : null;
  const duration = Math.min(Math.max(Number(b.durationMin) || 60, 15), 480);
  const title = String(b.title || '').trim().slice(0, 80);
  const building = await db.prepare('SELECT id FROM buildings WHERE id = ?').get(String(b.buildingId || ''));
  const tech = await db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'employee'`).get(String(b.technicianId || ''));
  if (!building || !tech || timeMin == null || !(weekday >= 0 && weekday <= 6) || !everyWeeks || !title) {
    return res.status(400).json({ error: 'חסרים פרטים לשיבוץ' });
  }
  const id = sched.newRuleId();
  const now = Date.now();
  await db.prepare(`INSERT INTO schedule_rules (id, building_id, technician_id, weekday, time_min, duration_min, every_weeks, title, start_at, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(id, building.id, tech.id, weekday, timeMin, duration, everyWeeks, title, sched.dayStart(now), now);
  const made = await sched.generate(db, now);
  res.json({ id, generated: made });
});

app.delete('/api/schedule/rules/:id', async (req, res) => {
  const user = await requireUser(req, res, ['manager']);
  if (!user) return;
  await db.prepare('UPDATE schedule_rules SET active = 0 WHERE id = ?').run(req.params.id);
  await db.prepare(`DELETE FROM visits WHERE rule_id = ? AND moved = 0 AND starts_at > ?`).run(req.params.id, Date.now());
  res.json({ ok: true });
});

app.patch('/api/visits/:id', async (req, res) => {
  const user = await requireUser(req, res, ['manager']);
  if (!user) return;
  const v = await db.prepare('SELECT * FROM visits WHERE id = ?').get(Number(req.params.id));
  if (!v) return res.status(404).json({ error: 'לא נמצא' });
  const b = req.body || {};
  let tech = v.technician_id;
  if ('technicianId' in b) {
    if (b.technicianId == null || b.technicianId === '') tech = null;
    else {
      const t = await db.prepare(`SELECT id FROM users WHERE id = ? AND role = 'employee'`).get(String(b.technicianId));
      if (!t) return res.status(400).json({ error: 'טכנאי לא קיים' });
      tech = t.id;
    }
  }
  let starts = Number(v.starts_at);
  if (b.startsAt != null) {
    const n = Number(b.startsAt);
    if (!Number.isFinite(n)) return res.status(400).json({ error: 'זמן לא תקין' });
    starts = n;
  }
  await db.prepare('UPDATE visits SET technician_id = ?, starts_at = ?, moved = 1 WHERE id = ?').run(tech, starts, v.id);
  if (v.call_id != null && tech && tech !== v.technician_id) {
    await db.prepare('UPDATE calls SET assignee_id = ?, updated_at = ? WHERE id = ?').run(tech, Date.now(), v.call_id);
  }
  res.json({ ok: true });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'לא נמצא' });
});

app.use('/uploads', express.static(dbmod.UPLOADS, { fallthrough: false, maxAge: '1h' }));

function sendBuilt(urlPath, fileName, type) {
  app.get(urlPath, (req, res, next) => {
    const file = path.join(DIST, fileName);
    if (!fs.existsSync(file)) return next();
    res.set('Cache-Control', 'no-cache');
    res.type(type);
    res.sendFile(file);
  });
}
sendBuilt('/sw.js', 'sw.js', 'application/javascript');
sendBuilt('/manifest.webmanifest', 'manifest.webmanifest', 'application/manifest+json');


if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('Missing client build. Run npm run build first.');
} else {
  app.use(express.static(DIST, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.set('Cache-Control', 'no-cache');
    const demoFlag = DEMO_MODE ? '1' : '0';
    const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8').replace(/<html([^>]*)>/i, `<html$1 data-demo="${demoFlag}">`);
    res.type('html').send(html);
  });
}

app.use((err, req, res, next) => {
  if (err && err.message === 'אפשר להעלות רק תמונות') {
    return res.status(400).json({ error: err.message });
  }
  // PostgreSQL: a non-numeric id in the URL (e.g. /api/calls/abc) is "not found", like SQLite.
  if (err && err.code === '22P02') {
    return res.status(404).json({ error: 'לא נמצא' });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'התמונה גדולה מדי (עד 8MB)' });
  }
  console.error(err);
  res.status(500).json({ error: 'שגיאת שרת' });
});

function listen(port) {
  const server = app.listen(port, '0.0.0.0');
  // Drop stuck uploads/proxy waits; create-call itself stays sync and fast.
  server.requestTimeout = 120000;
  server.headersTimeout = 125000;
  server.on('listening', () => {
    console.log(`אחזקה listening on http://127.0.0.1:${port}`);
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port === 4173 && !process.env.PORT && !IS_PROD) {
      listen(4174);
      return;
    }
    console.error(err);
    process.exit(1);
  });
}

const preferred = Number(process.env.PORT) || 4173;

function start() {
  return dbmod.open().then((opened) => {
    db = opened;
    console.log(`database: ${db.kind}${db.kind === 'sqlite' ? ` (${dbmod.DB_PATH})` : ''} · uploads: ${dbmod.UPLOADS} · demo data: ${dbmod.DEMO_DATA ? 'on' : 'off'}`);
    listen(preferred);
  });
}

function shutdown(signal) {
  console.log(`${signal}: closing`);
  Promise.resolve(db && db.close()).catch(() => {}).finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
start().catch((err) => {
  console.error('startup failed', err);
  process.exit(1);
});

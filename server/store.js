// Async data layer with one API for PostgreSQL (DATABASE_URL) and SQLite (local demo fallback).
//   await db.get(sql, ...params)   -> first row or undefined
//   await db.all(sql, ...params)   -> rows
//   await db.run(sql, ...params)   -> { changes, lastInsertRowid }
//   await db.exec(sql)             -> multi-statement DDL
//   await db.tx(async () => {...}) -> transaction; db.* calls inside join it automatically
//   db.prepare(sql)                -> { get, all, run } bound to the same sql (async)
// SQL is written with "?" placeholders; for PostgreSQL they become $1..$n.
const { AsyncLocalStorage } = require('async_hooks');

function toPg(sql) {
  let out = '';
  let n = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '?') {
      n += 1;
      out += `$${n}`;
      continue;
    }
    out += ch;
  }
  return out;
}

function flat(params) {
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

function withPrepare(db) {
  db.txFn = (fn) => (...args) => db.tx(() => fn(...args));
  db.prepare = (sql) => ({
    get: (...p) => db.get(sql, ...p),
    all: (...p) => db.all(sql, ...p),
    run: (...p) => db.run(sql, ...p),
  });
  return db;
}

function createPg(url) {
  const { Pool, types } = require('pg');
  types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // BIGINT -> number (epoch ms fits)
  types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // NUMERIC -> number
  const ssl = /sslmode=require/.test(url) || process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined;
  const pool = new Pool({
    connectionString: url,
    ssl,
    max: Number(process.env.PG_POOL_MAX) || 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  pool.on('error', (err) => console.error('pg pool error', err.message));
  const als = new AsyncLocalStorage();
  const runner = () => als.getStore() || pool;
  const insertNeedsReturning = (sql) => /^\s*insert\s/i.test(sql) && !/\breturning\b/i.test(sql);
  const db = {
    kind: 'pg',
    pool,
    async get(sql, ...p) {
      const r = await runner().query(toPg(sql), flat(p));
      return r.rows[0];
    },
    async all(sql, ...p) {
      const r = await runner().query(toPg(sql), flat(p));
      return r.rows;
    },
    async run(sql, ...p) {
      let text = toPg(sql);
      const ret = insertNeedsReturning(sql);
      if (ret) text = `${text.replace(/;\s*$/, '')} RETURNING *`;
      const r = await runner().query(text, flat(p));
      const row = ret ? r.rows[0] : undefined;
      return { changes: r.rowCount, lastInsertRowid: row && row.id != null ? row.id : undefined };
    },
    async exec(sql) {
      await runner().query(sql);
    },
    async tx(fn) {
      if (als.getStore()) return fn();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await als.run(client, fn);
        await client.query('COMMIT');
        return out;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch {}
        throw err;
      } finally {
        client.release();
      }
    },
    async hasColumn(table, column) {
      const r = await pool.query(
        'SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2',
        [table, column],
      );
      return r.rowCount > 0;
    },
    // Identity columns get explicit ids from the seed and the SQLite copy; move each sequence past MAX(id).
    async syncSequences() {
      const rows = (await pool.query(`
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND column_name = 'id' AND is_identity = 'YES'
      `)).rows;
      for (const { table_name: t } of rows) {
        await pool.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${t}), 1), (SELECT COUNT(*) > 0 FROM ${t}))`);
      }
    },
    async close() { await pool.end(); },
  };
  return withPrepare(db);
}

function createSqlite(file) {
  const Database = require('better-sqlite3');
  const raw = new Database(file);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) { s = raw.prepare(sql); cache.set(sql, s); }
    return s;
  };
  let depth = 0;
  // better-sqlite3 is synchronous; every awaited call below resolves as a microtask, so no other
  // request can interleave inside a transaction as long as the callback only awaits db calls.
  const db = {
    kind: 'sqlite',
    raw,
    async get(sql, ...p) { return stmt(sql).get(...flat(p)); },
    async all(sql, ...p) { return stmt(sql).all(...flat(p)); },
    async run(sql, ...p) {
      const r = stmt(sql).run(...flat(p));
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
    },
    async exec(sql) { raw.exec(sql); },
    async tx(fn) {
      if (depth > 0) return fn();
      depth += 1;
      raw.exec('BEGIN');
      try {
        const out = await fn();
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        if (raw.inTransaction) raw.exec('ROLLBACK');
        throw err;
      } finally {
        depth -= 1;
      }
    },
    async hasColumn(table, column) {
      return raw.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    },
    async syncSequences() {},
    async close() { raw.close(); },
  };
  return withPrepare(db);
}

module.exports = { createPg, createSqlite, toPg };

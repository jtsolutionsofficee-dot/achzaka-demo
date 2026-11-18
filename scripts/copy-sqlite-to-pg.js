// Copies every row from the SQLite file into PostgreSQL (DATABASE_URL).
//   DATABASE_URL=postgres://... node scripts/copy-sqlite-to-pg.js [path/to/achzaka.db] [--replace]
// Refuses to write into a database that already has users unless --replace is given
// (then all app tables are emptied first). Runs in one transaction; ids and sequences are kept.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Client, types } = require('pg');

types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

async function main() {
  const args = process.argv.slice(2);
  const replace = args.includes('--replace');
  const file = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..', 'data', 'achzaka.db'));
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  if (!fs.existsSync(file)) throw new Error(`SQLite file not found: ${file}`);

  const src = new Database(file, { readonly: true, fileMustExist: true });
  const ssl = /sslmode=require/.test(url) || process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined;
  const pg = new Client({ connectionString: url, ssl });
  await pg.connect();
  const schema = fs.readFileSync(path.join(__dirname, '..', 'server', 'sql', 'schema.pg.sql'), 'utf8');
  await pg.query("SET client_min_messages = warning");
  await pg.query(schema);

  // table order = creation order in schema.pg.sql (parents first)
  const order = [...schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  const srcTables = new Set(src.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name));

  const existing = Number((await pg.query('SELECT COUNT(*) AS n FROM users')).rows[0].n);
  if (existing && !replace) throw new Error(`target already has ${existing} users; rerun with --replace to overwrite`);

  await pg.query('BEGIN');
  try {
    if (replace) await pg.query(`TRUNCATE ${order.join(', ')} RESTART IDENTITY CASCADE`);
    const summary = [];
    for (const t of order) {
      if (!srcTables.has(t)) continue;
      const pgCols = (await pg.query(
        'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [t],
      )).rows.map((r) => r.column_name);
      const srcCols = src.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
      const cols = srcCols.filter((c) => pgCols.includes(c));
      const rows = src.prepare(`SELECT ${cols.join(', ')} FROM ${t}`).all();
      const batch = 200;
      for (let i = 0; i < rows.length; i += batch) {
        const chunk = rows.slice(i, i + batch);
        const params = [];
        const values = chunk.map((r) => `(${cols.map((c) => { params.push(r[c]); return `$${params.length}`; }).join(', ')})`);
        await pg.query(`INSERT INTO ${t} (${cols.join(', ')}) VALUES ${values.join(', ')}`, params);
      }
      summary.push(`${t}: ${rows.length}`);
    }
    for (const t of order) {
      const isIdentity = (await pg.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = 'id' AND is_identity = 'YES'`, [t],
      )).rowCount;
      if (isIdentity) {
        await pg.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${t}), 1), (SELECT COUNT(*) > 0 FROM ${t}))`);
      }
    }
    await pg.query('COMMIT');
    console.log(`copied from ${file}\n  ${summary.join('\n  ')}`);
  } catch (err) {
    await pg.query('ROLLBACK');
    throw err;
  } finally {
    await pg.end();
    src.close();
  }
}

main().catch((err) => {
  console.error('copy failed:', err.message);
  process.exit(1);
});

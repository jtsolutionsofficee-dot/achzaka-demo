# אחזקה on Render

## What runs where
- **Web service** `achzaka` (Node 20): `npm ci && npm run build`, then `npm start`. Health check: `GET /healthz` (checks the DB).
- **Render Postgres** `achzaka-db`: all data, including login sessions and one-time codes, so restarts and deploys don't log anyone out.
- **Render Disk** at `/var/data`: photos in `UPLOAD_DIR=/var/data/uploads`.
- Without `DATABASE_URL` the same code runs on SQLite (`data/achzaka.db`), which is how the local demo runs.

## First deploy (once there is an account)
1. Push this folder to a Git repo (GitHub/GitLab/Bitbucket). `.gitignore` keeps `data/` (DB + photos) out of Git.
2. Render → New → Blueprint → pick the repo. Render reads `render.yaml` and asks for the `sync: false` values:
   `ADMIN_PHONE`, `ADMIN_PASSWORD` (8+ chars), `ADMIN_NAME`, and optionally the three `TWILIO_*` values.
3. Choose plans when prompted (web service with a disk must be a paid plan; pick a paid Postgres plan, free ones expire).
4. The first start creates the schema (`server/sql/schema.pg.sql`, idempotent) and the first manager from `ADMIN_*`.
   Demo data is **not** seeded in production (`DEMO_DATA=0`), and `DEMO_OTP` is ignored when `NODE_ENV=production`.

## Moving the existing data (optional — the current data is demo data)
- DB: from a machine that can reach the database's *external* URL:
  `DATABASE_URL='<external url>' PGSSL=1 npm run db:copy-sqlite -- data/achzaka.db`
  (refuses to overwrite a DB that already has users; add `--replace` to wipe and copy).
- Photos: copy `data/uploads/*` into `/var/data/uploads` on the disk (Render shell / `scp` over Render SSH).

## Limits to know
- A service with a persistent disk runs on **one instance** and has **no zero-downtime deploys** (a short gap on each deploy).
  To scale to several instances later, move photos to object storage (S3/R2) and drop the disk.
- Twilio not set → SMS rows stay "ממתין לחיבור SMS" and OTP login can't deliver codes in production; use password login.
- Outgoing email has no SMTP configured.

## Local checks
- `npm test` runs the end-to-end smoke test against `BASE` (default `http://127.0.0.1:4173`). It changes data — run it
  against a test DB, then restart (demo data resets on start when `DEMO_DATA=1`).
- Local PostgreSQL run: `DATABASE_URL=postgres://postgres@127.0.0.1:5442/achzaka_test DEMO_DATA=1 PORT=4180 npm start`

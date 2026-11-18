// Screen-by-screen capture for review/promo: node scripts/capture.js <outDir> [full|view]
const { chromium } = require('playwright-core');
const fs = require('fs');
const BASE = process.env.BASE || 'http://127.0.0.1:4173';
const OUT = process.argv[2] || '/tmp/review';
const MODE = process.argv[3] || 'full';
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const ROLES = {
  manager: { phone: '050-100-0006', password: 'Ronit2406', door: 'manager', routes: [
    ['board', '/m'], ['diary', '/m/diary'], ['calls', '/m/calls'], ['call-2401', '/m/calls/2401'], ['buildings', '/m/buildings'], ['people', '/m/people'],
    ['map', '/m/map'], ['assets', '/m/assets'], ['maintenance', '/m/maintenance'], ['vendors', '/m/vendors'], ['parts', '/m/parts'],
    ['billing', '/m/billing'], ['contracts', '/m/contracts'], ['reports', '/m/reports'], ['team', '/m/team'], ['sms', '/m/sms'],
    ['mail', '/m/mail'], ['alerts', '/m/alerts']] },
  owner: { phone: '050-100-0001', password: 'Dana2401', door: 'owner', routes: [
    ['home', '/c'], ['calls', '/c/calls'], ['call-2401', '/c/calls/2401'], ['new', '/c/new'], ['assets', '/c/assets'], ['alerts', '/c/alerts']] },
  technician: { phone: '050-100-0003', password: 'Eyal2403', door: 'technician', routes: [
    ['home', '/e'], ['diary', '/e/diary'], ['call-2402', '/e/calls/2402'], ['alerts', '/e/alerts']] },
};
if (process.env.DIARY) {
  ROLES.manager.routes = [['diary-week', '/m/diary?view=week'], ['diary-day', '/m/diary?view=day'], ['diary-month', '/m/diary?view=month'],
    ['diary-event', '/m/diary?view=week&open=first'], ['diary-new-rule', '/m/diary?view=week&new=1'], ['diary-empty', '/m/diary?view=day&d=2026-10-17']];
  ROLES.technician.routes = [['diary', '/e/diary'], ['diary-event', '/e/diary?open=first']];
  delete ROLES.owner;
}
const SIZES = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const b = await chromium.launch({ executablePath: CHROME });
  const report = [];
  for (const [role, cfg] of Object.entries(ROLES)) {
    for (const [sizeName, vp] of Object.entries(SIZES)) {
      // Owner/technician are phone apps: capture at 390 only (design review B7).
      if (role !== 'manager' && sizeName === 'desktop' && !process.env.ALL_SIZES) continue;
      const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: sizeName === 'mobile', hasTouch: sizeName === 'mobile', locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
      const r = await ctx.request.post(BASE + '/api/auth/login', { data: { phone: cfg.phone, password: cfg.password, door: cfg.door } });
      if (r.status() !== 200) throw new Error(`login ${role} ${r.status()}`);
      const p = await ctx.newPage();
      for (const [name, route] of cfg.routes) {
        if (only && !only.includes(`${role}-${name}`)) continue;
        const errs = [];
        const onErr = (e) => errs.push('pageerror ' + e.message);
        const onResp = (res) => { if (res.url().includes('/api/') && res.status() >= 400) errs.push(`${res.status()} ${res.url().replace(BASE, '')}`); };
        p.on('pageerror', onErr); p.on('response', onResp);
        await p.goto(BASE + route, { waitUntil: 'networkidle' });
        await p.waitForTimeout(900);
        const info = await p.evaluate(() => {
          const de = document.documentElement;
          const wide = [...document.querySelectorAll('body *')].filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1) && getComputedStyle(el).position !== 'fixed';
          }).slice(0, 4).map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`);
          const txt = document.body.innerText;
          return { hscroll: de.scrollWidth > de.clientWidth + 1, wide, empty: /אין עדיין|אין נתונים|לא נמצא|ריק/.test(txt), errorText: /שגיאה|נכשל/.test(txt), len: txt.length, h: de.scrollHeight };
        });
        const file = `${OUT}/${role}-${name}-${sizeName}.png`;
        await p.screenshot({ path: file, fullPage: MODE === 'full' });
        report.push({ shot: `${role}-${name}-${sizeName}`, ...info, errs });
        p.off('pageerror', onErr); p.off('response', onResp);
      }
      await ctx.close();
    }
  }
  await b.close();
  for (const r of report) {
    const flags = [r.hscroll && 'HSCROLL', r.wide.length && `WIDE:${r.wide.join('|')}`, r.empty && 'EMPTY?', r.errorText && 'ERRTEXT', r.errs.length && `ERR:${r.errs.join(';')}`, r.len < 200 && 'SPARSE'].filter(Boolean);
    console.log(r.shot.padEnd(34), `h=${r.h}`, flags.join(' '));
  }
})();

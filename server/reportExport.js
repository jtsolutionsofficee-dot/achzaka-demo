const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ExcelJS = require('exceljs');
const dbmod = require('./db');

const COLUMNS = [
  { key: 'id', header: 'מספר', width: 12 },
  { key: 'building', header: 'נכס', width: 24 },
  { key: 'status', header: 'סטטוס', width: 18 },
  { key: 'urgency', header: 'דחיפות', width: 12 },
  { key: 'assignee', header: 'טכנאי או ספק', width: 24 },
  { key: 'opened', header: 'זמן', width: 26 },
  { key: 'updated', header: 'עודכן', width: 26 },
  { key: 'sla', header: 'מצב זמן', width: 28 },
];

function formatTime(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
}

function hoursPhrase(hours) {
  if (hours <= 1) return 'שעה';
  if (hours === 2) return 'שעתיים';
  return `${hours} שע׳`;
}

function slaPhrase(call) {
  const sla = call.sla;
  if (!sla) return '';
  if (call.status === 'done' || call.status === 'closed') {
    return call.status === 'closed' ? 'נסגר' : 'בוצע';
  }
  if (sla.late) {
    const hours = Math.max(1, Math.round(Math.abs(sla.remainingMs) / 3600000));
    return `באיחור של ${hoursPhrase(hours)}`;
  }
  if (sla.paused) return 'מושהה';
  const hours = Math.max(1, Math.round(sla.remainingMs / 3600000));
  return `במסגרת הזמן, עוד ${hoursPhrase(hours)}`;
}

function assigneeLabel(call) {
  const names = [call.assigneeName, call.vendorName].filter(Boolean);
  return names.length ? names.join(' · ') : '—';
}

function reportRows(calls) {
  return calls
    .slice()
    .sort((a, b) => (b.createdAt - a.createdAt) || (b.id - a.id))
    .map((call) => ({
      id: call.id,
      building: call.buildingName || '',
      status: dbmod.STATUS_LABEL[call.status] || call.status || '',
      urgency: dbmod.URGENCY_LABEL[call.urgency] || call.urgency || '',
      assignee: assigneeLabel(call),
      opened: formatTime(call.createdAt),
      updated: formatTime(call.updatedAt),
      sla: slaPhrase(call),
    }));
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function buildXlsx(calls) {
  const rows = reportRows(calls);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'אחזקה';
  wb.created = new Date();
  const ws = wb.addWorksheet('קריאות', {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
  });
  ws.columns = COLUMNS.map((col) => ({ header: col.header, key: col.key, width: col.width }));
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Arial' };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
  header.alignment = { horizontal: 'right', vertical: 'middle' };
  header.height = 22;
  for (const row of rows) {
    const added = ws.addRow(row);
    added.alignment = { horizontal: 'right', vertical: 'middle' };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function reportHtml(calls) {
  const rows = reportRows(calls);
  const generated = formatTime(Date.now());
  const head = COLUMNS.map((col) => `<th>${escapeHtml(col.header)}</th>`).join('');
  const body = rows.map((row) => (
    `<tr>${COLUMNS.map((col) => `<td>${escapeHtml(row[col.key])}</td>`).join('')}</tr>`
  )).join('');
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<title>דוח קריאות</title>
<style>
  @font-face { font-family: "Heebo"; src: url("${fs.existsSync(FONT_FILE) ? `file://${FONT_FILE}` : ''}"); font-weight: 100 900; }
  @page { size: A4 landscape; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Heebo", "IBM Plex Sans Hebrew", "Alef", sans-serif;
    color: #14181f;
    background: #fff;
    direction: rtl;
  }
  h1 { margin: 0 0 4px; font-size: 22px; }
  p.meta { margin: 0 0 14px; color: #64748b; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; }
  th, td {
    border: 1px solid #e2e8f0;
    padding: 7px 8px;
    text-align: right;
    font-size: 12px;
    vertical-align: top;
  }
  th { background: #2563eb; color: #fff; font-weight: 700; }
  tr:nth-child(even) td { background: #f8fafc; }
</style>
</head>
<body>
  <h1>דוח קריאות</h1>
  <p class="meta">הופק ${escapeHtml(generated)} · שעון ישראל · ${rows.length} קריאות</p>
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${body}</tbody>
  </table>
</body>
</html>`;
}

// Chrome for PDF: CHROME_PATH, else the headless shell the Render build downloads into .chrome/, else system Chrome.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = path.join(__dirname, '..', '.chrome', 'chrome-headless-shell');
  try {
    for (const ver of fs.readdirSync(base).sort().reverse()) {
      const bin = path.join(base, ver, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(bin)) return bin;
    }
  } catch {}
  return '/usr/bin/google-chrome';
}

// Embedded Hebrew font so the PDF does not depend on fonts installed on the server.
const FONT_FILE = path.join(__dirname, '..', 'client', 'public', 'fonts', 'Heebo.ttf');

function buildPdf(calls) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'achzaka-pdf-'));
    const htmlPath = path.join(dir, 'report.html');
    const pdfPath = path.join(dir, 'report.pdf');
    fs.writeFileSync(htmlPath, reportHtml(calls), 'utf8');
    const chrome = findChrome();
    const child = spawn(chrome, [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-pdf-header-footer',
      '--font-render-hinting=none',
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`,
    ], { stdio: 'ignore' });
    let settled = false;
    const finish = (err, buf) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fs.rmSync(dir, { recursive: true, force: true });
      if (err) reject(err);
      else resolve(buf);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error('הפקת PDF נכשלה'));
    }, 20000);
    child.on('error', (err) => finish(err));
    child.on('exit', (code) => {
      if (!fs.existsSync(pdfPath)) {
        finish(new Error(`הפקת PDF נכשלה (${code})`));
        return;
      }
      try {
        finish(null, fs.readFileSync(pdfPath));
      } catch (err) {
        finish(err);
      }
    });
  });
}

function contentDisposition(filename) {
  const utf = encodeURIComponent(filename);
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf}`;
}

module.exports = {
  COLUMNS,
  reportRows,
  buildXlsx,
  buildPdf,
  contentDisposition,
};

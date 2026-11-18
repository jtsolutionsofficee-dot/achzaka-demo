import { ManagerDiary } from './Diary';
import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { STATUS, URGENCY, formatDay, formatStamp, formatWhen, ils, isOpen, slaText } from './format';
import { Status, Urgency } from './widgets';
import CallScreen from './CallScreen';
import { EmptyState } from './illustrations';
import { pressThen, useArriving } from './motion';

const NAV_GROUPS = [
  ['עבודה', [['/m', 'לוח בקרה'], ['/m/calls', 'קריאות'], ['/m/diary', 'יומן'], ['/m/map', 'מפה'], ['/m/maintenance', 'תחזוקה']]],
  ['נכסים', [['/m/buildings', 'נכסים'], ['/m/assets', 'ציוד'], ['/m/contracts', 'חוזים'], ['/m/parts', 'חלקים']]],
  ['אנשים', [['/m/people', 'אנשים'], ['/m/team', 'צוות'], ['/m/vendors', 'ספקים']]],
  ['כספים ודיווח', [['/m/billing', 'חיוב'], ['/m/reports', 'דוחות']]],
  ['הודעות', [['/m/alerts', 'התראות'], ['/m/sms', 'מסרונים'], ['/m/mail', 'מייל']]],
];
const ICONS = {
  '/m': 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  '/m/diary': 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h3M13 14h3M8 17h3',
  '/m/calls': 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  '/m/map': 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  '/m/maintenance': 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  '/m/buildings': 'M3 11 12 4l9 7M5 10v10h14V10M10 20v-6h4v6',
  '/m/assets': 'M4 7h16v12H4zM8 7V5h8v2M4 12h16',
  '/m/contracts': 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  '/m/parts': 'M12 3 4 7v10l8 4 8-4V7zM4 7l8 4 8-4M12 11v10',
  '/m/people': 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 6',
  '/m/team': 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  '/m/vendors': 'M3 9h18l-2-5H5zM5 9v11h14V9M9 20v-6h6v6',
  '/m/billing': 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  '/m/reports': 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  '/m/alerts': 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  '/m/sms': 'M4 5h16v11H8l-4 4z',
  '/m/mail': 'M3 6h18v12H3zM3 6l9 7 9-7',
};
function NavIcon({ href }) {
  return <svg className="nav-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d={ICONS[href]} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
const NAV = NAV_GROUPS.flatMap(([, items]) => items);

export default function Manager({ me, path, search, go, logout }) {
  const params = new URLSearchParams(search);
  const parts = path.split('/').filter(Boolean);
  const callId = parts[1] === 'calls' && parts[2] ? parts[2] : null;
  const page = callId ? 'call' : (parts[1] || 'dash');
  const [unread, setUnread] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [path]);
  useEffect(() => {
    let live = true;
    const load = () => api('/api/notifications').then((rows) => {
      if (live) setUnread(rows.filter((n) => !n.readAt).length);
    }).catch(() => {});
    load();
    const t = setInterval(load, 8000);
    return () => { live = false; clearInterval(t); };
  }, [path]);

  return (
    <div className="shell manager">
      <div className="side-col">
      <aside className={`sidebar${menuOpen ? ' open' : ''}`}>
        <div className="side-brand">
          <div className="brand">
            <button type="button" className="wordmark" onClick={() => go('/m')}>אחזקה</button>
            <div className="who">
              <strong>{me.name}</strong>
              <span>{me.title}</span>
            </div>
          </div>
          <div className="side-brand-actions">
            <button type="button" className="bell" onClick={() => { setMenuOpen(false); go('/m/alerts'); }}>
              התראות
              {unread ? <span className="badge">{unread}</span> : null}
            </button>
            <button
              type="button"
              className="menu-btn"
              aria-expanded={menuOpen}
              aria-controls="manager-nav"
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? 'סגור' : 'תפריט'}
            </button>
          </div>
        </div>
        <nav id="manager-nav">
          {NAV_GROUPS.map(([group, items]) => [<span key={`g-${group}`} className="nav-group">{group}</span>, ...items.map(([href, label]) => (
            <button
              key={href}
              type="button"
              className={(href === '/m' ? path === '/m' : path.startsWith(href)) ? 'on' : ''}
              onClick={() => { setMenuOpen(false); go(href); }}
            >
              <NavIcon href={href} />{label}
              {href === '/m/alerts' && unread ? <span className="badge">{unread}</span> : null}
            </button>
          ))])}
        </nav>
        <div className="side-user">
          <strong>{me.name}</strong>
          <span>{me.title}</span>
          <button type="button" onClick={logout}>יציאה</button>
        </div>
      </aside>
      </div>
      <div className="workspace">
        <div key={page === 'call' ? `call-${callId}` : page} className="motion-screen">
        {page === 'dash' ? <Dashboard go={go} /> : null}
        {page === 'diary' ? <ManagerDiary go={go} /> : null}
        {page === 'calls' ? <Calls params={params} go={go} /> : null}
        {page === 'call' ? <CallPage id={callId} me={me} onBack={() => go('/m/calls')} /> : null}
        {page === 'buildings' ? <Buildings /> : null}
        {page === 'people' ? <People /> : null}
        {page === 'assets' ? <Assets /> : null}
        {page === 'maintenance' ? <Maintenance go={go} /> : null}
        {page === 'vendors' ? <Vendors /> : null}
        {page === 'parts' ? <Parts /> : null}
        {page === 'map' ? <MapPage /> : null}
        {page === 'billing' ? <Billing /> : null}
        {page === 'sms' ? <SmsLog /> : null}
        {page === 'mail' ? <MailLog /> : null}
        {page === 'team' ? <Team go={go} /> : null}
        {page === 'contracts' ? <Contracts /> : null}
        {page === 'reports' ? <Reports /> : null}
        {page === 'alerts' ? <Alerts go={go} /> : null}
        </div>
      </div>
    </div>
  );
}

// Hebrew count: "אין קריאות פתוחות" / "קריאה פתוחה אחת" / "3 קריאות פתוחות"
function openText(n, short = false) {
  const v = Number(n) || 0;
  if (short) return v === 1 ? 'פתוחה אחת' : `${v} פתוחות`;
  if (v === 0) return 'אין קריאות פתוחות';
  if (v === 1) return 'קריאה פתוחה אחת';
  return `${v} קריאות פתוחות`;
}

function useCalls() {
  const [calls, setCalls] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const load = () => api('/api/calls').then((rows) => { if (live) setCalls(rows); }).catch((e) => { if (live) setError(e.message); });
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return { calls, error, setCalls };
}

function dayKey(ts) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ts));
}

const RING = [
  { status: 'new', color: '#2563eb' },
  { status: 'in_progress', color: '#67ad5b' },
  { status: 'on_the_way', color: '#64748b' },
  { status: 'waiting_parts', color: '#ea6336' },
  { status: 'waiting_customer', color: '#ea6336' },
  { status: 'assigned', color: '#9076c5' },
];

const HEB_DAY = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

function dayLetter(key) {
  const d = new Date(`${key}T12:00:00+03:00`);
  return HEB_DAY[d.getDay()];
}

function BoardCharts({ calls }) {
  const slices = RING.map((item) => ({
    ...item,
    label: STATUS[item.status],
    count: calls.filter((c) => c.status === item.status).length,
  })).filter((item) => item.label);
  const total = slices.reduce((sum, item) => sum + item.count, 0) || 1;
  const openCount = calls.filter((c) => isOpen(c.status)).length;
  const radius = 52;
  const circ = 2 * Math.PI * radius;
  let cursor = 0;
  const arcs = slices.filter((item) => item.count > 0).map((item) => {
    const len = total ? (item.count / total) * circ : 0;
    const arc = { ...item, dash: `${len} ${circ - len}`, offset: circ * 0.25 - cursor };
    cursor += len;
    return arc;
  });
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const key = dayKey(Date.now() - i * 86400000);
    days.push({
      key,
      letter: dayLetter(key),
      opened: calls.filter((c) => dayKey(c.createdAt) === key).length,
      closed: calls.filter((c) => (c.status === 'done' || c.status === 'closed') && c.updatedAt && dayKey(c.updatedAt) === key).length,
    });
  }
  const max = Math.max(1, ...days.map((d) => Math.max(d.opened, d.closed)));
  return (
    <section className="card board-visual">
      <div className="ring-block">
        <div className="ring">
          <svg viewBox="0 0 140 140" aria-hidden="true">
            <circle cx="70" cy="70" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="14" />
            {arcs.map((arc) => (
              <circle
                key={arc.status}
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke={arc.color}
                strokeWidth="14"
                strokeDasharray={arc.dash}
                strokeDashoffset={arc.offset}
              />
            ))}
            <text x="70" y="72" textAnchor="middle" dominantBaseline="middle" className="ring-num">{openCount}</text>
          </svg>
          <span className="sr">{openCount} פתוחות</span>
        </div>
        <div className="ring-legend">
          {slices.map((item) => (
            <span key={item.status}><i style={{ background: item.color }} />{item.label}</span>
          ))}
        </div>
      </div>
      <div className="bars-block">
        <div className="bars-legend">
          <span><i style={{ background: '#2563eb' }} />נפתחו</span>
          <span><i style={{ background: '#67ad5b' }} />נסגרו</span>
        </div>
        <div className="bars" aria-hidden="true">
          {days.map((day) => (
            <div className="bar-col" key={day.key}>
              <div className="bar-pair">
                <span className="bar opened" style={{ height: day.opened ? `${Math.max(6, Math.round((day.opened / max) * 120))}px` : 0 }} />
                <span className="bar closed" style={{ height: day.closed ? `${Math.max(6, Math.round((day.closed / max) * 120))}px` : 0 }} />
              </div>
              <span className="bar-day">{day.letter}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function useKpis() {
  const [kpis, setKpis] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => api('/api/kpis').then((k) => { if (live) setKpis(k); }).catch(() => {});
    load();
    const t = setInterval(load, 15000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return kpis;
}

function hoursText(h) {
  if (h == null) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} דק׳`;
  return `${h.toLocaleString('he-IL', { maximumFractionDigits: 1 })} ש׳`;
}

function Dashboard({ go }) {
  const { calls, error } = useCalls();
  const kpis = useKpis();
  const fresh = useArriving(calls);
  const [filter, setFilter] = useState('open');
  const stats = useMemo(() => {
    const list = calls || [];
    const open = list.filter((c) => isOpen(c.status));
    return {
      open: open.length,
      emergency: open.filter((c) => c.urgency === 'emergency').length,
      unassigned: open.filter((c) => !c.assigneeId && !c.vendorId).length,
      late: open.filter((c) => c.sla?.late).length,
      progress: list.filter((c) => c.status === 'in_progress').length,
      all: list.length,
      closedWeek: list.filter((c) => !isOpen(c.status) && (c.closedAt || c.updatedAt) > Date.now() - 7 * 864e5).length,
    };
  }, [calls]);
  const rows = (calls || []).filter((c) => {
    if (filter === 'emergency') return c.urgency === 'emergency' && isOpen(c.status);
    if (filter === 'open') return isOpen(c.status);
    if (filter === 'progress') return c.status === 'in_progress';
    return true;
  });

  return (
    <div className="page">
      <header className="pagehead">
        <div>
          <h1 className="page-title">לוח בקרה</h1>
        </div>
      </header>
      {error ? <p className="error">{error}</p> : null}
      <div className="kpis">
        <button type="button" className="kpi" onClick={() => setFilter('open')}>
          <em>פתוחות</em>
          <strong className="num-open">{calls ? stats.open : '—'}</strong>
        </button>
        <button type="button" className="kpi" onClick={() => setFilter('emergency')}>
          <em>חירום</em>
          <strong className="num-emergency">{calls ? stats.emergency : '—'}</strong>
        </button>
        <button type="button" className="kpi" onClick={() => go('/m/calls?unassigned=1')}>
          <em>לא שובצו</em>
          <strong className="num-unassigned">{calls ? stats.unassigned : '—'}</strong>
        </button>
        <button type="button" className="kpi" onClick={() => go('/m/calls?late=1')}>
          <em>חריגות זמן</em>
          <strong className="num-late">{calls ? stats.late : '—'}</strong>
        </button>
      </div>
      <div className="kpis kpis-value">
        <button type="button" className="kpi" onClick={() => go('/m/reports')}>
          <em>עמידה בזמני תגובה</em>
          <strong className="num-closed">{kpis && kpis.slaMetPct != null ? `${kpis.slaMetPct}%` : '—'}</strong>
        </button>
        <button type="button" className="kpi" onClick={() => go('/m/reports')}>
          <em>זמן טיפול ממוצע</em>
          <strong>{kpis ? hoursText(kpis.avgHandlingHours) : '—'}</strong>
        </button>
        <button type="button" className="kpi" onClick={() => go('/m/billing')}>
          <em>הצעות שאושרו החודש</em>
          <strong className="num-open">{kpis ? ils(kpis.approvedQuotesMonth) : '—'}</strong>
        </button>
        <button type="button" className="kpi" onClick={() => setFilter('all')}>
          <em>נסגרו השבוע</em>
          <strong className="num-closed">{calls ? stats.closedWeek : '—'}</strong>
        </button>
      </div>
      {calls ? <BoardCharts calls={calls} /> : null}
      <div className="segments filters-seg">
        {[['all', 'הכל', stats.all], ['emergency', 'חירום', stats.emergency], ['open', 'פתוחות', stats.open], ['progress', 'בטיפול', stats.progress]].map(([key, label, n]) => (
          <button type="button" key={key} className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>{label}{calls ? <span className="seg-count">{n}</span> : null}</button>
        ))}
      </div>
      <div className="tablewrap">
        <table className="queue">
          <thead>
            <tr>
              <th>קריאה</th>
              <th>נכס</th>
              <th>דחיפות</th>
              <th>סטטוס</th>
              <th>טכנאי</th>
              <th>נפתחה</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className={fresh.has(String(c.id)) ? 'enter-up' : undefined} onClick={pressThen(() => go(`/m/calls/${c.id}`))}>
                <td className="num" data-label="קריאה">{c.id}</td>
                <td data-label="נכס">{c.buildingName}</td>
                <td data-label="דחיפות"><Urgency value={c.urgency} /></td>
                <td data-label="סטטוס"><Status value={c.status} /></td>
                <td data-label="טכנאי">{c.assigneeName || c.vendorName || <span className="muted">לא שובץ</span>}</td>
                <td data-label="נפתחה">{formatWhen(c.createdAt)}{c.sla?.late && isOpen(c.status) ? <span className="late-dot">באיחור</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {calls && rows.length === 0 ? (
          <EmptyState board>
            <p className="empty">אין קריאות בסינון הזה.</p>
          </EmptyState>
        ) : null}
      </div>
    </div>
  );
}

function Calls({ params, go }) {
  const { calls, error, setCalls } = useCalls();
  const fresh = useArriving(calls);
  const [team, setTeam] = useState([]);
  const [buildings, setBuildings] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [limit, setLimit] = useState(20);
  useEffect(() => {
    api('/api/team').then(setTeam).catch(() => {});
    api('/api/buildings').then(setBuildings).catch(() => {});
    api('/api/vendors').then(setVendors).catch(() => {});
  }, []);

  function setParam(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    const q = next.toString();
    go(q ? `/m/calls?${q}` : '/m/calls');
  }

  const rows = (calls || []).filter((c) => {
    if (params.get('status') && c.status !== params.get('status')) return false;
    if (params.get('building') && c.buildingId !== params.get('building')) return false;
    if (params.get('urgency') && c.urgency !== params.get('urgency')) return false;
    if (params.get('assignee') && c.assigneeId !== params.get('assignee')) return false;
    if (params.get('unassigned') === '1' && (c.assigneeId || c.vendorId || !isOpen(c.status))) return false;
    if (params.get('late') === '1' && !(c.sla?.late && isOpen(c.status))) return false;
    return true;
  });

  async function patch(id, body, event) {
    event.stopPropagation();
    const prev = calls;
    try {
      const updated = await api(`/api/calls/${id}`, { method: 'PATCH', body });
      setCalls((list) => (list || []).map((c) => (c.id === id ? { ...c, ...updated } : c)));
    } catch (e) {
      setCalls(prev);
      alert(e.message);
    }
  }

  return (
    <div className="page">
      <header className="pagehead">
        <div>
          <h1 className="page-title">קריאות</h1>
        </div>
        <p className="muted">{calls ? `${rows.length} מוצגות` : ''}</p>
      </header>
      {error ? <p className="error">{error}</p> : null}
      <div className="filters">
        <select value={params.get('status') || ''} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">כל הסטטוסים</option>
          {Object.entries(STATUS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select value={params.get('building') || ''} onChange={(e) => setParam('building', e.target.value)}>
          <option value="">כל הנכסים</option>
          {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button type="button" className={`chip-toggle${params.get('late') === '1' ? ' on' : ''}`} aria-pressed={params.get('late') === '1'} onClick={() => setParam('late', params.get('late') === '1' ? '' : '1')}>באיחור</button>
        <button type="button" className={`chip-toggle${params.get('unassigned') === '1' ? ' on' : ''}`} aria-pressed={params.get('unassigned') === '1'} onClick={() => setParam('unassigned', params.get('unassigned') === '1' ? '' : '1')}>לא שובצו</button>
        <select value={params.get('urgency') || ''} onChange={(e) => setParam('urgency', e.target.value)}>
          <option value="">כל הדחיפויות</option>
          {Object.entries(URGENCY).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <select value={params.get('assignee') || ''} onChange={(e) => setParam('assignee', e.target.value)}>
          <option value="">כל הטכנאים</option>
          {team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <div className="tablewrap">
        <table className="calls-table">
          <thead>
            <tr>
              <th>קריאה</th>
              <th>נכס</th>
              <th>דחיפות</th>
              <th>סטטוס</th>
              <th>טכנאי</th>
              <th>נפתחה</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((c) => (
              <tr key={c.id} className={fresh.has(String(c.id)) ? 'enter-up' : undefined} onClick={pressThen(() => go(`/m/calls/${c.id}`))}>
                <td className="num" data-label="קריאה">{c.id}<span className="sub">{c.description}</span></td>
                <td data-label="נכס">{c.buildingName}<span className="sub">{c.unit}</span></td>
                <td data-label="דחיפות"><Urgency value={c.urgency} /></td>
                <td data-label="סטטוס">
                  <Status value={c.status} />
                  {c.sla?.paused && isOpen(c.status) ? <span className="pill">מושהה</span> : null}
                  {c.sla?.late && isOpen(c.status) ? <span className="pill late">באיחור</span> : null}
                </td>
                <td data-label="טכנאי">{c.assigneeName || c.vendorName || 'לא שובץ'}{c.assigneeName && c.vendorName ? <span className="sub">{c.vendorName}</span> : null}</td>
                <td data-label="נפתחה">
                  <span className="sub">{formatWhen(c.createdAt)}</span>
                  <span className="sub">{isOpen(c.status) ? slaText(c.sla) : STATUS[c.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {calls && rows.length === 0 ? (
          <EmptyState board>
            <p className="empty">אין קריאות לפי הסינון.</p>
          </EmptyState>
        ) : null}
        {rows.length > limit ? (
          <div className="load-more"><button type="button" className="btn ghost tinybtn" onClick={() => setLimit((n) => n + 20)}>טען עוד ({rows.length - limit})</button></div>
        ) : null}
      </div>
    </div>
  );
}

function CallPage({ id, me, onBack }) {
  const [call, setCall] = useState(null);
  const [team, setTeam] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [error, setError] = useState('');
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);
  useEffect(() => {
    api('/api/team').then(setTeam).catch(() => {});
    api('/api/vendors').then(setVendors).catch(() => {});
  }, []);
  useEffect(() => {
    let live = true;
    const load = () => api(`/api/calls/${id}`).then((row) => { if (live) setCall(row); }).catch((e) => { if (live) setError(e.message); });
    load();
    const t = setInterval(load, 4000);
    return () => { live = false; clearInterval(t); };
  }, [id]);
  if (error && !call) return <div className="page"><p className="error">{error}</p></div>;
  if (!call) return <div className="page"><p className="muted">טוען את הקריאה…</p></div>;
  return (
    <div className="page">
      <CallScreen call={call} me={me} mode="manager" team={team} vendors={vendors} onChange={setCall} onBack={onBack} />
    </div>
  );
}

function Buildings() {
  const [rows, setRows] = useState(null);
  const [assets, setAssets] = useState([]);
  const [form, setForm] = useState({ name: '', address: '', city: 'קיסריה', contractType: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    return Promise.all([
      api('/api/buildings').then(setRows),
      api('/api/assets').then(setAssets),
    ]);
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function addBuilding(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/api/buildings', { method: 'POST', body: form });
      setForm({ name: '', address: '', city: 'קיסריה', contractType: '' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="pagehead"><div><h1 className="page-title">נכסים</h1></div></header>
      {error ? <p className="error">{error}</p> : null}
      <div className="sheets sheets-3">
        {(rows || []).map((b) => (
          <article key={b.id} className="sheet">
            <header>
              <h2>{b.name}</h2>
              <span className="count">{openText(b.openCalls, true)}</span>
            </header>
            <p>{b.address}{b.city ? ` · ${b.city}` : ''}</p>
            <p className="muted">{b.profile}</p>
            {b.contractName ? <p className="muted">{b.contractName}</p> : null}
            <span className="kicker">ציוד · {assets.filter((a) => a.buildingId === b.id).length}</span>
            <ul className="plain equip">
              {assets.filter((a) => a.buildingId === b.id).map((a) => (
                <li key={a.id}>{a.name} · {a.statusLabel} · {a.location}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
            <form className="admin-form wide-form" onSubmit={addBuilding}>
        <h2>נכס חדש</h2>
        <div className="form-fields">
        <label className="field"><span className="field-label">שם</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="field"><span className="field-label">כתובת</span>
          <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </label>
        <label className="field"><span className="field-label">עיר</span>
          <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
        </label>
        <label className="field"><span className="field-label">חוזה</span>
          <select value={form.contractType} onChange={(e) => setForm({ ...form, contractType: e.target.value })}>
            <option value="">בלי חוזה</option>
            <option value="retainer_full">ריטיינר מלא</option>
            <option value="retainer_basic">ריטיינר בסיסי</option>
            <option value="per_call">לפי קריאה</option>
          </select>
        </label>
        </div>
        <button type="submit" className="btn" disabled={busy}>הוספת נכס</button>
      </form>
    </div>
  );
}

function People() {
  const [users, setUsers] = useState(null);
  const [buildings, setBuildings] = useState([]);
  const [form, setForm] = useState({ name: '', phone: '', role: 'בעל הנכס', password: '', trade: '' });
  const [assignUser, setAssignUser] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    return Promise.all([
      api('/api/users').then(setUsers),
      api('/api/buildings').then(setBuildings),
    ]);
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  const selected = (users || []).find((u) => u.id === assignUser);

  async function addUser(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNote('');
    try {
      await api('/api/users', { method: 'POST', body: form });
      setNote('המשתמש נוצר. הסיסמה שהוקלדה בטופס לא תוצג שוב.');
      setForm({ name: '', phone: '', role: 'בעל הנכס', password: '', trade: '' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function assign(e) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError('');
    setNote('');
    try {
      await api(`/api/users/${selected.id}`, {
        method: 'PATCH',
        body: { buildingId },
      });
      setNote(selected.role === 'employee' ? 'הטכנאי בצוות ואפשר לשבץ אותו לקריאות.' : 'השיוך לנכס נשמר.');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="pagehead"><div><h1 className="page-title">אנשים</h1></div></header>
      {error ? <p className="error">{error}</p> : null}
      {note ? <p className="muted">{note}</p> : null}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>שם</th>
              <th>תפקיד</th>
              <th>טלפון</th>
              <th>שיוך</th>
            </tr>
          </thead>
          <tbody>
            {(users || []).map((u) => (
              <tr key={u.id}>
                <td data-label="שם">{u.name}</td>
                <td data-label="תפקיד">{u.roleLabel}{u.trade ? ` · ${u.trade}` : ''}</td>
                <td data-label="טלפון"><bdi dir="ltr">{u.phone}</bdi></td>
                <td data-label="שיוך">{u.role === 'employee' ? 'צוות' : (u.buildingName || '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-row">
      <form className="admin-form" onSubmit={addUser}>
        <h2>משתמש חדש</h2>
        <label className="field"><span className="field-label">שם</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="field"><span className="field-label">טלפון</span>
          <input type="tel" inputMode="tel" dir="ltr" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </label>
        <label className="field"><span className="field-label">תפקיד</span>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="בעל הנכס">בעל הנכס</option>
            <option value="דייר">דייר</option>
            <option value="טכנאי">טכנאי</option>
            <option value="מנהל">מנהל</option>
          </select>
        </label>
        {form.role === 'טכנאי' ? (
          <label className="field"><span className="field-label">מקצוע</span>
            <input value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} />
          </label>
        ) : null}
        <label className="field"><span className="field-label">סיסמה ראשונית</span>
          <input type="password" autoComplete="new-password" dir="ltr" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </label>
        <button type="submit" className="btn" disabled={busy}>הוספת משתמש</button>
      </form>
      <form className="admin-form" onSubmit={assign}>
        <h2>שיוך</h2>
        <label className="field"><span className="field-label">משתמש</span>
          <select value={assignUser} onChange={(e) => setAssignUser(e.target.value)}>
            <option value="">בחירה</option>
            {(users || []).filter((u) => u.role !== 'manager').map((u) => (
              <option key={u.id} value={u.id}>{u.name} · {u.roleLabel}</option>
            ))}
          </select>
        </label>
        {selected && selected.role !== 'employee' ? (
          <label className="field"><span className="field-label">נכס</span>
            <select value={buildingId} onChange={(e) => setBuildingId(e.target.value)}>
              <option value="">בחירה</option>
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
        ) : null}
        <button type="submit" className="btn ghost" disabled={busy || !selected}>
          {selected && selected.role === 'employee' ? 'שבץ לצוות' : 'שייך לנכס'}
        </button>
      </form>
      </div>
    </div>
  );
}

function Assets() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/api/assets').then(setRows).catch(() => setRows([])); }, []);
  return (
    <div className="page">
      <header className="pagehead"><div><h1 className="page-title">ציוד</h1></div></header>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>שם</th>
              <th>נכס</th>
              <th>מיקום</th>
              <th>סידורי</th>
              <th>טיפול הבא</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((a) => (
              <tr key={a.id}>
                <td data-label="שם">{a.name}</td>
                <td data-label="נכס">{a.buildingName}</td>
                <td data-label="מיקום">{a.location}</td>
                <td data-label="סידורי"><bdi dir="ltr">{a.serial}</bdi></td>
                <td data-label="טיפול הבא">{formatDay(a.nextServiceAt)}</td>
                <td data-label="סטטוס"><span className={`pill asset-${a.status}`}>{a.statusLabel}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Maintenance({ go }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  function load() { return api('/api/maintenance').then(setRows); }
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);
  async function openCall(id) {
    setBusy(id);
    setError('');
    try {
      const call = await api(`/api/maintenance/${id}/call`, { method: 'POST', body: {} });
      await load();
      go(`/m/calls/${call.id}`);
    } catch (e) {
      setError(e.message);
      setBusy('');
    }
  }
  return (
    <div className="page">
      <header className="pagehead"><div><h1 className="page-title">תחזוקה מונעת</h1></div></header>
      {error ? <p className="error">{error}</p> : null}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>תוכנית</th>
              <th>ציוד</th>
              <th>נכס</th>
              <th>מחזור</th>
              <th>יעד</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.id}>
                <td data-label="תוכנית">{r.name}</td>
                <td data-label="ציוד">{r.assetName}</td>
                <td data-label="נכס">{r.buildingName}</td>
                <td data-label="מחזור">{r.cadenceLabel}</td>
                <td data-label="יעד">
                  {formatDay(r.nextDueAt)}
                  {r.overdue ? <span className="pill late">באיחור</span> : null}
                </td>
                <td data-label="פעולה"><button type="button" className="btn tinybtn ghost" disabled={busy === r.id} onClick={() => openCall(r.id)}>פתח קריאה</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Vendors() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/api/vendors').then(setRows).catch(() => {}); }, []);
  return (
    <div className="page">
      <header className="pagehead"><div><h1 className="page-title">ספקים</h1></div></header>
      <div className="sheets sheets-3">
        {(rows || []).map((v) => (
          <article key={v.id} className="sheet">
            <h2>{v.name}</h2>
            <p>{v.trade}</p>
            <p className="muted"><bdi dir="ltr">{v.phone}</bdi></p>
            <p>{v.notes}</p>
            <p className="count">{openText(v.openCalls)}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function Parts() {
  const [rows, setRows] = useState(null);
  const [moves, setMoves] = useState([]);
  const [partId, setPartId] = useState('');
  const [qty, setQty] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function load() {
    return Promise.all([
      api('/api/parts').then(setRows),
      api('/api/part-movements').then(setMoves),
    ]);
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);
  const low = (rows || []).filter((p) => p.low);
  async function receive(e) {
    e.preventDefault();
    if (!partId) return setError('בחרו חלק');
    setBusy(true);
    setError('');
    try {
      await api(`/api/parts/${partId}/receive`, { method: 'POST', body: { quantity: Number(qty) } });
      setQty(1);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <header className="pagehead"><div><h1 className="page-title">חלקים</h1></div></header>
      {error ? <p className="error">{error}</p> : null}
      {low.length ? <p className="muted">{low.length} פריטים מתחת למינימום.</p> : null}
      <div className="split">
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>שם</th>
              <th>מק״ט</th>
              <th>כמות</th>
              <th>מינימום</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((p) => (
              <tr key={p.id}>
                <td data-label="שם">{p.name}</td>
                <td data-label="מק״ט"><bdi dir="ltr">{p.sku}</bdi></td>
                <td data-label="כמות">{p.quantity}{p.low ? <span className="pill late">מתחת למינימום</span> : null}</td>
                <td data-label="מינימום">{p.minQuantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form className="receive side-form" onSubmit={receive}>
        <h2>קבלת סחורה</h2>
        <label className="field">
          <span className="field-label">חלק</span>
          <select value={partId} onChange={(e) => setPartId(e.target.value)}>
            <option value="">בחירה</option>
            {(rows || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">כמות</span>
          <input type="number" min="1" max="999" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        <button type="submit" className="btn" disabled={busy}>קבלת סחורה</button>
      </form>
      </div>
      <h2>תנועות</h2>
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>חלק</th>
              <th>סוג</th>
              <th>כמות</th>
              <th>הערה</th>
              <th>מתי</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((m) => (
              <tr key={m.id}>
                <td data-label="חלק">{m.partName}</td>
                <td data-label="סוג">{m.directionLabel}</td>
                <td data-label="כמות">{m.quantity}</td>
                <td data-label="הערה">{m.note || '—'}</td>
                <td data-label="מתי">{formatStamp(m.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {moves.length === 0 ? <p className="empty">אין תנועות.</p> : null}
      </div>
    </div>
  );
}

function Billing() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  function load() { return api('/api/invoices').then(setRows); }
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);
  async function mark(id, status) {
    setBusy(`${id}-${status}`);
    setError('');
    try {
      await api(`/api/invoices/${id}`, { method: 'PATCH', body: { status } });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  }
  return (
    <div className="page">
      <header className="pagehead"><div><h1 className="page-title">חיוב</h1></div></header>
      {error ? <p className="error">{error}</p> : null}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>מספר</th>
              <th>נכס</th>
              <th>עבור</th>
              <th>סכום</th>
              <th>סטטוס</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.id}>
                <td className="num" data-label="מספר">{r.number}</td>
                <td data-label="נכס">{r.buildingName}</td>
                <td data-label="עבור">{r.description}</td>
                <td data-label="סכום">{ils(r.amount)}</td>
                <td data-label="סטטוס"><span className="pill">{r.statusLabel}</span></td>
                <td className="row-actions" data-label="פעולה">
                  {r.status === 'paid' ? <span className="muted">—</span> : (
                    <>
                      {r.status !== 'sent' ? <button type="button" className="btn tinybtn ghost" disabled={busy === `${r.id}-sent`} onClick={() => mark(r.id, 'sent')}>נשלח</button> : null}
                      <button type="button" className="btn tinybtn ghost" disabled={busy === `${r.id}-paid`} onClick={() => mark(r.id, 'paid')}>שולם</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && rows.length === 0 ? <p className="empty">אין חשבוניות.</p> : null}
      </div>
    </div>
  );
}


function loadLeaflet() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.L) return Promise.resolve(window.L);
  if (window.__achzakaLeaflet) return window.__achzakaLeaflet;
  window.__achzakaLeaflet = new Promise((resolve, reject) => {
    const cssId = 'achzaka-leaflet-css';
    if (!document.getElementById(cssId)) {
      const css = document.createElement('link');
      css.id = cssId;
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
    }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.async = true;
    s.onload = () => (window.L ? resolve(window.L) : reject(new Error('leaflet')));
    s.onerror = () => reject(new Error('leaflet'));
    document.head.appendChild(s);
  });
  return window.__achzakaLeaflet;
}

function MapPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [leafletReady, setLeafletReady] = useState(typeof window !== 'undefined' && !!window.L);
  const [leafletFailed, setLeafletFailed] = useState(false);
  const box = useState(null);
  const ref = { current: null };
  const mapRef = useState({ el: null });
  useEffect(() => { api('/api/buildings').then(setRows).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    let live = true;
    loadLeaflet()
      .then(() => { if (live) setLeafletReady(true); })
      .catch(() => { if (live) { setLeafletReady(false); setLeafletFailed(true); } });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    const el = document.getElementById('achzaka-map');
    if (!el || !rows || !leafletReady || !window.L) return undefined;
    const L = window.L;
    const map = L.map(el, { scrollWheelZoom: true });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(map);
    const spots = rows.filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng));
    const markers = spots.map((b) => {
      const marker = L.circleMarker([b.lat, b.lng], {
        radius: 9,
        color: '#2563eb',
        weight: 2,
        fillColor: '#2563eb',
        fillOpacity: 0.95,
      }).addTo(map);
      const name = String(b.name || '').replace(/[&<>]/g, '');
      const contract = String(b.contractName || '—').replace(/[&<>]/g, '');
      marker.bindPopup(`<strong>${name}</strong><br>${openText(b.openCalls)}<br>${contract}`);
      return marker;
    });
    if (markers.length) {
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.4));
    } else {
      map.setView([32.495, 34.904], 13);
    }
    setTimeout(() => map.invalidateSize(), 80);
    return () => map.remove();
  }, [rows, leafletReady]);
  return (
    <div className="page">
      <header className="pagehead"><div><h1 className="page-title">מפה</h1></div></header>
      {error ? <p className="error">{error}</p> : null}
      <div className="map-layout">
        <div>
          <div id="achzaka-map" className="map-canvas" ref={(node) => { ref.current = node; mapRef.el = node; box[0] = node; }} />
          {!rows ? <p className="muted">טוען מפה…</p> : null}
          {rows && (leafletFailed || (leafletReady === false && !window.L)) ? <p className="muted">המפה לא נטענה. הרשימה לצד נשארת.</p> : null}
        </div>
        <div className="stack tight">
          {(rows || []).map((b) => (
            <article key={b.id} className="sheet">
              <h2>{b.name}</h2>
              <p>{b.address}</p>
              <p className="muted">{b.contractName || '—'}</p>
              <p className="count">{openText(b.openCalls)}</p>
              {Number.isFinite(b.lat) ? <p className="muted tiny" dir="ltr">{b.lat.toFixed(3)}, {b.lng.toFixed(3)}</p> : null}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

function SmsLog() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/api/sms').then(setRows).catch(() => setRows([])); }, []);
  return (
    <div className="page">
      <header className="pagehead">
        <div>
          <h1 className="page-title">מסרונים</h1>
        </div>
      </header>
      {(rows || []).some((r) => r.status !== 'נשלח') ? <p className="banner-note">ההודעות נשמרות ביומן. שליחה בפועל תופעל אחרי חיבור SMS.</p> : null}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>אל</th>
              <th>תוכן</th>
              <th>נרשם</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.id}>
                <td data-label="אל"><bdi dir="ltr">{r.to}</bdi></td>
                <td data-label="תוכן">{r.body}</td>
                <td data-label="נרשם">{formatStamp(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && rows.length === 0 ? <p className="empty">אין מסרונים.</p> : null}
      </div>
    </div>
  );
}

function MailLog() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/api/emails').then(setRows).catch(() => setRows([])); }, []);
  return (
    <div className="page">
      <header className="pagehead">
        <div>
          <h1 className="page-title">מייל</h1>
        </div>
      </header>
      {(rows || []).some((r) => r.status !== 'נשלח') ? <p className="banner-note">ההודעות נשמרות ביומן. שליחה בפועל תופעל אחרי חיבור מייל.</p> : null}
      <div className="tablewrap">
        <table>
          <thead>
            <tr>
              <th>זמן</th>
              <th>נכס</th>
              <th>אל</th>
              <th>נושא</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r) => (
              <tr key={r.id}>
                <td data-label="זמן">{formatStamp(r.createdAt)}</td>
                <td data-label="נכס">{r.buildingName}</td>
                <td data-label="אל"><bdi dir="ltr">{r.to}</bdi></td>
                <td data-label="נושא">{r.subject}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows && rows.length === 0 ? <p className="empty">אין הודעות.</p> : null}
      </div>
    </div>
  );
}

function Team({ go }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/api/team').then(setRows).catch(() => {}); }, []);
  return (
    <div className="page">
      <header className="pagehead"><div><h1 className="page-title">צוות</h1></div></header>
      <div className="sheets team">
        {(rows || []).map((t) => (
          <article key={t.id} className="sheet">
            <h2>{t.name}</h2>
            <p>{t.trade}</p>
            <p className="count">{openText(t.openCalls)}</p>
            <p className="muted"><bdi dir="ltr">{t.phone}</bdi></p>
            <button type="button" className="btn ghost" onClick={() => go(`/m/calls?assignee=${t.id}`)}>לקריאות</button>
          </article>
        ))}
      </div>
    </div>
  );
}

function Contracts() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/api/contracts').then(setRows).catch(() => {}); }, []);
  return (
    <div className="page">
      <header className="pagehead">
        <div>
          <h1 className="page-title">חוזים</h1>
        </div>
      </header>
      <div className="sheets sheets-3">
        {(rows || []).map((b) => (
          <article key={b.id} className="sheet contract">
            <p className="eyebrow">{b.buildingName}</p>
            <h2>{b.name}</h2>
            <p>{b.address}</p>
            <dl>
              <div><dt>סוג</dt><dd>{b.typeLabel}</dd></div>
              <div><dt>דמי מנוי</dt><dd>{b.monthlyFee ? `${ils(b.monthlyFee)} לחודש` : 'אין דמי מנוי'}</dd></div>
              <div><dt>כלול</dt><dd>{b.includedLabel}</dd></div>
              <div><dt>מענה</dt><dd>חירום {b.responseEmergency} שע׳ · דחוף {b.responseUrgent} · רגיל {b.responseNormal}</dd></div>
            </dl>
            <p className="muted">{openText(b.openCalls)} כרגע</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function Reports() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/reports').then(setData).catch((e) => setError(e.message)); }, []);
  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page"><p className="muted">טוען דוחות…</p></div>;
  return (
    <div className="page">
      <header className="pagehead"><div><h1 className="page-title">דוחות</h1></div></header>
      <section className="card export-card">
        <div>
          <h2>דוח קריאות</h2>
        </div>
        <div className="export-actions">
          <a className="btn ghost" href="/api/reports/calls.xlsx">הורדת אקסל</a>
          <a className="btn ghost" href="/api/reports/calls.pdf">הורדת PDF</a>
        </div>
      </section>
      <h2>קריאות לפי נכס</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>נכס</th><th>סה״כ</th><th>פתוחות</th></tr></thead>
          <tbody>
            {data.byBuilding.map((b) => <tr key={b.id}><td data-label="נכס">{b.name}</td><td data-label="סה״כ">{b.total}</td><td data-label="פתוחות">{b.open}</td></tr>)}
          </tbody>
        </table>
      </div>
      <h2>קריאות לפי סטטוס</h2>
      <div className="pills status-pills">
        {data.byStatus.filter((x) => x.count > 0).map((x) => <span key={x.status} className={`pill st-${x.status}`}>{x.label} <b>{x.count}</b></span>)}
      </div>
      <h2>עומס טכנאים</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>טכנאי</th><th>מקצוע</th><th>פתוחות</th></tr></thead>
          <tbody>
            {data.technicianLoad.map((t) => <tr key={t.id}><td data-label="טכנאי">{t.name}</td><td data-label="מקצוע">{t.trade}</td><td data-label="פתוחות">{t.openCalls}</td></tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Alerts({ go }) {
  const [rows, setRows] = useState(null);
  function load() { return api('/api/notifications').then(setRows); }
  useEffect(() => { load().catch(() => setRows([])); }, []);
  async function open(n) {
    await api(`/api/notifications/${n.id}/read`, { method: 'POST', body: {} }).catch(() => {});
    if (n.callId) go(`/m/calls/${n.callId}`);
    else load();
  }
  async function readAll() {
    await api('/api/notifications/read-all', { method: 'POST', body: {} });
    load();
  }
  return (
    <div className="page">
      <header className="pagehead">
        <div><h1 className="page-title">התראות</h1></div>
        <button type="button" className="linkish" onClick={readAll}>סמן הכל כנקרא</button>
      </header>
      <div className="stack">
        {(rows || []).map((n) => (
          <button type="button" key={n.id} className={`card note ${n.readAt ? '' : 'unread'}`} onClick={pressThen(() => open(n))}>
            <strong>{n.text}</strong>
            <span className="muted tiny">{formatStamp(n.createdAt)} · {n.readAt ? 'נקרא' : 'לא נקרא'}</span>
          </button>
        ))}
        {rows && rows.length === 0 ? <p className="muted">אין התראות.</p> : null}
      </div>
    </div>
  );
}

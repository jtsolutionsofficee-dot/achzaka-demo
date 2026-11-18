import { TechDiary } from './Diary';
import { useEffect, useState } from 'react';
import { api } from './api';
import { isOpen } from './format';
import { CallCard } from './widgets';
import CallScreen from './CallScreen';
import { EmptyState, FillArt } from './illustrations';
import { pressThen, useArriving } from './motion';

export default function Employee({ me, path, go, logout }) {
  const parts = path.split('/').filter(Boolean);
  const callId = parts[0] === 'e' && parts[1] === 'calls' ? parts[2] : null;
  const alerts = parts[1] === 'alerts';
  const diary = parts[1] === 'diary';
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
    <div className="shell employee">
      <header className="topbar">
        <div className="brand">
          <button type="button" className="wordmark" onClick={() => go('/e')}>אחזקה</button>
          <div className="who">
            <strong>{me.name}</strong>
            <span>{me.trade}</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button type="button" className="bell" onClick={() => go('/e/alerts')}>
            התראות
            {unread ? <span className="badge">{unread}</span> : null}
          </button>
          <button type="button" className="menu-btn" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>{menuOpen ? 'סגור' : 'תפריט'}</button>
        </div>
        {menuOpen ? (
          <div className="top-menu">
            <strong>{me.name}</strong>
            <button type="button" className="textbtn" onClick={logout}>יציאה</button>
          </div>
        ) : null}
      </header>
      <main className={callId ? 'on-call' : undefined}>
        {callId ? (
          <div key={callId} className="motion-screen">
            <CallPage id={callId} me={me} onBack={() => go('/e')} />
          </div>
        ) : diary ? (
          <div key="diary" className="motion-screen">
            <TechDiary go={go} />
          </div>
        ) : alerts ? (
          <div key="alerts" className="motion-screen">
            <Alerts go={go} />
          </div>
        ) : (
          <List me={me} go={go} />
        )}
        {callId || diary ? null : <FillArt />}
      </main>
      {callId ? null : (
        <nav className="tabbar">
          <button type="button" className={!alerts && !diary ? 'on' : ''} onClick={() => go('/e')}>קריאות</button>
          <button type="button" className={diary ? 'on' : ''} onClick={() => go('/e/diary')}>יומן</button>
          <button type="button" className={alerts ? 'on' : ''} onClick={() => go('/e/alerts')}>התראות{unread ? <span className="badge">{unread}</span> : null}</button>
        </nav>
      )}
    </div>
  );
}

function List({ me, go }) {
  const [calls, setCalls] = useState(null);
  const [scope, setScope] = useState('open');
  const fresh = useArriving(calls);
  useEffect(() => {
    let live = true;
    const load = () => api('/api/calls').then((rows) => { if (live) setCalls(rows); }).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, []);
  const rows = (calls || []).filter((c) => (scope === 'open' ? isOpen(c.status) : true));
  return (
    <div className="stack narrow">
      <h1 className="page-title">הקריאות של {me.name.split(' ')[0]}</h1>
      <div className="chips">
        <button type="button" className={scope === 'open' ? 'on' : ''} onClick={() => setScope('open')}>פתוחות</button>
        <button type="button" className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>כולל שטופלו</button>
      </div>
      <div key={scope} className="motion-fade">
        {calls === null ? <p className="muted">טוען…</p> : null}
        {calls && rows.length === 0 && calls.every((c) => !isOpen(c.status)) ? (
          <EmptyState variant="technician">
            <div className="empty">
              <p>אין קריאות פתוחות על שמך.</p>
              {scope === 'open' && calls.some((c) => !isOpen(c.status)) ? (
                <button type="button" className="btn ghost" onClick={() => setScope('all')}>להצגת קריאות שטופלו</button>
              ) : null}
            </div>
          </EmptyState>
        ) : null}
        <div className="stack tight">
          {rows.map((c) => (
            <CallCard
              key={c.id}
              call={c}
              variant="employee"
              arriving={fresh.has(String(c.id))}
              onOpen={() => go(`/e/calls/${c.id}`)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function CallPage({ id, me, onBack }) {
  const [call, setCall] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const load = () => api(`/api/calls/${id}`).then((row) => { if (live) setCall(row); }).catch((e) => { if (live) setError(e.message); });
    load();
    const t = setInterval(load, 4000);
    return () => { live = false; clearInterval(t); };
  }, [id]);
  if (error && !call) return <p className="error">{error}</p>;
  if (!call) return <p className="muted">טוען את הקריאה…</p>;
  return <CallScreen call={call} me={me} mode="employee" onChange={setCall} onBack={onBack} />;
}

function Alerts({ go }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { api('/api/notifications').then(setRows).catch(() => setRows([])); }, []);
  async function open(n) {
    await api(`/api/notifications/${n.id}/read`, { method: 'POST', body: {} }).catch(() => {});
    if (n.callId) go(`/e/calls/${n.callId}`);
  }
  return (
    <div className="stack narrow">
      <h1 className="page-title">התראות</h1>
      {rows === null ? <p className="muted">טוען…</p> : null}
      {rows && rows.length === 0 ? <p className="muted">אין התראות.</p> : null}
      {(rows || []).map((n) => (
        <button type="button" key={n.id} className={`card note ${n.readAt ? '' : 'unread'}`} onClick={pressThen(() => open(n))}>
          <strong>{n.text}</strong>
          <span className="muted tiny">{n.readAt ? 'נקרא' : 'לא נקרא'}</span>
        </button>
      ))}
    </div>
  );
}

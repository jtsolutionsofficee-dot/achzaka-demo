import { NextVisit } from './Diary';
import { useEffect, useState } from 'react';
import { api } from './api';
import { formatDay, ils } from './format';
import { CallCard } from './widgets';
import CallScreen from './CallScreen';
import { EmptyState, FillArt } from './illustrations';
import { pressThen, useArriving } from './motion';
import { compressImageFile } from './compress';

export default function Customer({ me, path, go, logout }) {
  const parts = path.split('/').filter(Boolean);
  const tab = path.startsWith('/c/new') ? 'new' : path.startsWith('/c/calls') ? 'calls' : path.startsWith('/c/assets') ? 'assets' : path.startsWith('/c/alerts') ? 'alerts' : 'home';
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
    <div className="shell customer">
      <header className="topbar">
        <div className="brand">
          <button type="button" className="wordmark" onClick={() => go('/c')}>אחזקה</button>
          <div className="who">
            <strong>{me.name}</strong>
            <span>{[me.title, me.buildingName].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button type="button" className="bell" onClick={() => go('/c/alerts')}>
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
      <main className={tab === 'calls' && parts.length === 3 ? 'on-call' : undefined}>
        <div key={tab === 'calls' && parts.length === 3 ? path : tab} className={tab === 'calls' && parts.length === 3 ? 'motion-screen' : 'motion-fade'}>
          {tab === 'home' ? <Home me={me} go={go} /> : null}
          {tab === 'calls' && parts.length === 2 ? <MyCalls go={go} /> : null}
          {tab === 'calls' && parts.length === 3 ? (
            <CallPage id={parts[2]} me={me} onBack={() => go('/c/calls')} />
          ) : null}
          {tab === 'new' ? <NewCall me={me} go={go} /> : null}
          {tab === 'assets' ? <Assets /> : null}
          {tab === 'alerts' ? <Alerts me={me} go={go} /> : null}
        </div>
        {tab === 'calls' && parts.length === 3 ? null : <FillArt />}
      </main>
      {tab === 'calls' && parts.length === 3 ? null : <nav className="tabbar">
        <button type="button" className={tab === 'home' ? 'on' : ''} onClick={() => go('/c')}>בית</button>
        <button type="button" className={tab === 'calls' ? 'on' : ''} onClick={() => go('/c/calls')}>הקריאות שלי</button>
        <button type="button" className={`tab-cta ${tab === 'new' ? 'on' : ''}`} onClick={() => go('/c/new')}>צלם תקלה</button>
      </nav>}
    </div>
  );
}

function Home({ me, go }) {
  const [home, setHome] = useState(null);
  useEffect(() => {
    let live = true;
    const load = () => api('/api/home').then((row) => { if (live) setHome(row); }).catch(() => {});
    load();
    const t = setInterval(load, 6000);
    return () => { live = false; clearInterval(t); };
  }, []);
  const property = home && home.property;
  const place = property ? [property.address, property.city].filter(Boolean).join(', ') : '';
  const open = (home && home.openCalls) || [];
  const fresh = useArriving(home ? open : null);
  const care = (home && home.care) || [];
  const quotes = (home && home.pendingQuotes) || [];
  const last = home && home.lastVisit;
  return (
    <div className="stack">
      <h1 className="page-title hello">{property ? property.name : (me.buildingName || 'הנכס')}</h1>
      {place ? <p className="muted">{place}</p> : null}
      <NextVisit visit={home && home.nextVisit} />
      {quotes.map((q) => (
        <button type="button" key={q.callId} className="banner" onClick={pressThen(() => go(`/c/calls/${q.callId}`))}>
          <span>הצעת מחיר ממתינה לאישור{q.amount ? <> · <span className="sum">{ils(q.amount)}</span></> : ''}</span>
          <span className="banner-cta">לאישור ›</span>
        </button>
      ))}
      <section className="stack tight">
        <div className="section-head">
          <h2>קריאות פתוחות</h2>
          <button type="button" className="linkish" onClick={() => go('/c/calls')}>הכל</button>
        </div>
        {home === null ? <p className="muted">טוען…</p> : null}
        {home && open.length === 0 ? (
          <EmptyState>
            <p className="muted">אין קריאות פתוחות.</p>
          </EmptyState>
        ) : null}
        {open.map((c) => (
          <CallCard key={c.id} call={c} arriving={fresh.has(String(c.id))} onOpen={() => go(`/c/calls/${c.id}`)} />
        ))}
      </section>
      <section className="stack tight">
        <h2>טיפול מונע</h2>
        {home && care.length === 0 ? <p className="muted">אין טיפול מונע לנכס.</p> : null}
        {care.length ? (
          <div className="card list-card">
            {care.map((item) => (
              <p key={item.id} className="list-row">
                <span>{item.name}</span>
                <span className="muted">{formatDay(item.nextDueAt)}{item.overdue ? <span className="pill late">באיחור</span> : null}</span>
              </p>
            ))}
          </div>
        ) : null}
      </section>
      <section className="stack tight">
        <h2>ביקור אחרון</h2>
        {home && !last ? <p className="muted">עדיין לא היה ביקור.</p> : null}
        {last ? (
          <button type="button" className="card call-card" onClick={pressThen(() => go(`/c/calls/${last.id}`))}>
            <strong className="card-title">{last.description}</strong>
            <span className="muted tiny">{last.visitorName ? `הגיע ${last.visitorName}` : 'בלי שיוך'}</span>
            <span className="muted tiny">{last.hasCompletionPhoto ? 'יש תמונת סיום' : 'אין תמונת סיום'}</span>
          </button>
        ) : null}
      </section>
    </div>
  );
}

function MyCalls({ go }) {
  const [calls, setCalls] = useState(null);
  const fresh = useArriving(calls);
  useEffect(() => {
    let live = true;
    const load = () => api('/api/calls').then((rows) => { if (live) setCalls(rows); }).catch(() => {});
    load();
    const t = setInterval(load, 6000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return (
    <div className="stack">
      <h1 className="page-title">הקריאות שלי</h1>
      {calls === null ? <p className="muted">טוען…</p> : null}
      {calls && calls.length === 0 ? (
        <EmptyState>
          <p className="muted">אין קריאות עדיין.</p>
        </EmptyState>
      ) : null}
      <div className="stack tight">
        {(calls || []).map((c) => (
          <CallCard key={c.id} call={c} arriving={fresh.has(String(c.id))} onOpen={() => go(`/c/calls/${c.id}`)} />
        ))}
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
  return <CallScreen call={call} me={me} mode="customer" onChange={setCall} onBack={onBack} />;
}

function Assets() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/api/assets').then(setRows).catch((e) => setError(e.message));
  }, []);
  return (
    <div className="stack">
      <h1 className="page-title">הציוד בבית</h1>
      {error ? <p className="error">{error}</p> : null}
      {rows === null && !error ? <p className="muted">טוען…</p> : null}
      {(rows || []).map((a) => (
        <article key={a.id} className="card sheet">
          <header>
            <h2>{a.name}</h2>
            <span className={`pill asset-${a.status}`}>{a.statusLabel}</span>
          </header>
          <p>{a.location}</p>
          <p className="muted tiny">מספר סידורי {a.serial}</p>
          <p className="muted tiny">טיפול הבא {formatDay(a.nextServiceAt)}</p>
        </article>
      ))}
    </div>
  );
}

function Alerts({ go }) {
  const [rows, setRows] = useState(null);
  async function open(n) {
    await api(`/api/notifications/${n.id}/read`, { method: 'POST', body: {} }).catch(() => {});
    if (n.callId) go(`/c/calls/${n.callId}`);
    else setRows((list) => (list || []).map((x) => (x.id === n.id ? { ...x, readAt: Date.now() } : x)));
  }
  async function readAll() {
    await api('/api/notifications/read-all', { method: 'POST', body: {} });
    setRows((list) => (list || []).map((x) => ({ ...x, readAt: x.readAt || Date.now() })));
  }
  useEffect(() => { api('/api/notifications').then(setRows).catch(() => setRows([])); }, []);
  return (
    <div className="stack">
      <div className="section-head">
        <h1 className="page-title">התראות</h1>
        <button type="button" className="linkish" onClick={readAll}>סמן הכל כנקרא</button>
      </div>
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

function NewCall({ me, go }) {
  const [items, setItems] = useState([]);
  const [shot, setShot] = useState(null);
  const [urgency, setUrgency] = useState('normal');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const cameraRef = { current: null };

  async function remember(file, asShot) {
    if (!file || !file.type || !file.type.startsWith('image/')) return;
    const compact = await compressImageFile(file);
    const item = {
      key: `${compact.name}-${compact.size}-${compact.lastModified}-${Math.random()}`,
      file: compact,
      url: URL.createObjectURL(compact),
    };
    setItems((prev) => {
      const next = [...prev, item].slice(-8);
      return next;
    });
    if (asShot) setShot(item);
  }

  async function submit(e) {
    e.preventDefault();
    if (!description.trim()) return setError('כתבו מה קרה');
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.set('buildingId', me.buildingId || '');
      fd.set('unit', 'בבית');
      fd.set('category', 'אחר');
      fd.set('urgency', urgency);
      fd.set('description', description.trim());
      for (const i of items) {
        const photo = await compressImageFile(i.file);
        fd.append('photos', photo);
      }
      const created = await api('/api/calls', { method: 'POST', body: fd });
      items.forEach((i) => URL.revokeObjectURL(i.url));
      go(`/c/calls/${created.id}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <h1 className="page-title">צלם תקלה</h1>
      <label className="well">
        <input
          ref={(n) => { cameraRef.current = n; }}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const file = (e.target.files || [])[0];
            if (file) remember(file, true);
            e.target.value = '';
          }}
        />
        {shot ? <img src={shot.url} alt="התמונה שצולמה" /> : (
          <EmptyState variant="fault">
            <span>צלם עכשיו</span>
          </EmptyState>
        )}
      </label>
      {shot ? (
        <button type="button" className="btn ghost" onClick={() => cameraRef.current && cameraRef.current.click()}>צלם שוב</button>
      ) : null}
      <label className="btn ghost filebtn">
        <input type="file" accept="image/*" multiple onChange={(e) => {
          for (const file of e.target.files || []) remember(file, false);
          e.target.value = '';
        }} />
        בחר מהגלריה
      </label>
      <label className="field">
        <span className="field-label">מה קרה</span>
        <textarea className="what" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={280} />
      </label>
      <div className="segments choice-seg" role="group" aria-label="דחיפות">
        {[['normal', 'רגיל'], ['urgent', 'דחוף'], ['emergency', 'חירום']].map(([key, label]) => (
          <button type="button" key={key} className={urgency === key ? 'on' : ''} onClick={() => setUrgency(key)}>{label}</button>
        ))}
      </div>
            {error ? <p className="error">{error}</p> : null}
      <button type="submit" className={`btn${busy ? ' is-sending' : ''}`} disabled={busy}>{busy ? 'שולח…' : 'שלח קריאה'}</button>
    </form>
  );
}

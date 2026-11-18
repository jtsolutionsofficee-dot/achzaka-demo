import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from './api';
import { EmptyState } from './illustrations';

const TZ = 'Asia/Jerusalem';
const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAY_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const FREQ = [[1, 'כל שבוע'], [2, 'כל שבועיים'], [4, 'כל 4 שבועות']];
const VIEWS = [['month', 'חודש'], ['week', 'שבוע'], ['day', 'יום']];
const STATE_LABEL = { planned: 'מתוכנן', done: 'בוצע', unassigned: 'לא שובץ', waiting: 'ממתין', conflict: 'חפיפה' };
const CAP = { week: 2, month: 2 };

// en-GB keeps digits free of bidi marks; ranges are wrapped in <bdi dir="ltr">.
const partsOf = (ts) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
const hm = (ts) => { const p = partsOf(ts); return `${p.hour}:${p.minute}`; };
const dm = (ts) => { const p = partsOf(ts); return `${p.day}.${String(p.month).padStart(2, '0')}`; };
const dayNum = (ts) => Number(partsOf(ts).day);
const monthNum = (ts) => Number(partsOf(ts).month);
const isoDay = (ts) => { const p = partsOf(ts); return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`; };
const weekdayOf = (ts) => new Date(ts + 12 * 3600e3).getUTCDay();
const stateOf = (v) => (v.conflict ? 'conflict' : v.state || 'planned');

function TimeRange({ v }) {
  return <bdi dir="ltr" className="tnum">{hm(v.startsAt)}–{hm(v.startsAt + v.durationMin * 60000)}</bdi>;
}

function dayIndex(dayStarts, ts) {
  for (let i = dayStarts.length - 1; i >= 0; i -= 1) if (ts >= dayStarts[i]) return i;
  return -1;
}

function initialQuery() {
  const q = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  return { view: q.get('view'), d: q.get('d'), open: q.get('open'), isNew: q.get('new') === '1' };
}

function useSchedule(view, at, d) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const qs = new URLSearchParams({ view });
  if (at) qs.set('at', String(at));
  else if (d) qs.set('d', d);
  const key = qs.toString();
  const load = () => api(`/api/schedule?${key}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [key]);
  return { data, error, reload: load };
}

function VisitCard({ v, onOpen, draggable, onDragStart, meta }) {
  const st = stateOf(v);
  return (
    <button type="button" className={`visit st-${st}`} draggable={draggable} onDragStart={onDragStart} onClick={onOpen}>
      <span className="visit-time"><TimeRange v={v} /></span>
      <span className="visit-title">{v.title}</span>
      <span className="visit-meta">{meta || v.buildingName}</span>
      {st !== 'planned' ? <span className={`pill vs-${st}`}>{STATE_LABEL[st]}</span> : null}
    </button>
  );
}

function rangeLabel(data) {
  const ds = data.dayStarts;
  if (data.view === 'day') return `${DAY_NAMES[weekdayOf(ds[0])]} ${dm(ds[0])}`;
  if (data.view === 'month') return `${MONTHS[data.month - 1]}`;
  return `${dm(ds[0])}–${dm(ds[ds.length - 1])}`;
}

function Toolbar({ data, view, setView, onNav, onToday, onNew, showViews = true }) {
  return (
    <div className="card cal-toolbar">
      <div className="cal-nav">
        <button type="button" className="btn ghost navbtn" aria-label="הקודם" onClick={() => onNav(data.prev)}>›</button>
        <button type="button" className="btn ghost navbtn today-btn" onClick={onToday}>היום</button>
        <button type="button" className="btn ghost navbtn" aria-label="הבא" onClick={() => onNav(data.next)}>‹</button>
        <strong className="cal-range"><bdi dir="ltr">{rangeLabel(data)}</bdi></strong>
      </div>
      {showViews || onNew ? (
        <div className="cal-tools">
          {showViews ? (
            <div className="segments view-seg" role="tablist" aria-label="תצוגה">
              {VIEWS.map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{label}</button>
              ))}
            </div>
          ) : null}
          {onNew ? <button type="button" className="btn cal-new" onClick={onNew}>+ שיבוץ קבוע</button> : null}
        </div>
      ) : null}
    </div>
  );
}

function Subline({ visits, data }) {
  const conflicts = visits.filter((v) => v.conflict).length;
  const unassigned = visits.filter((v) => !v.technicianId).length;
  return (
    <p className="cal-sub">
      {visits.length} ביקורים
      {conflicts ? <> · <span className="bad">{conflicts} חפיפות</span></> : null}
      {unassigned ? <> · <span className="warn-t">{unassigned} לא שובצו</span></> : null}
    </p>
  );
}

function Legend() {
  return (
    <div className="cal-legend" aria-label="מקרא">
      {['planned', 'done', 'waiting', 'unassigned', 'conflict'].map((k) => <span key={k} className={`lg lg-${k}`}>{STATE_LABEL[k]}</span>)}
    </div>
  );
}

const SLOTS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
function TimeSelect({ value, onChange }) {
  const opts = SLOTS.includes(value) ? SLOTS : [...SLOTS, value].sort();
  return (
    <select dir="ltr" className="tnum" value={value} onChange={(e) => onChange(e.target.value)}>
      {opts.map((t) => <option key={t} value={t}>{t}</option>)}
    </select>
  );
}

function DateField({ value, onChange }) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return (
    <span className="date-field">
      <span className="date-shown tnum" dir="ltr" aria-hidden="true">{m ? `${m[3]}.${m[2]}.${m[1]}` : 'dd.mm.yyyy'}</span>
      <input type="date" value={value} aria-label="תאריך" onChange={(e) => e.target.value && onChange(e.target.value)}
        onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* older browsers open on their own */ } }} />
    </span>
  );
}

function Sheet({ title, onClose, children }) {
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div className="card cal-sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="btn ghost navbtn" aria-label="סגירה" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function VisitSheet({ v, technicians, onClose, onSaved, go }) {
  const day0 = isoDay(v.startsAt);
  const [tech, setTech] = useState(v.technicianId || '');
  const [day, setDay] = useState(day0);
  const [time, setTime] = useState(hm(v.startsAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const st = stateOf(v);
  async function save() {
    const m = /^(\d{1,2}):(\d{2})$/.exec(time);
    const dd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!m || !dd) return setError('יום או שעה לא תקינים');
    setBusy(true);
    try {
      // shift by the difference from the current slot, so the wall-clock math stays on the server's side
      const deltaDays = Math.round((Date.UTC(+dd[1], +dd[2] - 1, +dd[3]) - Date.UTC(...day0.split('-').map((x, i) => (i === 1 ? +x - 1 : +x)))) / 864e5);
      const [h0, m0] = hm(v.startsAt).split(':').map(Number);
      const startsAt = v.startsAt + deltaDays * 864e5 + ((+m[1] * 60 + +m[2]) - (h0 * 60 + m0)) * 60000;
      await api(`/api/visits/${v.id}`, { method: 'PATCH', body: { technicianId: tech || null, startsAt } });
      onSaved();
    } catch (e) { setError(e.message); setBusy(false); }
  }
  return (
    <Sheet title={v.title} onClose={onClose}>
      <p className="cal-sub">
        <bdi dir="ltr" className="tnum">{dm(v.startsAt)}</bdi> · <TimeRange v={v} /> · {v.buildingName}
        {' '}<span className={`pill vs-${st}`}>{STATE_LABEL[st]}</span>
      </p>
      {technicians ? (
        <>
          <label className="field"><span className="field-label">טכנאי</span>
            <select value={tech} onChange={(e) => setTech(e.target.value)}>
              <option value="">לא שובץ</option>
              {technicians.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.trade}</option>)}
            </select>
          </label>
          <div className="pair">
            <label className="field"><span className="field-label">יום</span>
              <DateField value={day} onChange={setDay} />
            </label>
            <label className="field"><span className="field-label">שעה</span>
              <TimeSelect value={time} onChange={setTime} />
            </label>
          </div>
          {error ? <p className="error">{error}</p> : null}
          <div className="pair">
            <button type="button" className="btn" disabled={busy} onClick={save}>שמירה</button>
            {v.callId ? <button type="button" className="btn ghost" onClick={() => go(`/m/calls/${v.callId}`)}>הקריאה</button> : <button type="button" className="btn ghost" onClick={onClose}>ביטול</button>}
          </div>
        </>
      ) : (
        <div className="pair">
          {v.callId ? <button type="button" className="btn" onClick={() => go(`/e/calls/${v.callId}`)}>פתיחת הקריאה</button> : null}
          <button type="button" className="btn ghost" onClick={onClose}>סגירה</button>
        </div>
      )}
    </Sheet>
  );
}

function RuleSheet({ technicians, onClose, onSaved }) {
  const [buildings, setBuildings] = useState([]);
  const [f, setF] = useState({ buildingId: '', technicianId: '', weekday: 0, time: '09:00', everyWeeks: 1, durationMin: 60, title: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { api('/api/buildings').then(setBuildings).catch(() => {}); }, []);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await api('/api/schedule/rules', { method: 'POST', body: f });
      onSaved(r.generated);
    } catch (err) { setError(err.message); setBusy(false); }
  }
  return (
    <Sheet title="שיבוץ קבוע" onClose={onClose}>
      <form className="rule-form" onSubmit={submit}>
        <label className="field"><span className="field-label">מה</span>
          <input value={f.title} maxLength={80} placeholder="סבב אחזקה" onChange={(e) => setF({ ...f, title: e.target.value })} />
        </label>
        <div className="pair">
          <label className="field"><span className="field-label">נכס</span>
            <select value={f.buildingId} onChange={(e) => setF({ ...f, buildingId: e.target.value })}>
              <option value="">בחירה</option>
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="field"><span className="field-label">טכנאי</span>
            <select value={f.technicianId} onChange={(e) => setF({ ...f, technicianId: e.target.value })}>
              <option value="">בחירה</option>
              {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>
        <div className="trio">
          <label className="field"><span className="field-label">יום</span>
            <select value={f.weekday} onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })}>
              {DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </label>
          <label className="field"><span className="field-label">שעה</span>
            <TimeSelect value={f.time} onChange={(t) => setF({ ...f, time: t })} />
          </label>
          <label className="field"><span className="field-label">משך</span>
            <select value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })}>
              {[30, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m >= 60 ? `${m / 60} שע׳` : `${m} דק׳`}</option>)}
            </select>
          </label>
        </div>
        <div className="segments freq-seg" role="group" aria-label="תדירות">
          {FREQ.map(([n, label]) => (
            <button type="button" key={n} className={f.everyWeeks === n ? 'on' : ''} onClick={() => setF({ ...f, everyWeeks: n })}>{label}</button>
          ))}
        </div>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" className="btn" disabled={busy}>שמירה</button>
      </form>
    </Sheet>
  );
}

function DayEmpty({ onNew }) {
  return (
    <div className="card cal-empty">
      <EmptyState><p className="muted">אין ביקורים ביום זה</p></EmptyState>
      {onNew ? <button type="button" className="btn ghost tinybtn" onClick={onNew}>+ שיבוץ קבוע</button> : null}
    </div>
  );
}

function DayStrip({ data, visits, sel, setSel }) {
  const ds = data.dayStarts;
  if (ds.length !== 7) return null;
  return (
    <div className="day-strip" role="tablist" aria-label="ימים">
      {ds.map((d, i) => {
        const n = visits.filter((v) => dayIndex(ds, v.startsAt) === i).length;
        return (
          <button key={d} type="button" role="tab" aria-selected={sel === i} className={sel === i ? 'on' : ''} onClick={() => setSel(i)}>
            <span>{DAY_SHORT[i]}</span>
            <strong className={d === data.today ? 'today-chip' : ''}><bdi dir="ltr">{dm(d)}</bdi></strong>
            <em>{n}</em>
          </button>
        );
      })}
    </div>
  );
}

export function ManagerDiary({ go }) {
  const q0 = useMemo(initialQuery, []);
  const [view, setView] = useState(['day', 'week', 'month'].includes(q0.view) ? q0.view : 'week');
  const [at, setAt] = useState(null);
  const { data, error, reload } = useSchedule(view, at, q0.d);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState(q0.isNew);
  const [note, setNote] = useState('');
  const [sel, setSel] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState('');
  const [openedFromQuery, setOpenedFromQuery] = useState(false);

  useEffect(() => {
    if (!data) return;
    const ti = data.dayStarts.indexOf(data.today);
    setSel(view === 'day' ? 0 : ti >= 0 ? ti : 0);
    if (q0.open && !openedFromQuery) {
      const v = data.visits.find((x) => String(x.id) === q0.open) || (q0.open === 'first' ? data.visits[0] : null);
      if (v) setOpen(v);
      setOpenedFromQuery(true);
    }
  }, [data]);

  const lanes = data ? [...data.technicians, { id: '', name: 'לא שובץ', trade: '' }] : [];
  const ds = data ? data.dayStarts : [];

  async function drop(techId, di) {
    const v = data.visits.find((x) => x.id === dragId);
    setOver(''); setDragId(null);
    if (!v) return;
    const offset = v.startsAt - ds[Math.max(0, dayIndex(ds, v.startsAt))];
    await api(`/api/visits/${v.id}`, { method: 'PATCH', body: { technicianId: techId || null, startsAt: ds[di] + offset } }).catch(() => {});
    reload();
  }
  const toDay = (ts) => { setView('day'); setAt(ts + 12 * 3600e3); };
  async function removeRule(id) { await api(`/api/schedule/rules/${id}`, { method: 'DELETE' }).catch(() => {}); reload(); }

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  const selVisits = data && sel != null && ds.length === 7 ? data.visits.filter((v) => dayIndex(ds, v.startsAt) === sel) : (data && view === 'day' ? data.visits : []);

  return (
    <div className="page diary">
      <header className="pagehead">
        <div>
          <h1 className="page-title">יומן</h1>
          {data ? <Subline visits={data.visits} data={data} /> : <p className="cal-sub">&nbsp;</p>}
        </div>
      </header>
      {data ? <Toolbar data={data} view={view} setView={(k) => { setView(k); setAt(data.at); }} onNav={setAt} onToday={() => setAt(Date.now())} onNew={() => setForm(true)} /> : <div className="card cal-toolbar skeleton" />}
      {note ? <p className="banner-note">{note}</p> : null}

      {!data ? <div className="card cal-skeleton" /> : (
        <>
          <Legend />
          {view === 'week' ? (
            <div className="card week-grid">
              <div className="wg-corner">טכנאי</div>
              {ds.map((d, i) => (
                <div key={d} className="wg-day">
                  <span>{DAY_NAMES[i]}</span>
                  <strong className={d === data.today ? 'today-chip' : ''}><bdi dir="ltr">{dm(d)}</bdi></strong>
                </div>
              ))}
              {lanes.map((t) => (
                <div key={t.id || 'none'} className="wg-row">
                  <div className={`wg-lane${t.id ? '' : ' none'}`}>
                    <strong>{t.name}</strong>
                    {t.trade ? <span>{t.trade}</span> : null}
                  </div>
                  {ds.map((d, i) => {
                    const key = `${t.id}|${i}`;
                    const items = data.visits.filter((v) => (v.technicianId || '') === t.id && dayIndex(ds, v.startsAt) === i);
                    const shown = items.slice(0, CAP.week);
                    return (
                      <div
                        key={key}
                        className={`wg-cell${over === key ? ' over' : ''}`}
                        onDragOver={(e) => { e.preventDefault(); setOver(key); }}
                        onDragLeave={() => setOver((o) => (o === key ? '' : o))}
                        onDrop={(e) => { e.preventDefault(); drop(t.id, i); }}
                      >
                        {shown.map((v) => <VisitCard key={v.id} v={v} draggable onDragStart={() => setDragId(v.id)} onOpen={() => setOpen(v)} />)}
                        {items.length > shown.length ? <button type="button" className="more-btn" onClick={() => toDay(d)}>+{items.length - shown.length} נוספים</button> : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}

          {view === 'day' ? (
            data.visits.length === 0 ? <div className="desk-only"><DayEmpty onNew={() => setForm(true)} /></div> : (
              <div className="card day-grid" style={{ '--lanes': lanes.length }}>
                {lanes.map((t) => (
                  <div key={t.id || 'none'} className="dg-col">
                    <div className={`dg-head${t.id ? '' : ' none'}`}><strong>{t.name}</strong>{t.trade ? <span>{t.trade}</span> : null}</div>
                    {data.visits.filter((v) => (v.technicianId || '') === t.id).map((v) => <VisitCard key={v.id} v={v} onOpen={() => setOpen(v)} />)}
                  </div>
                ))}
              </div>
            )
          ) : null}

          {view === 'month' ? (
            <div className="card month-grid">
              {DAY_SHORT.map((d) => <div key={d} className="mg-head">{d}</div>)}
              {ds.map((d, i) => {
                const items = data.visits.filter((v) => dayIndex(ds, v.startsAt) === i);
                const out = monthNum(d) !== data.month;
                return (
                  <div key={d} className={`mg-cell${out ? ' out' : ''}`}>
                    <button type="button" className={`mg-date${d === data.today ? ' today-chip' : ''}`} onClick={() => toDay(d)}>{dayNum(d)}</button>
                    {items.slice(0, CAP.month).map((v) => (
                      <button key={v.id} type="button" className={`mg-ev st-${stateOf(v)}`} onClick={() => setOpen(v)}>
                        <bdi dir="ltr" className="tnum">{hm(v.startsAt)}</bdi> {v.buildingName}
                      </button>
                    ))}
                    {items.length > CAP.month ? <button type="button" className="more-btn" onClick={() => toDay(d)}>+{items.length - CAP.month} נוספים</button> : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {/* phone: day strip + that day's agenda */}
          <div className="cal-mobile">
            {view !== 'day' && ds.length === 7 ? <DayStrip data={data} visits={data.visits} sel={sel} setSel={setSel} /> : null}
            {view === 'month' ? (
              <div className="day-strip month-strip">
                {ds.map((d, i) => {
                  const n = data.visits.filter((v) => dayIndex(ds, v.startsAt) === i).length;
                  return (
                    <button key={d} type="button" className={`${sel === i ? 'on' : ''}${monthNum(d) !== data.month ? ' out' : ''}`} onClick={() => setSel(i)}>
                      <strong className={d === data.today ? 'today-chip' : ''}>{dayNum(d)}</strong>
                      <em>{n || ''}</em>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {(() => {
              const list = view === 'month' ? data.visits.filter((v) => dayIndex(ds, v.startsAt) === sel) : selVisits;
              return list.length === 0 ? <DayEmpty onNew={() => setForm(true)} /> : (
                <div className="day-list">{list.map((v) => <VisitCard key={v.id} v={v} meta={`${v.buildingName} · ${v.technicianName || 'לא שובץ'}`} onOpen={() => setOpen(v)} />)}</div>
              );
            })()}
          </div>

          <section className="rules">
            <h2>שיבוצים קבועים</h2>
            <div className="card list-card">
              {data.rules.map((r) => (
                <div key={r.id} className="rule-row">
                  <div>
                    <strong>{r.title}</strong>
                    <span className="muted">{r.buildingName} · {r.technicianName}</span>
                    <span className="rule-when">{DAY_NAMES[r.weekday]} <bdi dir="ltr" className="tnum">{r.time}</bdi> · {FREQ.find(([n]) => n === r.everyWeeks)?.[1]}</span>
                  </div>
                  <button type="button" className="btn ghost tinybtn" onClick={() => removeRule(r.id)}>הסרה</button>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
      {open && data ? <VisitSheet v={open} technicians={data.technicians} go={go} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); reload(); }} /> : null}
      {form && data ? <RuleSheet technicians={data.technicians} onClose={() => setForm(false)} onSaved={(n) => { setForm(false); setNote(`השיבוץ נשמר. נוצרו ${n} ביקורים קדימה.`); reload(); }} /> : null}
    </div>
  );
}

export function TechDiary({ go }) {
  const q0 = useMemo(initialQuery, []);
  const [at, setAt] = useState(null);
  const { data, error } = useSchedule('week', at, q0.d);
  const [sel, setSel] = useState(null);
  const [open, setOpen] = useState(null);
  useEffect(() => {
    if (!data) return;
    const ti = data.dayStarts.indexOf(data.today);
    setSel(ti >= 0 ? ti : 0);
    if (q0.open && !open) { const v = q0.open === 'first' ? data.visits[0] : data.visits.find((x) => String(x.id) === q0.open); if (v) setOpen(v); }
  }, [data]);
  if (error) return <p className="error">{error}</p>;
  const ds = data ? data.dayStarts : [];
  const list = data && sel != null ? data.visits.filter((v) => dayIndex(ds, v.startsAt) === sel) : [];
  return (
    <div className="stack tech-diary">
      <div>
        <h1 className="page-title">היומן שלי</h1>
        {data ? <Subline visits={data.visits} data={data} /> : <p className="cal-sub">&nbsp;</p>}
      </div>
      {data ? <Toolbar data={data} view="week" showViews={false} onNav={setAt} onToday={() => setAt(Date.now())} /> : <div className="card cal-toolbar skeleton" />}
      {data ? <DayStrip data={data} visits={data.visits} sel={sel} setSel={setSel} /> : null}
      {data ? (list.length === 0 ? <DayEmpty /> : (
        <div className="day-list">{list.map((v) => <VisitCard key={v.id} v={v} onOpen={() => setOpen(v)} />)}</div>
      )) : null}
      {open ? <VisitSheet v={open} go={go} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

export function NextVisit({ visit: v }) {
  if (!v) return null;
  return (
    <section className="card next-visit">
      <span className="kicker">הביקור הבא</span>
      <strong>{DAY_NAMES[weekdayOf(v.startsAt)]} <bdi dir="ltr" className="tnum">{dm(v.startsAt)} · {hm(v.startsAt)}</bdi></strong>
      <span className="muted">{v.title}{v.technicianName ? ` · ${v.technicianName}` : ''}</span>
    </section>
  );
}

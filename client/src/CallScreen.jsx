import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { QUOTE_STATUS, STATUS, STATUS_ORDER, URGENCY, commitment, formatStamp, ils, isOpen, slaText } from './format';
import { Gallery, Status, Timeline, Urgency } from './widgets';
import { useArriving } from './motion';
import { compressImageFile } from './compress';

function Composer({ callId, onSent, dock, staff, after = false }) {
  const [body, setBody] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const box = useRef(null);

  async function addFiles(list) {
    const next = [...files];
    for (const file of list) {
      if (!file.type || !file.type.startsWith('image/')) continue;
      if (next.length >= 8) break;
      const compact = await compressImageFile(file);
      next.push({ key: `${compact.name}-${compact.size}-${compact.lastModified}-${Math.random()}`, file: compact, url: URL.createObjectURL(compact) });
    }
    setFiles(next);
  }

  function remove(key) {
    setFiles((prev) => {
      const found = prev.find((f) => f.key === key);
      if (found) URL.revokeObjectURL(found.url);
      return prev.filter((f) => f.key !== key);
    });
  }

  async function send() {
    if (busy) return;
    if (!body.trim() && files.length === 0) {
      setError('כתבו הודעה או צרפו תמונה');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.set('body', body.trim());
      if (staff) fd.set('phase', after ? 'after' : 'work');
      for (const f of files) {
        const photo = await compressImageFile(f.file);
        fd.append('photos', photo);
      }
      const updated = await api(`/api/calls/${callId}/messages`, { method: 'POST', body: fd });
      files.forEach((f) => URL.revokeObjectURL(f.url));
      setFiles([]);
      setBody('');
      onSent(updated);
      box.current?.scrollIntoView({ block: 'end' });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`composer ${dock ? 'composer-dock' : ''}`} ref={box}>
      {files.length > 0 ? (
        <div className="previews compact">
          {files.map((f) => (
            <figure key={f.key}>
              <img src={f.url} alt="" />
              <button type="button" onClick={() => remove(f.key)} aria-label="הסרת תמונה">×</button>
            </figure>
          ))}
        </div>
      ) : null}
      <div className="composer-row">
        <label className="iconbtn" title="צילום">
          <input type="file" accept="image/*" capture="environment" onChange={(e) => { addFiles(e.target.files || []); e.target.value = ''; }} />
          <CameraIcon />
          <span className="sr">צלם</span>
        </label>
        <textarea
          rows={1}
          value={body}
          placeholder="עדכון לקריאה"
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className={`send send-icon${busy ? ' is-sending' : ''}`} onClick={send} disabled={busy} aria-label={busy ? 'שולח' : 'שליחה'} title="שליחה">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M20 12H5M11 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path fill="currentColor" d="M9.2 5.2 8 7H5.5A1.5 1.5 0 0 0 4 8.5v8A1.5 1.5 0 0 0 5.5 18h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 18.5 7H16l-1.2-1.8A1.5 1.5 0 0 0 13.55 4.5h-3.1a1.5 1.5 0 0 0-1.25.7ZM12 15.2A3.2 3.2 0 1 1 12 8.8a3.2 3.2 0 0 1 0 6.4Z" />
    </svg>
  );
}

function PartsBox({ call, onChange }) {
  const [parts, setParts] = useState([]);
  const [partId, setPartId] = useState('');
  const [qty, setQty] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/parts').then(setParts).catch(() => {}); }, []);
  async function usePart(e) {
    e.preventDefault();
    if (!partId) return setError('בחרו חלק');
    setBusy(true);
    setError('');
    try {
      const updated = await api(`/api/calls/${call.id}/parts`, { method: 'POST', body: { partId, quantity: Number(qty) } });
      onChange(updated);
      setPartId('');
      setQty(1);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel parts-panel">
      <h2>חלקים</h2>
      {(call.partsUsed || []).length === 0 ? <p className="muted tiny">עוד לא נרשם שימוש.</p> : null}
      <ul className="plain">
        {(call.partsUsed || []).map((p) => (
          <li key={p.id}>{p.name} · {p.sku} · ×{p.quantity}</li>
        ))}
      </ul>
      <form className="stack tight" onSubmit={usePart}>
        <label className="field">
          <span className="field-label">חלק מהמלאי</span>
          <select value={partId} onChange={(e) => setPartId(e.target.value)}>
            <option value="">בחירה</option>
            {parts.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.quantity})</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">כמות</span>
          <input type="number" min="1" max="99" value={qty} onChange={(e) => setQty(e.target.value)} />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button type="submit" className="btn ghost" disabled={busy}>רישום שימוש</button>
      </form>
    </section>
  );
}

function QuoteBox({ call, mode, onChange }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const quote = call.quote;
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const updated = await api(`/api/calls/${call.id}/quote`, { method: 'POST', body: { amount: Number(amount), note } });
      onChange(updated);
      setAmount('');
      setNote('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function decide(decision) {
    setBusy(true);
    setError('');
    try {
      onChange(await api(`/api/calls/${call.id}/quote/decision`, { method: 'POST', body: { decision } }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  if (mode === 'employee' && !quote) return null;
  if (mode === 'customer' && !quote) return null;
  return (
    <section className="panel quote-panel">
      <h2>הצעת מחיר</h2>
      {quote ? (
        <div className="quote">
          <strong>{ils(quote.amount)}</strong>
          {quote.note ? <p>{quote.note}</p> : null}
          <span className="pill">{QUOTE_STATUS[quote.status]}</span>
          {mode === 'customer' && quote.status === 'pending' ? (
            <div className="pair">
              <button type="button" className="btn" disabled={busy} onClick={() => decide('approved')}>אישור</button>
              <button type="button" className="btn ghost" disabled={busy} onClick={() => decide('rejected')}>דחייה</button>
            </div>
          ) : null}
        </div>
      ) : null}
      {mode === 'manager' && quote?.status !== 'approved' ? (
        <form className="stack tight" onSubmit={save}>
          <label className="field">
            <span className="field-label">סכום בש״ח</span>
            <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="480" />
          </label>
          <label className="field">
            <span className="field-label">הערה</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} />
          </label>
          <button type="submit" className="btn" disabled={busy}>שמירת הצעה</button>
        </form>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}


function MailBox({ call, onChange }) {
  const owner = call.owner;
  const [subject, setSubject] = useState(call.quote && call.quote.status === 'pending' ? 'הצעת מחיר' : '');
  const [body, setBody] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const presets = ['הצעת מחיר', 'עדכון טיפול', 'סגירת קריאה'];
  async function save(e) {
    e.preventDefault();
    if (!owner) return;
    setBusy(true);
    setError('');
    try {
      const payload = { subject: subject.trim(), body: body.trim() };
      if (!owner.email) payload.email = email.trim();
      const updated = await api(`/api/calls/${call.id}/email`, { method: 'POST', body: payload });
      onChange(updated);
      setBody('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>שליחת מייל לבעל הנכס</h2>
      {!owner ? <p className="muted tiny">אין בעל נכס משויך לנכס הזה.</p> : (
        <form className="stack tight" onSubmit={save}>
          <p className="muted tiny">אל {owner.name}</p>
          {owner.email ? <p className="muted tiny" dir="ltr">{owner.email}</p> : (
            <label className="field">
              <span className="field-label">מייל</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" placeholder="name@villa-demo.invalid" />
            </label>
          )}
          <div className="segments choice-seg" role="group" aria-label="נושא מוכן">
            {presets.map((label) => (
              <button type="button" key={label} className={subject === label ? 'on' : ''} onClick={() => setSubject(label)}>{label}</button>
            ))}
          </div>
          <label className="field">
            <span className="field-label">נושא</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={140} />
          </label>
          <label className="field">
            <span className="field-label">הודעה</span>
            <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" className="btn ghost" disabled={busy || !owner}>{busy ? 'שומר…' : 'שמירת הודעה'}</button>
        </form>
      )}
      {(call.mail || []).length ? (
        <ul className="plain">
          {call.mail.map((m) => (
            <li key={m.id}>{m.subject} · {formatStamp(m.createdAt)}{m.status !== 'נשלח' ? <span className="pill late">לא נשלח</span> : null}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default function CallScreen({ call, me, mode, team, vendors, onChange, onBack }) {
  const [finishPhoto, setFinishPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef(null);
  const seen = useRef(0);

  useEffect(() => {
    if (mode === 'manager') window.scrollTo(0, 0);
  }, [call.id, mode]);

  useEffect(() => {
    const n = call.messages?.length || 0;
    if (n !== seen.current) {
      seen.current = n;
      const el = logRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [call.messages]);

  async function patch(body) {
    setBusy(true);
    setError('');
    try {
      const updated = await api(`/api/calls/${call.id}`, { method: 'PATCH', body });
      onChange(updated);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const freshMsgs = useArriving(call.messages || [], call.id);
  const mine = (id) => id === me.id;
  const tel = call.telUrl || (call.customerPhone ? `tel:${String(call.customerPhone).replace(/\D/g, '')}` : '');
  const waze = call.wazeUrl || `https://www.waze.com/ul?q=${encodeURIComponent(call.address || '')}&navigate=yes`;
  const field = [
    ['on_the_way', 'הגעתי', false],
    ['in_progress', 'בטיפול', false],
    ['closed', 'סיימתי', true],
  ];

  return (
    <article className={`call mode-${mode}`}>
      <button type="button" className="back" onClick={onBack}><span aria-hidden="true" className="back-arrow">›</span>חזרה</button>
      <header className="call-head">
        <div className="card-top">
          <span className="eyebrow">קריאה {call.id} · {call.category}</span>
          <span className="pills">
            <Urgency value={call.urgency} />
            <Status value={call.status} />
            {call.sla?.paused && isOpen(call.status) ? <span className="pill">מושהה</span> : null}
            {call.sla?.late && isOpen(call.status) ? <span className="pill late">באיחור</span> : null}
          </span>
        </div>
        <h1 className="page-title">{call.description}</h1>
        <p className="place">
          <strong>{call.buildingName}</strong>
          <span>{call.address}</span>
          <span>{call.unit}</span>
        </p>
        {mode === 'employee' && isOpen(call.status) ? (
          <div className="pair nav-pair">
            <a className="btn ghost" href={waze} target="_blank" rel="noreferrer">ניווט</a>
            {tel ? <a className="btn ghost" href={tel}>התקשרו</a> : <button type="button" className="btn ghost" disabled>התקשרו</button>}
          </div>
        ) : null}
      </header>

      <div className="call-grid">
        <div className="call-main">
          <dl className="meta">
            <div><dt>נפתחה</dt><dd>{formatStamp(call.createdAt)}</dd></div>
            <div><dt>פונה</dt><dd>{call.customerName || '—'}</dd></div>
            {mode !== 'customer' && call.customerPhone ? (
              <div><dt>טלפון</dt><dd dir="ltr">{call.customerPhone}</dd></div>
            ) : null}
            <div><dt>טכנאי</dt><dd>{call.assigneeName ? `${call.assigneeName}${call.assigneeTrade ? ` · ${call.assigneeTrade}` : ''}` : 'לא שובץ'}</dd></div>
            {call.vendorName ? <div><dt>ספק</dt><dd>{call.vendorName}</dd></div> : null}
            {call.assetName ? <div><dt>ציוד</dt><dd>{call.assetName}</dd></div> : null}
            {mode !== 'customer' ? (
              <div><dt>התחייבות</dt><dd>{commitment(call.urgency)} · {isOpen(call.status) ? slaText(call.sla) : 'הקריאה סגורה'}</dd></div>
            ) : null}
            {mode === 'manager' && call.contract ? (
              <div>
                <dt>חוזה</dt>
                <dd>{call.contract.typeLabel} · {call.contract.includedLabel}{call.contract.monthlyFee ? ` · ${ils(call.contract.monthlyFee)} לחודש` : ''}</dd>
              </div>
            ) : null}
          </dl>

          {mode === 'manager' ? (
          <div className="pair nav-pair">
            <a className="btn ghost" href={waze} target="_blank" rel="noreferrer">ניווט</a>
            {tel ? <a className="btn ghost" href={tel}>התקשרו</a> : <button type="button" className="btn ghost" disabled>התקשרו</button>}
          </div>
        ) : null}

          {mode === 'customer' && (call.mail || []).length ? (
            <section className="panel mail-panel">
              <h2>הודעה מהמוקד</h2>
              <ul className="plain">
                {call.mail.map((m) => (
                  <li key={m.id}>{m.subject} · {formatStamp(m.createdAt)}{m.status !== 'נשלח' ? <span className="pill late">לא נשלח</span> : null}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {(call.photos || []).length || (call.workPhotos || []).length ? (
            <section className="panel record photos-card">
              <Gallery photos={call.photos} title="תמונות מהדיווח" />
              <Gallery photos={call.workPhotos} title="תמונות עבודה" />
            </section>
          ) : null}
          {(call.events || []).length ? (
            <section className="panel record timeline-card">
              <Timeline events={call.events} collapsible={mode === 'employee'} />
            </section>
          ) : null}

          <section className="panel chat">
            <h2>השיחה על הקריאה</h2>
            <div className="chatlog" ref={logRef}>
              {(call.messages || []).length === 0 ? <p className="muted">עדיין אין הודעות.</p> : null}
              {(call.messages || []).map((m) => (
                <div key={m.id} className={`bubble-wrap${mine(m.authorId) ? ' mine' : ''}${freshMsgs.has(String(m.id)) ? ' enter-up' : ''}`}>
                  <div className="bubble-meta">{m.authorName} · {formatStamp(m.createdAt)}</div>
                  <div className={`bubble ${mine(m.authorId) ? 'mine' : ''}`}>
                    {m.body ? <p>{m.body}</p> : null}
                    {m.photos?.length ? (
                      <div className="bubble-photos">
                        {m.photos.map((p) => <a key={p.id} href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt="תמונה בהודעה" /></a>)}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {mode === 'manager' ? <Composer callId={call.id} onSent={onChange} staff /> : <Composer callId={call.id} onSent={onChange} dock staff={mode === 'employee'} after={finishPhoto} />}
          </section>
        </div>

        <aside className="call-side">
          {mode === 'employee' ? (
            <section className="panel field-panel">
              <h2>סטטוס בשטח</h2>
              <div className="segments field-seg">
                {field.map(([key, label, finish]) => (
                  <button
                    key={key}
                    type="button"
                    className={`${key === call.status ? 'on' : ''} ${finish ? 'finish' : ''}`}
                    disabled={busy || key === call.status || (finish && !call.canClose)}
                    onClick={() => patch({ status: key })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="pair stack-pair">
                <button type="button" className="btn ghost" disabled={busy || call.status === 'waiting_parts'} onClick={() => patch({ status: 'waiting_parts' })}>ממתין לחלק</button>
                <button type="button" className="btn ghost" disabled={busy || call.status === 'waiting_customer'} onClick={() => patch({ status: 'waiting_customer' })}>ממתין ללקוח</button>
              </div>
              <label className="check">
                <input type="checkbox" checked={finishPhoto} onChange={(e) => setFinishPhoto(e.target.checked)} />
                התמונה הבאה בשיחה היא תמונת סיום
              </label>
            </section>
          ) : null}

          {mode === 'manager' ? (
            <section className="panel">
              <h2>ניהול הקריאה</h2>
              <label className="field">
                <span className="field-label">טכנאי</span>
                <select value={call.assigneeId || ''} disabled={busy} onChange={(e) => patch({ assigneeId: e.target.value || null })}>
                  <option value="">לא שובץ</option>
                  {(team || []).map((t) => (
                    <option key={t.id} value={t.id}>{t.name} · {t.trade}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">ספק</span>
                <select value={call.vendorId || ''} disabled={busy} onChange={(e) => patch({ vendorId: e.target.value || null })}>
                  <option value="">בלי ספק</option>
                  {(vendors || []).map((v) => (
                    <option key={v.id} value={v.id}>{v.name} · {v.trade}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">דחיפות</span>
                <select value={call.urgency} disabled={busy} onChange={(e) => patch({ urgency: e.target.value })}>
                  {Object.entries(URGENCY).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </label>
              <label className="field">
                <span className="field-label">סטטוס</span>
                <select value={call.status} disabled={busy} onChange={(e) => patch({ status: e.target.value })}>
                  {STATUS_ORDER.map((k) => <option key={k} value={k}>{STATUS[k]}</option>)}
                </select>
              </label>
            </section>
          ) : null}

          {mode !== 'customer' ? <PartsBox call={call} onChange={onChange} /> : null}
          <QuoteBox call={call} mode={mode} onChange={onChange} />
          {mode === 'manager' ? <MailBox call={call} onChange={onChange} /> : null}
          {error ? <p className="error">{error}</p> : null}
        </aside>
      </div>
    </article>
  );
}

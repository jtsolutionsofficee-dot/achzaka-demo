import { useState } from 'react';
import { STATUS, URGENCY, formatWhen } from './format';
import { pressThen } from './motion';

export function Status({ value }) {
  return <span className={`pill st-${value}`}>{STATUS[value] || value}</span>;
}

export function Urgency({ value }) {
  return <span className={`pill ${value}`}>{URGENCY[value] || value}</span>;
}

export function CallCard({ call, onOpen, variant, arriving }) {
  const title = variant === 'employee' ? call.address : call.description;
  return (
    <button type="button" className={`card call-card${arriving ? ' enter-up' : ''}`} onClick={pressThen(onOpen)}>
      <strong className="card-title">{title}</strong>
      {variant === 'employee' ? (
        <span className="muted one">{call.description}</span>
      ) : (
        <span className="muted tiny">{call.buildingName} · {call.unit}</span>
      )}
      <span className="card-foot">
        <Status value={call.status} />
      </span>
    </button>
  );
}

export function Gallery({ photos, title }) {
  const [open, setOpen] = useState(null);
  if (!photos || photos.length === 0) return null;
  return (
    <section className="block">
      {title ? <h2>{title}</h2> : null}
      <div className="gallery">
        {photos.map((p, i) => (
          <button type="button" key={p.id} className="shot" style={{ '--photo-i': i }} onClick={() => setOpen(p.url)}>
            <img src={p.url} alt="תמונה מהקריאה" />
          </button>
        ))}
      </div>
      {open ? (
        <div className="lightbox" onClick={() => setOpen(null)} role="dialog" aria-label="תצוגת תמונה">
          <img src={open} alt="" />
        </div>
      ) : null}
    </section>
  );
}

export function Timeline({ events, collapsible }) {
  const [open, setOpen] = useState(false);
  if (!events || events.length === 0) return null;
  const canCollapse = collapsible && events.length > 3;
  const shown = canCollapse && !open ? events.slice(-3) : events;
  return (
    <section className="block">
      <h2>מהלך הטיפול</h2>
      <ol className="timeline">
        {shown.map((ev) => (
          <li key={ev.id}>
            <span className="tldot" aria-hidden="true" />
            <div>
              <p>{ev.text}</p>
              <small>{[ev.actorName, formatWhen(ev.createdAt)].filter(Boolean).join(' · ')}</small>
            </div>
          </li>
        ))}
      </ol>
      {canCollapse ? (
        <button type="button" className="btn ghost timeline-more" onClick={() => setOpen((v) => !v)}>
          {open ? 'פחות' : 'הכל'}
        </button>
      ) : null}
    </section>
  );
}

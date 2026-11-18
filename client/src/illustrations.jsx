import { useEffect, useState } from 'react';
function HousePaths({ crack = false }) {
  return (
    <>
      <path d="M12 36 L40 14 L68 36" />
      <path d="M20 34 V66 H60 V34" />
      <rect x="26" y="42" width="12" height="12" />
      <rect x="44" y="42" width="12" height="12" />
      <path d="M36 66 V52 H44 V66" stroke="#2563eb" />
      {crack ? <path d="M48 45 L50.5 48.5 L49 50.5 L52 53" stroke="#dc2626" /> : null}
    </>
  );
}

function LineArt({ size, children }) {
  return (
    <svg
      className="line-art"
      width={size}
      height={size}
      viewBox="0 0 80 80"
      fill="none"
      stroke="#64748b"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function HouseArt({ board = false }) {
  return (
    <LineArt size={board ? 120 : 96}>
      <HousePaths />
    </LineArt>
  );
}

function FaultArt() {
  return (
    <LineArt size={72}>
      <HousePaths crack />
    </LineArt>
  );
}

function TechnicianArt() {
  return (
    <LineArt size={96}>
      <circle cx="34" cy="16" r="6" />
      <path d="M34 22 V44" />
      <path d="M34 28 L22 36" />
      <path d="M34 28 L48 34" />
      <path d="M34 44 L24 62" />
      <path d="M34 44 L44 62" />
      <path d="M48 34 L62 22 M62 22 L67 27 M62 22 L57 27" stroke="#2563eb" />
    </LineArt>
  );
}

export function EmptyState({ variant = 'house', board = false, children }) {
  let art = <HouseArt board={board} />;
  if (variant === 'technician') art = <TechnicianArt />;
  if (variant === 'fault') art = <FaultArt />;
  const kind = variant === 'fault' ? ' fault' : board ? ' board' : '';
  return (
    <div className={`empty-state${kind}`}>
      {art}
      {children}
    </div>
  );
}

// Fills the remaining height of short phone screens with a quiet line drawing (audit item 15).
export function FillArt() {
  // Mount after the screen's data has settled, so the filler never shifts content (CLS).
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 700); return () => clearTimeout(t); }, []);
  if (!ready) return <div className="fill-art" aria-hidden="true" />;
  return (
    <div className="fill-art" aria-hidden="true">
      <svg viewBox="0 0 80 80" preserveAspectRatio="xMidYMid meet" fill="none" stroke="#cbd5e1" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <g transform="translate(20 20) scale(0.5)"><HousePaths /></g>
      </svg>
    </div>
  );
}

import { useRef } from 'react';

export function useArriving(items, resetKey) {
  const bag = useRef({ key: resetKey, primed: false, seen: new Set(), fresh: new Set() });
  if (bag.current.key !== resetKey) {
    bag.current = { key: resetKey, primed: false, seen: new Set(), fresh: new Set() };
  }
  if (items == null) return bag.current.fresh;
  const ids = items.map((item) => String(item.id));
  if (!bag.current.primed) {
    bag.current.primed = true;
    ids.forEach((id) => bag.current.seen.add(id));
    return bag.current.fresh;
  }
  ids.forEach((id) => {
    if (!bag.current.seen.has(id)) bag.current.fresh.add(id);
    bag.current.seen.add(id);
  });
  return bag.current.fresh;
}

export function pressThen(action) {
  return (event) => {
    const el = event.currentTarget;
    if (!el || el.dataset.pressing === '1') return;
    el.dataset.pressing = '1';
    el.classList.add('is-pressed');
    let reduce = false;
    try {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      reduce = false;
    }
    const run = () => {
      el.dataset.pressing = '0';
      action();
    };
    if (reduce) run();
    else window.setTimeout(run, 80);
  };
}

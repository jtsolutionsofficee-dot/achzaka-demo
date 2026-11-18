export const STATUS = {
  new: 'חדשה',
  assigned: 'שויכה',
  on_the_way: 'בדרך',
  in_progress: 'בטיפול',
  waiting_parts: 'ממתינה לחלק',
  waiting_customer: 'ממתינה ללקוח',
  done: 'בוצע',
  closed: 'נסגר',
};

export const STATUS_ORDER = Object.keys(STATUS);

export const URGENCY = {
  emergency: 'חירום',
  urgent: 'דחוף',
  normal: 'רגילה',
};

export const CATEGORIES = ['אינסטלציה', 'חשמל', 'מעלית', 'מיזוג', 'איטום', 'ניקיון', 'בטיחות', 'אחר'];

export function isOpen(status) {
  return status !== 'done' && status !== 'closed';
}

export function formatWhen(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'עכשיו';
  if (min < 60) return min === 1 ? 'לפני דקה' : `לפני ${min} דק׳`;
  const hours = Math.round(min / 60);
  if (hours < 24) {
    if (hours === 1) return 'לפני שעה';
    if (hours === 2) return 'לפני שעתיים';
    return `לפני ${hours} שע׳`;
  }
  const days = Math.round(hours / 24);
  if (days === 1) return 'אתמול';
  if (days === 2) return 'לפני יומיים';
  if (days < 7) return `לפני ${days} ימים`;
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
}

export function formatStamp(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts));
}

export function todayLabel() {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());
}

function hoursPhrase(hours, late) {
  if (hours <= 1) return late ? 'שעה' : 'שעה';
  if (hours === 2) return 'שעתיים';
  return late ? `${hours} שע׳` : `${hours} שעות`;
}

export function slaText(sla) {
  if (!sla) return '';
  let text;
  if (sla.late) {
    const hours = Math.max(1, Math.round(Math.abs(sla.remainingMs) / 3600000));
    text = `באיחור של ${hoursPhrase(hours, true)}`;
  } else if (sla.remainingMs < 3600000) {
    text = 'פחות משעה לסיום ההתחייבות';
  } else {
    const hours = Math.round(sla.remainingMs / 3600000);
    text = `עוד ${hoursPhrase(hours, false)} במסגרת ההתחייבות`;
  }
  return sla.paused ? `מושהה · ${text}` : text;
}

export const ASSET_STATUS = {
  ok: 'תקין',
  needs_service: 'דורש טיפול',
  down: 'מושבת',
};

export const QUOTE_STATUS = {
  pending: 'ממתינה לאישור',
  approved: 'אושרה',
  rejected: 'נדחתה',
};

export function formatDay(ts) {
  if (!ts) return '';
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: 'Asia/Jerusalem',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(ts));
}

export function ils(amount) {
  if (amount == null || Number.isNaN(Number(amount))) return '';
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function commitment(urgency) {
  if (urgency === 'emergency') return 'התחייבות מענה: שעתיים';
  if (urgency === 'urgent') return 'התחייבות מענה: 8 שעות';
  return 'התחייבות מענה: 48 שעות';
}

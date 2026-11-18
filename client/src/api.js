const DEFAULT_TIMEOUT_MS = 45000;

export async function api(path, opts = {}) {
  const options = { ...opts };
  const timeoutMs = options.timeoutMs == null ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  delete options.timeoutMs;

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    options.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    options.body = JSON.stringify(options.body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(path, { ...options, signal: controller.signal });
    const text = await res.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || 'שגיאה');
      err.status = res.status;
      throw err;
    }
    return data;
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error('השליחה נמשכה יותר מדי. בדקו את החיבור ונסו שוב');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

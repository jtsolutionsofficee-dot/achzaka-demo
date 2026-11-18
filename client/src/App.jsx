import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import Login from './Login';
import Customer from './Customer';
import Employee from './Employee';
import Manager from './Manager';
import InstallBanner from './InstallBanner';

const HOME = { customer: '/c', employee: '/e', manager: '/m' };

export default function App() {
  const [loc, setLoc] = useState(() => window.location.pathname + window.location.search);
  const [me, setMe] = useState(null);
  const [ready, setReady] = useState(false);

  const url = new URL(loc, 'http://local');
  const path = url.pathname;
  const search = url.search;

  const go = useCallback((to) => {
    window.history.pushState({}, '', to);
    setLoc(window.location.pathname + window.location.search);
  }, []);

  const replace = useCallback((to) => {
    window.history.replaceState({}, '', to);
    setLoc(window.location.pathname + window.location.search);
  }, []);

  useEffect(() => {
    const on = () => setLoc(window.location.pathname + window.location.search);
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  useEffect(() => {
    api('/api/me').then((u) => setMe(u || null)).catch(() => setMe(null)).finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!ready || !me) return;
    const home = HOME[me.role];
    if (!path.startsWith(home)) replace(home);
  }, [ready, me, path, replace]);

  useEffect(() => {
    const area = !me ? 'כניסה' : me.role === 'manager' ? 'מוקד' : me.role === 'employee' ? 'טכנאי' : 'הבית';
    document.title = `אחזקה · ${area}`;
  }, [me]);

  async function enter(user) {
    setMe(user);
    replace(HOME[user.role]);
  }

  function logout() {
    // Leave the screen on the first click; the session delete finishes in the background.
    setMe(null);
    replace('/');
    window.scrollTo(0, 0);
    api('/api/session', { method: 'DELETE', keepalive: true, timeoutMs: 15000 }).catch(() => {});
  }

  let screen;
  if (!ready) {
    screen = <div className="boot"><strong>אחזקה</strong><span>טוען את המוקד…</span></div>;
  } else if (!me) {
    screen = <Login onEnter={enter} />;
  } else if (me.role === 'customer') {
    screen = <Customer me={me} path={path} go={go} logout={logout} />;
  } else if (me.role === 'employee') {
    screen = <Employee me={me} path={path} go={go} logout={logout} />;
  } else {
    screen = <Manager me={me} path={path} search={search} go={go} logout={logout} />;
  }
  return (
    <>
      <InstallBanner />
      {screen}
    </>
  );
}

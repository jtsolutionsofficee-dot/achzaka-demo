import { useEffect, useState } from 'react';
import { currentInstallPrompt, runInstallPrompt } from './pwa';

const DISMISS_KEY = 'achzaka-install-dismissed';

function standaloneNow() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function iosNow() {
  const ua = window.navigator.userAgent || '';
  const classic = /iPad|iPhone|iPod/.test(ua);
  const ipadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return classic || ipadOs;
}

export default function InstallBanner() {
  const [standalone, setStandalone] = useState(standaloneNow);
  const [canPrompt, setCanPrompt] = useState(!!currentInstallPrompt());
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  const [demo, setDemo] = useState(() => document.documentElement.dataset.demo !== '0');

  useEffect(() => {
    let live = true;
    fetch('/api/health', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (live) setDemo(!!j.demo); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    setIos(iosNow());
    const sync = () => {
      setStandalone(standaloneNow());
      setCanPrompt(!!currentInstallPrompt());
    };
    const media = window.matchMedia('(display-mode: standalone)');
    media.addEventListener?.('change', sync);
    window.addEventListener('achzaka-install', sync);
    return () => {
      media.removeEventListener?.('change', sync);
      window.removeEventListener('achzaka-install', sync);
    };
  }, []);

  function dismiss() {
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch {}
    setHidden(true);
  }

  async function install() {
    await runInstallPrompt();
    dismiss();
  }

  if (demo || standalone || hidden) return null;
  if (!canPrompt && !ios) return null;

  return (
    <div className="install-banner" role="region" aria-label="הוספה למסך הבית">
      {canPrompt ? (
        <button type="button" className="install-go" onClick={install}>הוספה למסך הבית</button>
      ) : (
        <p>באייפון: Safari, שיתוף, הוספה למסך הבית.</p>
      )}
      <button type="button" className="install-x" onClick={dismiss} aria-label="סגור">×</button>
    </div>
  );
}

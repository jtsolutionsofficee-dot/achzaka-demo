let deferredPrompt = null;

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    window.dispatchEvent(new Event('achzaka-install'));
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.dispatchEvent(new Event('achzaka-install'));
  });
}

export function currentInstallPrompt() {
  return deferredPrompt;
}

export async function runInstallPrompt() {
  const prompt = deferredPrompt;
  if (!prompt) return null;
  deferredPrompt = null;
  window.dispatchEvent(new Event('achzaka-install'));
  prompt.prompt();
  try {
    return await prompt.userChoice;
  } catch {
    return null;
  }
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
}

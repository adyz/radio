/**
 * Service worker registration + the deferred-reload dance: when a new SW
 * takes control mid-session, reload only once playback is idle so an update
 * never interrupts what the user is listening to.
 */

import type { RadioCore, RadioState } from './radioCore';

let core: RadioCore | null = null;
let pendingServiceWorkerReload = false;
let serviceWorkerReloaded = false;

function reloadForServiceWorkerUpdate() {
  if (serviceWorkerReloaded) return;
  serviceWorkerReloaded = true;
  pendingServiceWorkerReload = false;
  window.location.reload();
}

/** Hooked after every state transition: a pending SW reload runs at idle. */
export function maybeReloadForPendingServiceWorkerUpdate(newState: RadioState): void {
  if (pendingServiceWorkerReload && newState === 'idle') reloadForServiceWorkerUpdate();
}

function requestServiceWorkerReload() {
  if (serviceWorkerReloaded) return;
  if (core?.getState() === 'idle') {
    reloadForServiceWorkerUpdate();
    return;
  }
  pendingServiceWorkerReload = true;
}

export function initServiceWorker(radioCore: RadioCore): void {
  core = radioCore;
  if (!('serviceWorker' in navigator)) return;

  let hasServiceWorkerController = Boolean(navigator.serviceWorker.controller);

  (async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => {
        const swUrl = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || '';
        if (!swUrl.endsWith('/sw.js') || swUrl.endsWith('/js/sw.js')) {
          return reg.unregister();
        }
        return Promise.resolve(false);
      }));
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.update();
    } catch (err) {
      console.error('Service Worker registration failed:', err);
    }
  })();

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hasServiceWorkerController) {
      hasServiceWorkerController = true;
      return;
    }
    requestServiceWorkerReload();
  });
}

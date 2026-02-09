import { useEffect } from 'react';

export function useServiceWorker(): void {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => console.log('Service Worker registered!'))
        .catch((err: unknown) => console.error('Service Worker registration failed:', err));
    }
  }, []);
}

import { useEffect } from 'react';

export function useKeepAlive(): void {
  useEffect(() => {
    const worker = new Worker(
      new URL('../workers/keep-alive.ts', import.meta.url),
      { type: 'module' },
    );
    worker.onmessage = (): void => {
      console.log('Mențin conexiunea activă...');
    };

    return () => {
      worker.terminate();
    };
  }, []);
}

import { useEffect, useRef } from 'react';

export function useLiveReload(callback: () => void): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('change', () => cbRef.current());
    return () => es.close();
  }, []);
}

import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
export function useData(path, initial = []) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!path) { setLoading(false); return; }
    try { const result = await api(path); setData(result); } catch { /* Tratamento global com origem. */ }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => {
    let active = true;
    if (!path) { setLoading(false); return; }
    setLoading(true);
    api(path).then(result => { if (active) setData(result); }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    const listener = () => reload(); window.addEventListener('srgop:refresh', listener);
    return () => { active = false; window.removeEventListener('srgop:refresh', listener); };
  }, [path, reload]);
  return { data, setData, loading, reload };
}

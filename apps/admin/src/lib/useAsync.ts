/* 数据加载小工具：统一 loading / error / reload
   reload(silent) —— silent=true 时不动 loading，用于轮询静默刷新（不闪屏） */

import { useCallback, useEffect, useRef, useState } from "react";

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const run = useCallback(async (silent = false) => {
    const my = ++seq.current;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const r = await fn();
      if (my === seq.current) setData(r);
    } catch (e) {
      if (my === seq.current) setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      if (my === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void run();
  }, [run]);

  return { data, loading, error, reload: run, setData };
}

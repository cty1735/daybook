/* 会话状态：全局缓存 + 订阅，避免每个页面各自请求、登录后其它页面不刷新 */

import { useEffect, useState } from "react";
import { api, type SessionUser } from "./api";

let cached: SessionUser | null = null;
let loaded = false;
const listeners = new Set<(u: SessionUser | null) => void>();

export function setSessionUser(u: SessionUser | null): void {
  cached = u;
  loaded = true;
  for (const fn of listeners) fn(u);
}

export async function refreshSession(): Promise<SessionUser | null> {
  const u = await api.session();
  setSessionUser(u);
  return u;
}

export function useSessionUser(): { user: SessionUser | null; loading: boolean } {
  const [user, setUser] = useState<SessionUser | null>(cached);
  const [loading, setLoading] = useState(!loaded);

  useEffect(() => {
    listeners.add(setUser);
    if (!loaded) {
      void refreshSession().finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
    return () => {
      listeners.delete(setUser);
    };
  }, []);

  return { user, loading };
}

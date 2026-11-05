/* 轻量导航：Tab + 页面栈（PRD §5 信息架构） */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type TabKey = "home" | "ledger" | "report" | "me";

/** L2 / L3 页面 */
export type SheetRoute =
  | "budget"
  | "accounts"
  | "categories"
  | "io"
  | "recurring"
  | "monthReport"
  | "settings"
  | "login"
  | "register"
  | "forgot"
  | "account";

interface NavState {
  tab: TabKey;
  stack: SheetRoute[];
  /** 传给页面的参数 */
  params: Record<string, unknown>;
}

interface NavApi extends NavState {
  setTab: (t: TabKey) => void;
  push: (r: SheetRoute, params?: Record<string, unknown>) => void;
  pop: () => void;
  popTo: (r: SheetRoute) => void;
  /** 关闭所有二级页，回到当前 Tab */
  closeAll: () => void;
}

const NavContext = createContext<NavApi | null>(null);

const TAB_KEYS: TabKey[] = ["home", "ledger", "report", "me"];
const SHEET_KEYS: SheetRoute[] = [
  "budget",
  "accounts",
  "categories",
  "io",
  "recurring",
  "monthReport",
  "settings",
  "login",
  "register",
  "forgot",
  "account",
];

/** 支持深链：#/ledger、#/budget（PRD §13 深链需求的前置铺垫） */
function parseHash(): { tab: TabKey; stack: SheetRoute[] } {
  if (typeof location === "undefined") return { tab: "home", stack: [] };
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, ""));
  const [first] = raw.split("/");
  if ((TAB_KEYS as string[]).includes(first)) return { tab: first as TabKey, stack: [] };
  if ((SHEET_KEYS as string[]).includes(first)) return { tab: "me", stack: [first as SheetRoute] };
  return { tab: "home", stack: [] };
}

export function NavProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NavState>(() => {
    const p = parseHash();
    return { tab: p.tab, stack: p.stack, params: {} };
  });

  // 浏览器前进/后退
  useEffect(() => {
    const onHash = () => {
      const p = parseHash();
      setState({ tab: p.tab, stack: p.stack, params: {} });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const writeHash = useCallback((tab: TabKey, stack: SheetRoute[]) => {
    const target = stack.length ? `#/${stack[stack.length - 1]}` : `#/${tab}`;
    if (location.hash !== target) history.replaceState(null, "", target);
  }, []);

  const setTab = useCallback(
    (t: TabKey) => {
      setState({ tab: t, stack: [], params: {} });
      writeHash(t, []);
    },
    [writeHash],
  );

  const push = useCallback(
    (r: SheetRoute, params: Record<string, unknown> = {}) =>
      setState((s) => {
        const stack = [...s.stack, r];
        writeHash(s.tab, stack);
        return { ...s, stack, params: { ...s.params, [r]: params } };
      }),
    [writeHash],
  );

  const pop = useCallback(
    () =>
      setState((s) => {
        const stack = s.stack.slice(0, -1);
        writeHash(s.tab, stack);
        return { ...s, stack };
      }),
    [writeHash],
  );

  const popTo = useCallback(
    (r: SheetRoute) =>
      setState((s) => {
        const stack = s.stack.slice(0, s.stack.indexOf(r) + 1);
        writeHash(s.tab, stack);
        return { ...s, stack };
      }),
    [writeHash],
  );

  const api = useMemo<NavApi>(() => ({ ...state, setTab, push, pop, popTo, closeAll: () => setTab(state.tab) }), [state, setTab, push, pop, popTo]);
  return <NavContext.Provider value={api}>{children}</NavContext.Provider>;
}

export function useNav(): NavApi {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("useNav must be used within NavProvider");
  return ctx;
}
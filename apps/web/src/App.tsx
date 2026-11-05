/* 应用外壳：引导（IndexedDB 加载）→ 顶栏 / 底部 Tab / FAB / 页面栈 */

import { useEffect, useMemo, type ReactNode } from "react";
import { Icon } from "./icons/Icon";
import { NavProvider, useNav, type TabKey } from "./nav";
import { ToastProvider } from "./components/feedback";
import { RecordProvider, useRecord } from "./record";
import { useStore } from "./store/store";
import { hasTodaySnapshot, writeSnapshot } from "./lib/backup";
import { isOnline, runSync } from "./lib/sync";
import { api } from "./lib/api";
import { HomeScreen } from "./screens/HomeScreen";
import { LedgerScreen } from "./screens/LedgerScreen";
import { ReportScreen } from "./screens/ReportScreen";
import { MeScreen } from "./screens/MeScreen";
import { BudgetScreen } from "./screens/BudgetScreen";
import { AccountsScreen } from "./screens/AccountsScreen";
import { CategoriesScreen } from "./screens/CategoriesScreen";
import { ImportExportScreen } from "./screens/ImportExportScreen";
import { RecurringScreen } from "./screens/RecurringScreen";
import { SyncScreen } from "./screens/SyncScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { RegisterScreen } from "./screens/RegisterScreen";
import { ForgotScreen } from "./screens/ForgotScreen";
import { AccountScreen } from "./screens/AccountScreen";

/* ---------------------------- 主题 ---------------------------- */
function ThemeGate() {
  const theme = useStore((s) => s.settings.theme);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
      document.documentElement.setAttribute("data-theme", resolved);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  return null;
}

/* ---------------------------- 引导屏 ---------------------------- */
function Splash({ message }: { message: string }) {
  return (
    <div className="app-shell" style={{ display: "grid", placeItems: "center" }}>
      <div style={{ textAlign: "center", color: "var(--t2)" }}>
        <div
          style={{
            width: 54,
            height: 54,
            margin: "0 auto 16px",
            borderRadius: 18,
            background: "var(--fab-gradient)",
            display: "grid",
            placeItems: "center",
            color: "#fff",
            boxShadow: "var(--shadow)",
          }}
        >
          <Icon name="sparkles" size={26} strokeWidth={2.2} />
        </div>
        <div style={{ fontWeight: 700, fontSize: 17, color: "var(--t1)" }}>日账 DayBook</div>
        <div className="xsmall" style={{ marginTop: 8, color: "var(--t3)" }}>
          {message}
        </div>
      </div>
    </div>
  );
}

function Boot({ children }: { children: ReactNode }) {
  const hydrated = useStore((s) => s.hydrated);
  const initError = useStore((s) => s.initError);

  if (!hydrated) return <Splash message="正在打开本地账本…" />;
  if (initError) {
    return (
      <div className="app-shell" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <div className="card" style={{ textAlign: "center" }}>
          <b style={{ fontSize: 16 }}>本地数据库打开失败</b>
          <div className="xsmall muted-2" style={{ marginTop: 8, lineHeight: 1.7 }}>
            {initError}
            <br />
            可能是浏览器处于隐私模式，或 IndexedDB 被禁用。
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

/* ---------------------------- 底部导航 ---------------------------- */
const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "home", label: "首页", icon: "home" },
  { key: "ledger", label: "明细", icon: "list" },
  { key: "report", label: "报表", icon: "chart" },
  { key: "me", label: "我的", icon: "user" },
];

function TabBar() {
  const nav = useNav();
  return (
    <nav className="tabbar" aria-label="主导航">
      {TABS.map((t) => (
        <button
          key={t.key}
          className={`tab ${nav.tab === t.key ? "on" : ""}`}
          aria-current={nav.tab === t.key ? "page" : undefined}
          onClick={() => nav.setTab(t.key)}
        >
          <span className="tab-ic">
            <Icon name={t.icon} size={22} strokeWidth={nav.tab === t.key ? 2.4 : 2} />
          </span>
          {t.label}
        </button>
      ))}
    </nav>
  );
}

/* ---------------------------- FAB ---------------------------- */
function Fab() {
  const record = useRecord();
  const nav = useNav();
  if (nav.stack.length > 0) return null;
  return (
    <button className="fab" onClick={() => record.open()} aria-label="记一笔">
      <Icon name="plus" size={26} strokeWidth={2.5} />
    </button>
  );
}

/* ---------------------------- 页面栈 ---------------------------- */
function StackOverlay() {
  const nav = useNav();
  const top = nav.stack[nav.stack.length - 1];
  if (!top) return null;
  switch (top) {
    case "budget":
      return <BudgetScreen />;
    case "accounts":
      return <AccountsScreen />;
    case "categories":
      return <CategoriesScreen />;
    case "io":
      return <ImportExportScreen />;
    case "recurring":
      return <RecurringScreen />;
    case "sync":
      return <SyncScreen />;
    case "login":
      return <LoginScreen />;
    case "register":
      return <RegisterScreen />;
    case "forgot":
      return <ForgotScreen />;
    case "account":
      return <AccountScreen />;
    default:
      return null;
  }
}

/* ---------------------------- 顶栏 ---------------------------- */
function TopBar() {
  const nav = useNav();
  const theme = useStore((s) => s.settings.theme);
  const setTheme = useStore((s) => s.setTheme);
  const titles: Record<TabKey, string> = useMemo(() => ({ home: "", ledger: "明细", report: "报表", me: "我的" }), []);

  const cycleTheme = () => {
    const order = ["light", "system", "dark"] as const;
    const next = order[(order.indexOf(theme) + 1) % 3];
    setTheme(next);
  };

  const themeIcon = theme === "dark" ? "moon" : theme === "light" ? "sun" : "monitor";

  return (
    <header className="topbar">
      {nav.tab === "home" ? (
        <div className="brand">
          <span className="logo">
            <Icon name="sparkles" size={16} strokeWidth={2.4} />
          </span>
          日账
          <span style={{ color: "var(--green-600)", fontSize: 13, fontWeight: 700 }}>DayBook</span>
        </div>
      ) : (
        <div className="page-title">{titles[nav.tab]}</div>
      )}
      <button className="icon-btn" aria-label="切换主题" title="切换浅色 / 跟随系统 / 深色" onClick={cycleTheme}>
        <Icon name={themeIcon} size={20} />
      </button>
    </header>
  );
}

/* ---------------------------- 主壳 ---------------------------- */
function Shell() {
  const nav = useNav();
  const autoSync = useStore((s) => s.sync.autoSync);

  // 每日自动本地备份（PRD F7.4）+ 可选的自动云同步
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const s = useStore.getState();
      if (!(await hasTodaySnapshot())) {
        await writeSnapshot({
          schemaVersion: s.schemaVersion,
          categories: s.categories,
          accounts: s.accounts,
          transactions: s.transactions,
          budget: s.budget,
          settings: s.settings,
          lastUsedCategoryId: s.lastUsedCategoryId,
          lastUsedAccountId: s.lastUsedAccountId,
          categoryUsage: s.categoryUsage,
        });
      }
      if (cancelled || !autoSync || !isOnline()) return;
      const user = await api.session();
      if (cancelled || !user) return;
      try {
        await runSync();
      } catch {
        /* 自动同步失败不打扰用户 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoSync]);

  const screen =
    nav.tab === "home" ? <HomeScreen /> : nav.tab === "ledger" ? <LedgerScreen /> : nav.tab === "report" ? <ReportScreen /> : <MeScreen />;

  return (
    <div className="app-shell">
      <TopBar />
      <div className="scroll" key={nav.tab}>
        {screen}
      </div>
      <Fab />
      <TabBar />
      <StackOverlay />
    </div>
  );
}

export function App() {
  return (
    <Boot>
      <NavProvider>
        <ToastProvider>
          <RecordProvider>
            <ThemeGate />
            <Shell />
          </RecordProvider>
        </ToastProvider>
      </NavProvider>
    </Boot>
  );
}
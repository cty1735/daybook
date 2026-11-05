/* 应用外壳：登录门禁 → 顶栏 / 底部 Tab / FAB / 页面栈
   服务端为准：必须先登录，启动时从 /api/data 拉取账本。 */

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Icon } from "./icons/Icon";
import { NavProvider, useNav, type TabKey } from "./nav";
import { ToastProvider, useToast } from "./components/feedback";
import { RecordProvider, useRecord } from "./record";
import { setApiErrorHandler, useStore } from "./store/store";
import { HomeScreen } from "./screens/HomeScreen";
import { LedgerScreen } from "./screens/LedgerScreen";
import { ReportScreen } from "./screens/ReportScreen";
import { MeScreen } from "./screens/MeScreen";
import { BudgetScreen } from "./screens/BudgetScreen";
import { AccountsScreen } from "./screens/AccountsScreen";
import { CategoriesScreen } from "./screens/CategoriesScreen";
import { ImportExportScreen } from "./screens/ImportExportScreen";
import { RecurringScreen } from "./screens/RecurringScreen";
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

/* ---------------------------- 写失败提示 ---------------------------- */
function ApiErrorBridge() {
  const toast = useToast();
  const ref = useRef(toast);
  ref.current = toast;

  useEffect(() => {
    setApiErrorHandler((message) => ref.current.show({ message, tone: "err", duration: 4000 }));
    return () => setApiErrorHandler(null);
  }, []);

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
  const status = useStore((s) => s.status);
  const initError = useStore((s) => s.initError);

  if (status === "loading") return <Splash message="正在连接服务器…" />;
  if (status === "error") {
    return (
      <div className="app-shell" style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <div className="card" style={{ textAlign: "center" }}>
          <b style={{ fontSize: 16 }}>连接服务器失败</b>
          <div className="xsmall muted-2" style={{ marginTop: 8, lineHeight: 1.7 }}>
            {initError || "请检查网络后重试"}
          </div>
          <button className="btn btn-main btn-block" style={{ marginTop: 14 }} onClick={() => void useStore.getState().init()}>
            重试
          </button>
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
  const status = useStore((s) => s.status);
  const top = nav.stack[nav.stack.length - 1];
  if (!top) return null;
  // 未登录：除了登录相关页，其它写操作页面一律引导到登录
  if (status !== "ready" && top !== "login" && top !== "register" && top !== "forgot") return <LoginScreen />;
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

  // 未登录也能进首页（只读空账本）：登录入口在首页提示卡与「我的」里
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
      <StackOverlay key="stack" />
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
            <ApiErrorBridge />
            <Shell />
          </RecordProvider>
        </ToastProvider>
      </NavProvider>
    </Boot>
  );
}

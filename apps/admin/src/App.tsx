/* 应用外壳：管理员守卫 + 侧栏 + hash 路由 */

import { useEffect, useState } from "react";
import { FeedbackProvider } from "./components/feedback";
import { api, type AdminMe } from "./lib/api";
import { navigate, useRoute } from "./lib/router";
import { LoginScreen } from "./screens/LoginScreen";
import { OverviewScreen } from "./screens/OverviewScreen";
import { UsersScreen } from "./screens/UsersScreen";
import { AdminsScreen } from "./screens/AdminsScreen";
import { TransactionsScreen } from "./screens/TransactionsScreen";
import { StatsScreen } from "./screens/StatsScreen";
import { AuditScreen } from "./screens/AuditScreen";
import { SystemScreen } from "./screens/SystemScreen";

const NAV: { key: string; label: string; icon: string }[] = [
  { key: "overview", label: "概览", icon: "◈" },
  { key: "users", label: "用户管理", icon: "◉" },
  { key: "admins", label: "管理员账号", icon: "★" },
  { key: "transactions", label: "流水审计", icon: "☰" },
  { key: "stats", label: "统计分析", icon: "◔" },
  { key: "audit", label: "操作日志", icon: "✎" },
  { key: "system", label: "系统信息", icon: "⚙" },
];

function Shell() {
  const route = useRoute();
  const [me, setMe] = useState<AdminMe | null | undefined>(undefined);
  const [loggingOut, setLoggingOut] = useState(false);

  const refreshMe = async () => {
    setMe(await api.me());
  };

  useEffect(() => {
    void refreshMe();
  }, []);

  // 未登录 / 无权限 → 登录页
  if (me === undefined) return <div className="loading">正在校验身份…</div>;
  if (me === null) {
    return (
      <LoginScreen
        onDone={() => {
          void refreshMe();
        }}
      />
    );
  }

  const current = route.name;

  const screen = (() => {
    switch (current) {
      case "users":
        return <UsersScreen focusId={route.params[0]} />;
      case "admins":
        return <AdminsScreen />;
      case "transactions":
        return <TransactionsScreen initialUserId={route.params[0] ? decodeURIComponent(route.params[0]) : undefined} />;
      case "stats":
        return <StatsScreen />;
      case "audit":
        return <AuditScreen />;
      case "system":
        return <SystemScreen />;
      default:
        return <OverviewScreen />;
    }
  })();

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="side-brand">
          <div className="side-logo">账</div>
          <div>
            <div className="side-brand-t">日账 DayBook</div>
            <div className="side-brand-s">ADMIN CONSOLE</div>
          </div>
        </div>

        {NAV.map((n) => (
          <button
            key={n.key}
            className={`nav-item ${current === n.key ? "on" : ""}`}
            onClick={() => navigate(n.key)}
          >
            <span className="nav-ic">{n.icon}</span>
            {n.label}
          </button>
        ))}

        <div className="side-foot">
          <div style={{ marginBottom: 8, color: "var(--t2)", fontWeight: 600 }}>
            {me.displayUsername || me.username}
          </div>
          <button
            className="btn sm"
            disabled={loggingOut}
            onClick={() => {
              setLoggingOut(true);
              void api
                .logout()
                .catch(() => undefined)
                .then(() => refreshMe())
                .finally(() => setLoggingOut(false));
            }}
          >
            退出登录
          </button>
        </div>
      </aside>

      <main className="main">{screen}</main>
    </div>
  );
}

export function App() {
  return (
    <FeedbackProvider>
      <Shell />
    </FeedbackProvider>
  );
}

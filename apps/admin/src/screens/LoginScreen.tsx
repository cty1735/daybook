/* 后台登录页：走独立 /api/admin/auth/login（admin_user 表，与前台账号无关） */

import { useState } from "react";
import { ApiError, api } from "../lib/api";

export function LoginScreen({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!username.trim() || !password) {
      setError("请输入用户名和密码");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.login({ username: username.trim(), password });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "登录失败，请稍后再试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <div className="login-logo">账</div>
          <div>
            <div className="login-title">日账 DayBook</div>
            <div style={{ fontSize: 12, color: "var(--t3)" }}>管理后台</div>
          </div>
        </div>
        <div className="login-sub">
          仅后台管理员账号可登录，与前台 App 账号完全独立。App 注册的用户不能登录这里。
        </div>

        {error && <div className="error-box">{error}</div>}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input
            className="input"
            placeholder="用户名"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          <input
            className="input"
            type="password"
            placeholder="密码"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
          />
          <button className="btn primary" style={{ justifyContent: "center" }} disabled={busy} onClick={() => void submit()}>
            {busy ? "登录中…" : "登录"}
          </button>
        </div>

        <div style={{ marginTop: 16, fontSize: 11.5, color: "var(--t3)", lineHeight: 1.7 }}>
          连续 5 次密码错误将锁定 15 分钟；同一 IP 每小时最多 20 次登录尝试。
          忘记密码请联系其他管理员在「管理员账号」页重置。
        </div>
      </div>
    </div>
  );
}

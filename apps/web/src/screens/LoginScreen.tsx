/* L0 登录页（PRD v1.2 §F0 规则二.2）
   用户名 + 密码；保持登录默认开；失败文案统一为「用户名或密码不正确」 */

import { useState } from "react";
import { Icon } from "../icons/Icon";
import { SubPage } from "../components/SubPage";
import { Switch, useToast } from "../components/feedback";
import { useNav } from "../nav";
import { api, ApiError } from "../lib/api";
import { setSessionUser } from "../lib/auth-state";

export function LoginScreen() {
  const nav = useNav();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  const submit = async () => {
    setError(null);
    if (offline) {
      setError("需要网络连接");
      return;
    }
    if (!username.trim() || !password) {
      setError("请输入用户名和密码");
      return;
    }
    setBusy(true);
    try {
      const r = await api.login({ username: username.trim(), password, rememberMe: remember });
      setSessionUser(r.user);
      toast.show({ message: `欢迎回来，${r.user.displayUsername || r.user.username}`, duration: 2200 });
      nav.pop();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SubPage title="登录" subtitle="多设备同步 · 换机找回" onBack={nav.pop}>
      <div className="section">
        <div className="card">
          <div className="xsmall muted-2" style={{ marginBottom: 14, lineHeight: 1.7 }}>
            登录只用于把账本同步到云端与换机找回，不登录也能完整记账。数据默认只存在本机。
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label>用户名</label>
            <input
              className="input"
              autoComplete="username"
              placeholder="3–20 位字母、数字、_ 或 -"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label>密码</label>
            <div style={{ position: "relative" }}>
              <input
                className="input"
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                }}
                disabled={busy}
                style={{ paddingRight: 64 }}
              />
              <button
                type="button"
                className="xsmall"
                onClick={() => setShowPw((v) => !v)}
                style={{
                  position: "absolute",
                  right: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "var(--t3)",
                  cursor: "pointer",
                }}
              >
                {showPw ? "隐藏" : "显示"}
              </button>
            </div>
          </div>

          <div className="between" style={{ marginBottom: 14 }}>
            <span className="small">保持登录</span>
            <Switch on={remember} onChange={setRemember} label="保持登录" />
          </div>

          {offline ? (
            <div className="xsmall" style={{ color: "var(--budget-over)", marginBottom: 10 }}>
              <Icon name="info" size={13} /> 需要网络连接
            </div>
          ) : null}
          {error ? (
            <div className="xsmall" style={{ color: "var(--budget-over)", marginBottom: 10 }}>
              {error}
            </div>
          ) : null}

          <button className="btn btn-main btn-block" disabled={busy || offline} onClick={submit}>
            {busy ? "登录中…" : "登录"}
          </button>

          <div className="between" style={{ marginTop: 14 }}>
            <button className="xsmall" style={{ background: "none", border: "none", color: "var(--green-700)", cursor: "pointer" }} onClick={() => nav.push("register")}>
              还没有账号？注册
            </button>
            <button className="xsmall" style={{ background: "none", border: "none", color: "var(--t3)", cursor: "pointer" }} onClick={() => nav.push("forgot")}>
              忘记密码？
            </button>
          </div>
        </div>
      </div>

      <div className="section">
        <div className="card tight">
          <div className="xsmall muted-2" style={{ lineHeight: 1.85 }}>
            <b style={{ color: "var(--t1)" }}>账号能做什么</b>
            <br />· 同一本账，多个设备随时看
            <br />· 换手机登录即恢复
            <br />· 不登录也不影响记账、导出与本地备份
          </div>
        </div>
      </div>
    </SubPage>
  );
}

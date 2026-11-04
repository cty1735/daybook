/* L0 忘记密码（PRD v1.2 §F0 规则二.12）
   两条路径：恢复码（人人可用） / 绑定邮箱的一次性重置链接（15 分钟） */

import { useState } from "react";
import { Icon } from "../icons/Icon";
import { SubPage } from "../components/SubPage";
import { useToast } from "../components/feedback";
import { useNav } from "../nav";
import { api, ApiError } from "../lib/api";

export function ForgotScreen() {
  const nav = useNav();
  const toast = useToast();

  const [username, setUsername] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mailSent, setMailSent] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);

  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  const doReset = async (token?: string) => {
    setError(null);
    if (offline) return setError("需要网络连接");
    if (!username.trim()) return setError("请输入用户名");
    if (!token && !code.trim()) return setError("请输入恢复码");
    if (password.length < 8) return setError("新密码至少 8 位");
    if (password !== confirm) return setError("两次输入的密码不一致");

    setBusy(true);
    try {
      await api.resetPassword({
        username: username.trim(),
        newPassword: password,
        ...(token ? { token } : { code: code.replace(/[^A-Za-z0-9]/g, "") }),
      });
      toast.show({ message: "密码已重置，请用新密码登录", duration: 3000 });
      nav.pop();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sendMail = async () => {
    setError(null);
    if (offline) return setError("需要网络连接");
    if (!username.trim()) return setError("请输入用户名");
    setBusy(true);
    try {
      const r = await api.forgotPassword(username.trim());
      setMailSent(r.message);
      if (r.devResetToken) setDevToken(r.devResetToken);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SubPage title="找回密码" subtitle="恢复码 或 绑定邮箱" onBack={nav.pop}>
      <div className="section">
        <div className="card">
          <div className="field" style={{ marginBottom: 12 }}>
            <label>用户名</label>
            <input
              className="input"
              autoComplete="username"
              placeholder="注册时使用的用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label>恢复码</label>
            <input
              className="input num"
              placeholder="XXXX-XXXX"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              disabled={busy}
            />
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label>新密码</label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="8–64 位，需同时包含字母和数字"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label>确认新密码</label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="再输入一次"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
            />
          </div>

          {error ? (
            <div className="xsmall" style={{ color: "var(--budget-over)", marginBottom: 10 }}>
              {error}
            </div>
          ) : null}

          <button className="btn btn-main btn-block" disabled={busy || offline} onClick={() => void doReset()}>
            {busy ? "处理中…" : "用恢复码重置密码"}
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <div className="section-title">绑定了邮箱？</div>
        </div>
        <div className="card">
          <div className="xsmall muted-2" style={{ lineHeight: 1.7, marginBottom: 12 }}>
            我们会向绑定邮箱发送一条 15 分钟内有效、只能使用一次的重置链接。
          </div>
          <button className="btn btn-ghost btn-block" disabled={busy || offline} onClick={() => void sendMail()}>
            发送重置链接
          </button>
          {mailSent ? (
            <div className="xsmall" style={{ marginTop: 10, color: "var(--green-700)" }}>
              <Icon name="check" size={13} /> {mailSent}
            </div>
          ) : null}
          {devToken ? (
            <div style={{ marginTop: 12 }}>
              <div className="xsmall" style={{ color: "var(--budget-over)", lineHeight: 1.6, marginBottom: 8 }}>
                开发模式：邮件未真实发送，可直接使用本次生成的链接重置（填入上面「新密码」后点这里）。
              </div>
              <button className="btn btn-sub btn-block" disabled={busy} onClick={() => void doReset(devToken)}>
                用该链接重置密码
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="section">
        <div className="card tight">
          <div className="xsmall muted-2" style={{ lineHeight: 1.85 }}>
            重置成功后，所有设备都需要重新登录；本机账本数据不会丢失。
          </div>
        </div>
      </div>
    </SubPage>
  );
}

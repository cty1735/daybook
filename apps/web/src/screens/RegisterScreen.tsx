/* L0 注册页（PRD v1.2 §F0 规则一 / 二.3）
   用户名 + 密码 + 确认密码 + 可选邮箱 + 协议勾选；成功后只展示一次恢复码 */

import { useState } from "react";
import { SubPage } from "../components/SubPage";
import { useToast } from "../components/feedback";
import { useNav } from "../nav";
import { api, ApiError } from "../lib/api";
import { setSessionUser } from "../lib/auth-state";

const USERNAME_RE = /^[A-Za-z0-9_-]{3,20}$/;

function passwordProblem(pw: string, username: string): string | null {
  if (pw.length < 8) return "密码至少 8 位";
  if (pw.length > 64) return "密码最多 64 位";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "密码必须同时包含字母和数字";
  if (pw.toLowerCase() === username.trim().toLowerCase()) return "密码不能与用户名相同";
  return null;
}

function strength(pw: string): { level: 0 | 1 | 2 | 3; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { level: 1, label: "弱" };
  if (score === 2) return { level: 2, label: "中" };
  return { level: 3, label: "强" };
}

export function RegisterScreen() {
  const nav = useNav();
  const toast = useToast();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameHint, setNameHint] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const pwIssue = password ? passwordProblem(password, username) : null;
  const st = strength(password);

  const checkName = async () => {
    const v = username.trim();
    if (!USERNAME_RE.test(v) || /^\d+$/.test(v)) {
      setNameHint({ ok: false, text: "3–20 位字母、数字、下划线或连字符，且不能是纯数字" });
      return;
    }
    setChecking(true);
    try {
      const r = await api.checkUsername(v);
      setNameHint({ ok: r.available, text: r.available ? "用户名可用" : (r.message || "该用户名已被占用") });
    } catch {
      setNameHint(null);
    } finally {
      setChecking(false);
    }
  };

  const submit = async () => {
    setError(null);
    if (offline) return setError("需要网络连接");
    if (!USERNAME_RE.test(username.trim())) return setError("用户名需为 3–20 位字母、数字、下划线或连字符");
    if (/^\d+$/.test(username.trim())) return setError("用户名不能是纯数字");
    if (pwIssue) return setError(pwIssue);
    if (password !== confirm) return setError("两次输入的密码不一致");
    if (!agreed) return setError("请先阅读并同意用户协议与隐私政策");

    setBusy(true);
    try {
      const r = await api.register({
        username: username.trim(),
        password,
        email: email.trim() || undefined,
        acceptedTerms: agreed,
      });
      setSessionUser(r.user);
      setRecoveryCode(r.recoveryCode);
      toast.show({ message: "注册成功", duration: 2000 });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!recoveryCode) return;
    try {
      await navigator.clipboard.writeText(recoveryCode);
      toast.show({ message: "恢复码已复制", duration: 1800 });
    } catch {
      toast.show({ message: "复制失败，请手动抄写", tone: "err", duration: 2500 });
    }
  };

  const downloadCode = () => {
    if (!recoveryCode) return;
    const text = [
      "日账 DayBook · 账号恢复码",
      "",
      `用户名：${username.trim()}`,
      `恢复码：${recoveryCode}`,
      "",
      "未绑定邮箱时，只能凭此恢复码重置密码。",
      "请妥善保存，不要截图分享给他人。",
    ].join("\r\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `daybook-recovery-${username.trim()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (recoveryCode) {
    return (
      <SubPage title="保存恢复码" subtitle="只显示这一次" onBack={nav.pop}>
        <div className="section">
          <div className="card" style={{ textAlign: "center" }}>
            <div className="xsmall muted-2">你的恢复码</div>
            <div className="num" style={{ fontSize: 30, fontWeight: 800, letterSpacing: 3, margin: "12px 0 6px", color: "var(--green-700)" }}>
              {recoveryCode}
            </div>
            <div className="xsmall" style={{ color: "var(--budget-over)", lineHeight: 1.7 }}>
              关闭本页后将无法再次查看。忘记密码且未绑定邮箱时，只能用它找回账号。
            </div>
            <div className="between" style={{ marginTop: 16, gap: 10 }}>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={copyCode}>
                复制
              </button>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={downloadCode}>
                下载 txt
              </button>
            </div>
          </div>
        </div>
        <div className="section">
          <button
            className="btn btn-main btn-block"
            onClick={() => {
              toast.show({ message: "已保存，开始记账吧", duration: 2000 });
              // 从同步流程进来的回到同步页，否则回到 Tab
              if (nav.stack.includes("sync")) nav.popTo("sync");
              else nav.closeAll();
            }}
          >
            我已保存，进入记账
          </button>
        </div>
      </SubPage>
    );
  }

  return (
    <SubPage title="注册" subtitle="用户名 + 密码，邮箱可选" onBack={nav.pop}>
      <div className="section">
        <div className="card">
          <div className="field" style={{ marginBottom: 12 }}>
            <label>用户名</label>
            <input
              className="input"
              autoComplete="username"
              placeholder="3–20 位字母、数字、_ 或 -"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setNameHint(null);
              }}
              onBlur={() => void checkName()}
              disabled={busy}
            />
            {nameHint ? (
              <div className="xsmall" style={{ marginTop: 6, color: nameHint.ok ? "var(--green-700)" : "var(--budget-over)" }}>
                {checking ? "检查中…" : nameHint.text}
              </div>
            ) : null}
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label>密码</label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="8–64 位，需同时包含字母和数字"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
            {password ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <div style={{ display: "flex", gap: 4, flex: 1 }}>
                  {[1, 2, 3].map((i) => (
                    <span
                      key={i}
                      style={{
                        height: 4,
                        flex: 1,
                        borderRadius: 2,
                        background: i <= st.level ? (st.level === 1 ? "var(--budget-over)" : "var(--green-500)") : "var(--border)",
                      }}
                    />
                  ))}
                </div>
                <span className="xsmall muted-2">强度 {st.label}</span>
              </div>
            ) : null}
            {pwIssue ? (
              <div className="xsmall" style={{ marginTop: 6, color: "var(--budget-over)" }}>
                {pwIssue}
              </div>
            ) : null}
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label>确认密码</label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="再输入一次"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
            />
            {confirm && confirm !== password ? (
              <div className="xsmall" style={{ marginTop: 6, color: "var(--budget-over)" }}>
                两次输入的密码不一致
              </div>
            ) : null}
          </div>

          <div className="field" style={{ marginBottom: 12 }}>
            <label>邮箱（可选，仅用于找回密码）</label>
            <input
              className="input"
              type="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </div>

          <label className="xsmall" style={{ display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.6, marginBottom: 14 }}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ marginTop: 2 }} />
            <span className="muted-2">
              我已阅读并同意《用户协议》与《隐私政策》，了解账本数据默认保存在本机，账号仅用于同步与找回。
            </span>
          </label>

          {offline ? (
            <div className="xsmall" style={{ color: "var(--budget-over)", marginBottom: 10 }}>
              需要网络连接
            </div>
          ) : null}
          {error ? (
            <div className="xsmall" style={{ color: "var(--budget-over)", marginBottom: 10 }}>
              {error}
            </div>
          ) : null}

          <button className="btn btn-main btn-block" disabled={busy || offline || !agreed || Boolean(pwIssue) || !username || !confirm} onClick={submit}>
            {busy ? "注册中…" : "注册"}
          </button>

          <div style={{ textAlign: "center", marginTop: 14 }}>
            <button className="xsmall" style={{ background: "none", border: "none", color: "var(--green-700)", cursor: "pointer" }} onClick={() => nav.push("login")}>
              已有账号？去登录
            </button>
          </div>
        </div>
      </div>
    </SubPage>
  );
}

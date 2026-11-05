/* L2 账号与安全（PRD v1.2 §F0 规则二.8–11）
   用户名 / 绑定邮箱 / 修改密码 / 已登录设备 / 退出登录 */

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../icons/Icon";
import { SubPage } from "../components/SubPage";
import { useToast } from "../components/feedback";
import { useNav } from "../nav";
import { api, ApiError, type DeviceSession } from "../lib/api";
import { setSessionUser, useSessionUser } from "../lib/auth-state";
import { useStore } from "../store/store";

function fmt(ts: number | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function AccountScreen() {
  const nav = useNav();
  const toast = useToast();
  const { user, loading } = useSessionUser();

  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  const [codePw, setCodePw] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [newCode, setNewCode] = useState<string | null>(null);

  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [sessionsBusy, setSessionsBusy] = useState(false);

  const loadSessions = useCallback(async () => {
    setSessionsBusy(true);
    try {
      setSessions(await api.listSessions());
    } catch {
      /* 未登录或网络问题时静默 */
    } finally {
      setSessionsBusy(false);
    }
  }, []);

  useEffect(() => {
    if (user) void loadSessions();
  }, [user, loadSessions]);

  const changePassword = async () => {
    setPwError(null);
    if (!oldPw) return setPwError("请输入当前密码");
    if (newPw.length < 8) return setPwError("新密码至少 8 位");
    if (!/[A-Za-z]/.test(newPw) || !/\d/.test(newPw)) return setPwError("新密码必须同时包含字母和数字");
    if (newPw !== confirmPw) return setPwError("两次输入的新密码不一致");

    setPwBusy(true);
    try {
      await api.changePassword(oldPw, newPw);
      setOldPw("");
      setNewPw("");
      setConfirmPw("");
      toast.show({ message: "密码已更新，其他设备需要重新登录", duration: 3200 });
      await loadSessions();
    } catch (e) {
      setPwError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setPwBusy(false);
    }
  };

  const regenerate = async () => {
    if (!codePw) {
      toast.show({ message: "请输入当前密码", tone: "err", duration: 2000 });
      return;
    }
    setCodeBusy(true);
    try {
      const r = await api.regenerateRecoveryCode(codePw);
      setNewCode(r.recoveryCode);
      setCodePw("");
    } catch (e) {
      toast.show({ message: e instanceof ApiError ? e.message : String(e), tone: "err", duration: 3000 });
    } finally {
      setCodeBusy(false);
    }
  };

  const revoke = async (s: DeviceSession) => {
    try {
      await api.revokeSession(s.id);
      toast.show({ message: "该设备已下线", duration: 2000 });
      await loadSessions();
    } catch (e) {
      toast.show({ message: e instanceof ApiError ? e.message : String(e), tone: "err", duration: 3000 });
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } finally {
      setSessionUser(null);
      useStore.getState().logout();
      toast.show({ message: "已退出登录", duration: 2600 });
      nav.closeAll();
    }
  };

  if (loading) {
    return (
      <SubPage title="账号与安全" onBack={nav.pop}>
        <div className="section">
          <div className="card tight">
            <div className="xsmall muted-2">正在读取账号信息…</div>
          </div>
        </div>
      </SubPage>
    );
  }

  if (!user) {
    return (
      <SubPage title="账号与安全" onBack={nav.pop}>
        <div className="section">
          <div className="card" style={{ textAlign: "center" }}>
            <div className="xsmall muted-2" style={{ marginBottom: 14 }}>
              当前未登录
            </div>
            <button className="btn btn-main btn-block" onClick={() => nav.push("login")}>
              去登录
            </button>
          </div>
        </div>
      </SubPage>
    );
  }

  return (
    <SubPage title="账号与安全" subtitle="用户名、密码与已登录设备" onBack={nav.pop}>
      <div className="section">
        <div className="card" style={{ background: "var(--fab-gradient)", color: "#fff", border: "none" }}>
          <div className="xsmall" style={{ opacity: 0.9 }}>
            已登录账号
          </div>
          <div style={{ fontWeight: 800, fontSize: 22, marginTop: 4 }}>{user.displayUsername || user.username}</div>
          <div className="xsmall" style={{ opacity: 0.85, marginTop: 6 }}>
            {user.email ? `绑定邮箱：${user.email}` : "未绑定邮箱 · 仅可凭恢复码找回"}
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <div className="section-title">修改密码</div>
        </div>
        <div className="card">
          <div className="field" style={{ marginBottom: 12 }}>
            <label>当前密码</label>
            <input className="input" type="password" autoComplete="current-password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} disabled={pwBusy} />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>新密码</label>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="8–64 位，需同时包含字母和数字"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              disabled={pwBusy}
            />
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>确认新密码</label>
            <input className="input" type="password" autoComplete="new-password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} disabled={pwBusy} />
          </div>
          {pwError ? (
            <div className="xsmall" style={{ color: "var(--budget-over)", marginBottom: 10 }}>
              {pwError}
            </div>
          ) : null}
          <button className="btn btn-main btn-block" disabled={pwBusy} onClick={() => void changePassword()}>
            {pwBusy ? "更新中…" : "更新密码"}
          </button>
          <div className="xsmall muted-2" style={{ marginTop: 10, lineHeight: 1.6 }}>
            更新后会撤销其他设备的登录，当前设备保持在线。
          </div>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <div className="section-title">恢复码</div>
        </div>
        <div className="card">
          {newCode ? (
            <div style={{ textAlign: "center", marginBottom: 12 }}>
              <div className="xsmall muted-2">新的恢复码（只显示这一次）</div>
              <div className="num" style={{ fontSize: 26, fontWeight: 800, letterSpacing: 3, marginTop: 8, color: "var(--green-700)" }}>
                {newCode}
              </div>
            </div>
          ) : (
            <div className="xsmall muted-2" style={{ lineHeight: 1.7, marginBottom: 12 }}>
              未绑定邮箱时，恢复码是找回账号的唯一方式。重新生成后旧恢复码立即失效。
            </div>
          )}
          <div className="field" style={{ marginBottom: 12 }}>
            <label>当前密码</label>
            <input className="input" type="password" value={codePw} onChange={(e) => setCodePw(e.target.value)} disabled={codeBusy} />
          </div>
          <button className="btn btn-ghost btn-block" disabled={codeBusy} onClick={() => void regenerate()}>
            {codeBusy ? "生成中…" : "重新生成恢复码"}
          </button>
        </div>
      </div>

      <div className="section">
        <div className="section-head">
          <div className="section-title">已登录设备</div>
        </div>
        <div className="card tight">
          {sessions.length === 0 ? (
            <div className="xsmall muted-2">{sessionsBusy ? "读取中…" : "暂无设备信息"}</div>
          ) : (
            sessions.map((s) => (
              <div key={s.id} className="setting-row" style={{ alignItems: "center" }}>
                <span className="ic">
                  <Icon name="device" size={18} />
                </span>
                <span className="tx">
                  <b>
                    {s.device}
                    {s.current ? <span className="badge" style={{ marginLeft: 8 }}>当前设备</span> : null}
                  </b>
                  <span className="xsmall muted-2">
                    {s.ip} · 最近活跃 {fmt(s.lastActive)}
                  </span>
                </span>
                {s.current ? null : (
                  <button className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => void revoke(s)}>
                    下线
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="section">
        <button className="btn btn-danger btn-block" onClick={() => void logout()}>
          退出登录
        </button>
        <div className="xsmall muted-2" style={{ marginTop: 10, textAlign: "center", lineHeight: 1.7 }}>
          退出后需要重新登录才能继续使用，账本数据仍保存在云端。
        </div>
      </div>
    </SubPage>
  );
}

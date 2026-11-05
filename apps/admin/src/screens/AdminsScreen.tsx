/* 管理员账号：后台账号独立管理（与前台用户完全分离）
   支持：列表、新建、重置密码、停用/启用、删除、修改自己的密码 */

import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type AdminAccount } from "../lib/api";
import { dt, rel } from "../lib/format";
import { useFeedback } from "../components/feedback";

export function AdminsScreen() {
  const fb = useFeedback();
  const [rows, setRows] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: "", name: "", password: "", confirm: "" });
  const [resetTarget, setResetTarget] = useState<AdminAccount | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [resetPw2, setResetPw2] = useState("");

  const [selfPw, setSelfPw] = useState({ current: "", next: "", confirm: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.adminAccounts();
      setRows(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitCreate = async () => {
    if (!form.username.trim() || !form.password) {
      fb.fail("请填写用户名和密码");
      return;
    }
    if (form.password !== form.confirm) {
      fb.fail("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      await api.createAdminAccount({
        username: form.username.trim(),
        password: form.password,
        name: form.name.trim() || undefined,
      });
      fb.toast("管理员已创建");
      setForm({ username: "", name: "", password: "", confirm: "" });
      setShowCreate(false);
      await load();
    } catch (e) {
      fb.fail(e instanceof ApiError ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const submitReset = async () => {
    if (!resetTarget) return;
    if (resetPw.length < 8) {
      fb.fail("密码至少 8 位，且需同时包含字母和数字");
      return;
    }
    if (resetPw !== resetPw2) {
      fb.fail("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    try {
      const r = await api.resetAdminPassword(resetTarget.id, resetPw);
      if (r.data.self) {
        fb.toast("密码已修改，请重新登录");
        setResetTarget(null);
        setResetPw("");
        setResetPw2("");
        // 自己的密码被重置 → 会话已被撤销，回登录页
        window.location.reload();
        return;
      }
      fb.toast("密码已重置，该管理员的会话已全部失效");
      setResetTarget(null);
      setResetPw("");
      setResetPw2("");
      await load();
    } catch (e) {
      fb.fail(e instanceof ApiError ? e.message : "重置失败");
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async (a: AdminAccount) => {
    const next = a.status === "active" ? "disabled" : "active";
    const r = await fb.confirm({
      title: next === "disabled" ? "停用该管理员" : "启用该管理员",
      body: next === "disabled" ? "停用后该账号的会话会立即失效，且无法登录后台。" : "启用后该账号可以重新登录后台。",
      confirmText: next === "disabled" ? "确认停用" : "确认启用",
      danger: next === "disabled",
    });
    if (!r.ok) return;
    setBusy(true);
    try {
      await api.setAdminStatus(a.id, next);
      fb.toast(next === "disabled" ? "已停用" : "已启用");
      await load();
    } catch (e) {
      fb.fail(e instanceof ApiError ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (a: AdminAccount) => {
    const r = await fb.confirm({
      title: "删除管理员",
      body: `确定删除「${a.username}」？删除后该账号立即失效，此操作不可撤销。`,
      confirmText: "确认删除",
      danger: true,
    });
    if (!r.ok) return;
    setBusy(true);
    try {
      await api.deleteAdminAccount(a.id);
      fb.toast("已删除");
      await load();
    } catch (e) {
      fb.fail(e instanceof ApiError ? e.message : "删除失败");
    } finally {
      setBusy(false);
    }
  };

  const submitSelfPw = async () => {
    if (!selfPw.current || !selfPw.next) {
      fb.fail("请填写当前密码和新密码");
      return;
    }
    if (selfPw.next !== selfPw.confirm) {
      fb.fail("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    try {
      await api.changeMyPassword({ currentPassword: selfPw.current, newPassword: selfPw.next });
      fb.toast("密码已修改，其他后台会话已失效");
      setSelfPw({ current: "", next: "", confirm: "" });
    } catch (e) {
      fb.fail(e instanceof ApiError ? e.message : "修改失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">管理员账号</div>
          <div className="page-desc">后台账号与前台 App 账号完全分离，只有这里创建的账号能登录后台</div>
        </div>
        <button className="btn primary" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "收起" : "新建管理员"}
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      {showCreate && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title">新建管理员</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
            <input
              className="input"
              placeholder="用户名（3–20 位字母/数字/_/-）"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
            />
            <input
              className="input"
              placeholder="显示名（可选）"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              className="input"
              type="password"
              placeholder="密码（至少 8 位，含字母和数字）"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            <input
              className="input"
              type="password"
              placeholder="确认密码"
              autoComplete="new-password"
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
            />
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <button className="btn primary" disabled={busy} onClick={() => void submitCreate()}>
              {busy ? "创建中…" : "创建"}
            </button>
            <button className="btn" onClick={() => setShowCreate(false)}>
              取消
            </button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        {rows.length === 0 && !loading ? (
          <div className="empty">还没有管理员账号</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>用户名</th>
                <th>显示名</th>
                <th>状态</th>
                <th>最后登录</th>
                <th>创建时间</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>
                      {a.username}
                      {a.isSelf && <span className="chip ok" style={{ marginLeft: 8 }}>当前账号</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--t3)" }}>{a.id}</div>
                  </td>
                  <td style={{ color: "var(--t3)" }}>{a.name || "—"}</td>
                  <td>
                    {a.status === "active" ? <span className="chip ok">正常</span> : <span className="chip over">已停用</span>}
                  </td>
                  <td style={{ color: "var(--t3)" }} title={dt(a.lastLoginAt)}>
                    {rel(a.lastLoginAt)}
                  </td>
                  <td className="num" style={{ color: "var(--t3)" }}>{dt(a.createdAt)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="btn sm" disabled={busy} onClick={() => setResetTarget(a)}>
                      重置密码
                    </button>{" "}
                    {!a.isSelf && (
                      <button className="btn sm" disabled={busy} onClick={() => void toggleStatus(a)}>
                        {a.status === "active" ? "停用" : "启用"}
                      </button>
                    )}{" "}
                    {!a.isSelf && (
                      <button className="btn sm danger" disabled={busy} onClick={() => void remove(a)}>
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {loading && <div className="loading">加载中…</div>}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="section-title">修改我的密码</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          <input
            className="input"
            type="password"
            placeholder="当前密码"
            autoComplete="current-password"
            value={selfPw.current}
            onChange={(e) => setSelfPw({ ...selfPw, current: e.target.value })}
          />
          <input
            className="input"
            type="password"
            placeholder="新密码"
            autoComplete="new-password"
            value={selfPw.next}
            onChange={(e) => setSelfPw({ ...selfPw, next: e.target.value })}
          />
          <input
            className="input"
            type="password"
            placeholder="确认新密码"
            autoComplete="new-password"
            value={selfPw.confirm}
            onChange={(e) => setSelfPw({ ...selfPw, confirm: e.target.value })}
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <button className="btn primary" disabled={busy} onClick={() => void submitSelfPw()}>
            保存新密码
          </button>
        </div>
      </div>

      {resetTarget && (
        <div className="drawer-mask" onClick={() => setResetTarget(null)}>
          <div className="drawer" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div className="drawer-title">重置「{resetTarget.username}」的密码</div>
              <button className="btn sm" onClick={() => setResetTarget(null)}>
                关闭
              </button>
            </div>
            <div className="card">
              <div className="xsmall" style={{ color: "var(--t3)", marginBottom: 12, lineHeight: 1.7 }}>
                重置后该管理员的所有后台会话会立即失效。至少 8 位，且需同时包含字母和数字。
              </div>
              <input
                className="input"
                type="password"
                placeholder="新密码"
                autoComplete="new-password"
                value={resetPw}
                onChange={(e) => setResetPw(e.target.value)}
              />
              <input
                className="input"
                style={{ marginTop: 10 }}
                type="password"
                placeholder="确认新密码"
                autoComplete="new-password"
                value={resetPw2}
                onChange={(e) => setResetPw2(e.target.value)}
              />
              <div style={{ marginTop: 14 }}>
                <button className="btn primary" disabled={busy} onClick={() => void submitReset()}>
                  {busy ? "提交中…" : "确认重置"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

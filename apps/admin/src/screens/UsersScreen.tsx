/* 用户管理：搜索 / 筛选 / 游标分页 / 用户详情抽屉（封禁、解封、授权、强制下线） */

import { useCallback, useEffect, useState } from "react";
import { api, type UserDetail, type UserRow } from "../lib/api";
import { dt, rel } from "../lib/format";
import { useFeedback } from "../components/feedback";
import { navigate } from "../lib/router";

export function UsersScreen({ focusId }: { focusId?: string }) {
  const fb = useFeedback();
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [banned, setBanned] = useState("");
  const [sort, setSort] = useState<"created" | "lastLogin">("created");
  const [rows, setRows] = useState<UserRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(focusId ?? null);

  const load = useCallback(
    async (append = false, nextCursor?: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const r = await api.users({
          q: q.trim() || undefined,
          role: role || undefined,
          banned: banned || undefined,
          sort,
          cursor: append ? (nextCursor ?? undefined) : undefined,
          limit: 30,
        });
        setRows((prev) => (append ? [...prev, ...r.data] : r.data));
        setCursor(r.nextCursor);
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        setLoading(false);
      }
    },
    [q, role, banned, sort],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">用户管理</div>
          <div className="page-desc">搜索、查看会话与流水概况，封禁 / 解封 / 授权 / 强制下线</div>
        </div>
      </div>

      <div className="filters">
        <input
          className="input"
          style={{ width: 220 }}
          placeholder="搜索用户名 / 显示名 / 邮箱"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="">全部角色</option>
          <option value="admin">仅管理员</option>
          <option value="user">仅普通用户</option>
        </select>
        <select className="select" value={banned} onChange={(e) => setBanned(e.target.value)}>
          <option value="">全部状态</option>
          <option value="0">正常</option>
          <option value="1">已封禁</option>
        </select>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as "created" | "lastLogin")}>
          <option value="created">按注册时间</option>
          <option value="lastLogin">按最后登录</option>
        </select>
        <div className="spacer" />
        <button className="btn" onClick={() => void load(false)} disabled={loading}>
          刷新
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="table-wrap">
        {rows.length === 0 && !loading ? (
          <div className="empty">没有匹配的用户</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>用户名</th>
                <th>邮箱</th>
                <th>角色</th>
                <th>状态</th>
                <th>注册时间</th>
                <th>最后登录</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{u.displayUsername || u.username}</div>
                    <div style={{ fontSize: 11.5, color: "var(--t3)" }}>{u.id}</div>
                  </td>
                  <td style={{ color: "var(--t3)" }}>{u.email ?? "未绑定"}</td>
                  <td>
                    {u.role.includes("admin") ? <span className="chip ok">管理员</span> : <span className="chip mute">用户</span>}
                  </td>
                  <td>
                    {u.banned ? (
                      <span className="chip over" title={u.banReason ?? ""}>
                        已封禁
                      </span>
                    ) : (
                      <span className="chip ok">正常</span>
                    )}
                  </td>
                  <td className="num" style={{ color: "var(--t3)" }}>
                    {dt(u.createdAt)}
                  </td>
                  <td style={{ color: "var(--t3)" }} title={dt(u.lastLoginAt)}>
                    {rel(u.lastLoginAt)}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn sm" onClick={() => setDetailId(u.id)}>
                      详情
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {loading && <div className="loading">加载中…</div>}

        {!loading && cursor && (
          <div className="more">
            <button className="btn" onClick={() => void load(true, cursor)}>
              加载更多
            </button>
          </div>
        )}
      </div>

      {detailId && (
        <UserDrawer
          id={detailId}
          onClose={() => {
            setDetailId(null);
            if (focusId) navigate("users");
          }}
          onChanged={() => void load(false)}
          onNotify={(t, isErr) => (isErr ? fb.fail(t) : fb.toast(t))}
        />
      )}
    </>
  );
}

function UserDrawer({
  id,
  onClose,
  onChanged,
  onNotify,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  onNotify: (text: string, isError?: boolean) => void;
}) {
  const fb = useFeedback();
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.user(id);
      setData(r.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const u = data?.user;

  const doBan = async () => {
    const r = await fb.confirm({
      title: "封禁该用户",
      body: "封禁后该用户全部会话将被立即销毁，且无法再登录。可填写封禁原因，会记入操作日志。",
      confirmText: "确认封禁",
      danger: true,
      reason: { label: "封禁原因", placeholder: "例如：批量灌水、异常同步", required: false },
    });
    if (!r.ok) return;
    setBusy(true);
    try {
      await api.banUser(id, { reason: r.reason || undefined });
      onNotify("已封禁并清空会话");
      await load();
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "封禁失败", true);
    } finally {
      setBusy(false);
    }
  };

  const doUnban = async () => {
    const r = await fb.confirm({ title: "解封该用户", body: "解封后用户可以重新登录。", confirmText: "确认解封" });
    if (!r.ok) return;
    setBusy(true);
    try {
      await api.unbanUser(id);
      onNotify("已解封");
      await load();
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "解封失败", true);
    } finally {
      setBusy(false);
    }
  };

  const doRole = async (next: "admin" | "user") => {
    const r = await fb.confirm({
      title: next === "admin" ? "授予管理员权限" : "撤销管理员权限",
      body: next === "admin" ? "该用户将可以访问管理后台全部功能。" : "该用户将失去后台访问权限。",
      confirmText: next === "admin" ? "确认授予" : "确认撤销",
      danger: next === "user",
    });
    if (!r.ok) return;
    setBusy(true);
    try {
      await api.setRole(id, next);
      onNotify(next === "admin" ? "已授予管理员" : "已撤销管理员");
      await load();
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "操作失败", true);
    } finally {
      setBusy(false);
    }
  };

  const doRevoke = async () => {
    const r = await fb.confirm({
      title: "强制下线",
      body: "将销毁该用户所有设备的登录会话，用户需要重新登录。",
      confirmText: "确认下线",
      danger: true,
    });
    if (!r.ok) return;
    setBusy(true);
    try {
      await api.revokeSessions(id);
      onNotify("已强制下线");
      await load();
      onChanged();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "操作失败", true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-mask" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div className="drawer-title">{u ? u.displayUsername || u.username : "用户详情"}</div>
          <button className="btn sm" onClick={onClose}>
            关闭
          </button>
        </div>

        {loading && <div className="loading">加载中…</div>}
        {error && <div className="error-box">{error}</div>}

        {u && data && (
          <>
            <div className="card">
              <dl className="kv">
                <dt>用户 ID</dt>
                <dd className="num" style={{ fontSize: 12 }}>{u.id}</dd>
                <dt>邮箱</dt>
                <dd>{u.email ?? "未绑定"}</dd>
                <dt>角色</dt>
                <dd>{u.role.includes("admin") ? "管理员" : "普通用户"}</dd>
                <dt>状态</dt>
                <dd>
                  {u.banned ? (
                    <span className="chip over">已封禁</span>
                  ) : (
                    <span className="chip ok">正常</span>
                  )}
                  {u.banReason && <span style={{ marginLeft: 8, color: "var(--t3)" }}>{u.banReason}</span>}
                </dd>
                <dt>注册时间</dt>
                <dd className="num">{dt(u.createdAt)}</dd>
                <dt>最后登录</dt>
                <dd>{dt(u.lastLoginAt)}</dd>
              </dl>

              <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                {u.banned ? (
                  <button className="btn primary" disabled={busy} onClick={() => void doUnban()}>
                    解封
                  </button>
                ) : (
                  <button className="btn danger" disabled={busy} onClick={() => void doBan()}>
                    封禁
                  </button>
                )}
                {u.role.includes("admin") ? (
                  <button className="btn" disabled={busy} onClick={() => void doRole("user")}>
                    撤销管理员
                  </button>
                ) : (
                  <button className="btn" disabled={busy} onClick={() => void doRole("admin")}>
                    授予管理员
                  </button>
                )}
                <button className="btn" disabled={busy} onClick={() => void doRevoke()}>
                  强制下线
                </button>
                <button className="btn" onClick={() => navigate(`transactions/${encodeURIComponent(u.id)}`)}>
                  查看流水
                </button>
              </div>
            </div>

            <div className="section-title">数据概况</div>
            <div className="card">
              <dl className="kv">
                <dt>流水总数</dt>
                <dd className="num">
                  {data.transactions.total} 笔（有效 {data.transactions.live} 笔）
                </dd>
                <dt>最近发生</dt>
                <dd className="num">{dt(data.transactions.lastOccurredAt)}</dd>
                <dt>同步序号</dt>
                <dd className="num">{data.transactions.lastSeq}</dd>
                <dt>用户状态包</dt>
                <dd>{data.state ? `${dt(data.state.updatedAt)} 更新` : "尚未上传"}</dd>
              </dl>
            </div>

            <div className="section-title">已登录设备（{data.sessions.length}）</div>
            <div className="table-wrap">
              {data.sessions.length === 0 ? (
                <div className="empty">无有效会话</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>设备</th>
                      <th>IP</th>
                      <th>最后活跃</th>
                      <th>过期</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sessions.map((s) => (
                      <tr key={s.id}>
                        <td>{s.device}</td>
                        <td className="num" style={{ color: "var(--t3)" }}>{s.ip ?? "—"}</td>
                        <td style={{ color: "var(--t3)" }}>{rel(s.lastActive)}</td>
                        <td className="num" style={{ color: "var(--t3)" }}>{dt(s.expiresAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="section-title">同步设备（{data.devices.length}）</div>
            <div className="table-wrap">
              {data.devices.length === 0 ? (
                <div className="empty">无同步记录</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>设备 ID</th>
                      <th>最后同步</th>
                      <th>push</th>
                      <th>pull</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.devices.map((d) => (
                      <tr key={d.id}>
                        <td className="num" style={{ fontSize: 12 }}>{d.id}</td>
                        <td style={{ color: "var(--t3)" }}>{rel(d.lastSeenAt)}</td>
                        <td className="num">{d.pushes}</td>
                        <td className="num">{d.pulls}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="section-title">最近流水</div>
            <div className="table-wrap">
              {data.recentTransactions.length === 0 ? (
                <div className="empty">暂无流水</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>发生时间</th>
                      <th>金额</th>
                      <th>类型</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentTransactions.map((t) => (
                      <tr key={t.id}>
                        <td className="num" style={{ color: "var(--t3)" }}>{dt(t.occurredAt)}</td>
                        <td className="num">{t.amount}</td>
                        <td>{t.type}</td>
                        <td>{t.deleted ? <span className="chip over">已删除</span> : <span className="chip ok">有效</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

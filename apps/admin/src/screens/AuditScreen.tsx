/* 操作日志：后台写操作留痕（只读展示，不做导出） */

import { useCallback, useEffect, useState } from "react";
import { api, type AuditRow } from "../lib/api";
import { ACTION_LABEL, dt, dayEndMs, dayStartMs, rel } from "../lib/format";

export function AuditScreen() {
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AuditRow | null>(null);

  const load = useCallback(
    async (append = false, nextCursor?: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const r = await api.audit({
          action: action || undefined,
          from: from ? String(dayStartMs(from)) : undefined,
          to: to ? String(dayEndMs(to)) : undefined,
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
    [action, from, to],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">操作日志</div>
          <div className="page-desc">封禁、解封、授权、强制下线、流水删除与恢复都会留痕，只增不改</div>
        </div>
      </div>

      <div className="filters">
        <select className="select" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">全部操作</option>
          {Object.entries(ACTION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span style={{ color: "var(--t3)" }}>至</span>
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="spacer" />
        <button className="btn" onClick={() => void load(false)} disabled={loading}>
          查询
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="table-wrap">
        {rows.length === 0 && !loading ? (
          <div className="empty">暂无操作记录</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>操作</th>
                <th>操作人</th>
                <th>目标</th>
                <th>IP</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ color: "var(--t3)" }} title={dt(r.createdAt)}>
                    {rel(r.createdAt)}
                  </td>
                  <td>
                    <span className="chip mute">{ACTION_LABEL[r.action] ?? r.action}</span>
                  </td>
                  <td>{r.adminName}</td>
                  <td className="num" style={{ fontSize: 11.5, color: "var(--t3)" }}>
                    {r.targetType} / {r.targetId ?? "—"}
                  </td>
                  <td className="num" style={{ color: "var(--t3)" }}>{r.ip ?? "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn sm" onClick={() => setOpen(r)}>
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

      {open && (
        <div className="drawer-mask" onClick={() => setOpen(null)}>
          <div className="drawer" style={{ width: "min(520px, 94vw)" }} onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div className="drawer-title">{ACTION_LABEL[open.action] ?? open.action}</div>
              <button className="btn sm" onClick={() => setOpen(null)}>
                关闭
              </button>
            </div>
            <div className="card">
              <dl className="kv">
                <dt>时间</dt>
                <dd className="num">{dt(open.createdAt)}</dd>
                <dt>操作人</dt>
                <dd>
                  {open.adminName}（{open.adminId}）
                </dd>
                <dt>目标类型</dt>
                <dd>{open.targetType}</dd>
                <dt>目标 ID</dt>
                <dd className="num" style={{ fontSize: 12 }}>{open.targetId ?? "—"}</dd>
                <dt>IP</dt>
                <dd className="num">{open.ip ?? "—"}</dd>
                <dt>User-Agent</dt>
                <dd style={{ fontSize: 11.5, color: "var(--t3)" }}>{open.userAgent ?? "—"}</dd>
              </dl>
            </div>
            <div className="section-title">变更摘要</div>
            <pre className="json">{JSON.stringify(open.detail, null, 2)}</pre>
          </div>
        </div>
      )}
    </>
  );
}

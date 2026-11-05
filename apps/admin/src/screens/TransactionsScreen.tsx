/* 流水审计：多条件筛选（物化列走索引）+ 游标分页 + 详情抽屉（软删 / 恢复） */

import { useCallback, useEffect, useState } from "react";
import { api, type TxDetail, type TxRow } from "../lib/api";
import { dt, dayEndMs, dayStartMs, TX_TYPE_LABEL, yuan } from "../lib/format";
import { useFeedback } from "../components/feedback";

export function TransactionsScreen({ initialUserId }: { initialUserId?: string }) {
  const fb = useFeedback();
  const [userId, setUserId] = useState(initialUserId ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState("");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const [rows, setRows] = useState<TxRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<TxRow | null>(null);

  const load = useCallback(
    async (append = false, nextCursor?: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const r = await api.transactions({
          userId: userId.trim() || undefined,
          from: from ? String(dayStartMs(from)) : undefined,
          to: to ? String(dayEndMs(to)) : undefined,
          type: type || undefined,
          minAmount: minAmount.trim() || undefined,
          maxAmount: maxAmount.trim() || undefined,
          includeDeleted: includeDeleted ? "1" : undefined,
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
    [userId, from, to, type, minAmount, maxAmount, includeDeleted],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="page-title">流水审计</div>
          <div className="page-desc">
            按用户、时间、类型、金额区间筛选；软删会写入墓碑并分配新同步序号，所有设备下次同步即可拉到
          </div>
        </div>
      </div>

      <div className="filters">
        <input
          className="input"
          style={{ width: 200 }}
          placeholder="用户 ID（可选）"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span style={{ color: "var(--t3)" }}>至</span>
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">全部类型</option>
          <option value="expense">支出</option>
          <option value="income">收入</option>
          <option value="transfer">转账</option>
          <option value="adjustment">余额调整</option>
        </select>
        <input
          className="input"
          style={{ width: 110 }}
          placeholder="最小金额(分)"
          value={minAmount}
          onChange={(e) => setMinAmount(e.target.value)}
        />
        <input
          className="input"
          style={{ width: 110 }}
          placeholder="最大金额(分)"
          value={maxAmount}
          onChange={(e) => setMaxAmount(e.target.value)}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--t2)" }}>
          <input type="checkbox" checked={includeDeleted} onChange={(e) => setIncludeDeleted(e.target.checked)} />
          含已删除
        </label>
        <div className="spacer" />
        <button className="btn" onClick={() => void load(false)} disabled={loading}>
          查询
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="table-wrap">
        {rows.length === 0 && !loading ? (
          <div className="empty">没有匹配的流水</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>发生时间</th>
                <th>用户</th>
                <th>类型</th>
                <th style={{ textAlign: "right" }}>金额</th>
                <th>分类</th>
                <th>同步序号</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={`${t.userId}-${t.id}`}>
                  <td className="num" style={{ color: "var(--t3)" }}>{dt(t.occurredAt)}</td>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 12.5 }}>{t.username}</div>
                    <div style={{ fontSize: 11, color: "var(--t3)" }}>{t.userId}</div>
                  </td>
                  <td>{TX_TYPE_LABEL[t.type] ?? t.type}</td>
                  <td className="num" style={{ textAlign: "right", fontWeight: 700 }}>
                    {yuan(t.amount)}
                  </td>
                  <td style={{ color: "var(--t3)", fontSize: 12 }}>{t.categoryId ?? "—"}</td>
                  <td className="num" style={{ color: "var(--t3)" }}>{t.seq}</td>
                  <td>{t.deleted ? <span className="chip over">已删除</span> : <span className="chip ok">有效</span>}</td>
                  <td style={{ textAlign: "right" }}>
                    <button className="btn sm" onClick={() => setDetail(t)}>
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

      {detail && (
        <TxDrawer
          row={detail}
          onClose={() => setDetail(null)}
          onChanged={() => void load(false)}
          onNotify={(t, isErr) => (isErr ? fb.fail(t) : fb.toast(t))}
        />
      )}
    </>
  );
}

function TxDrawer({
  row,
  onClose,
  onChanged,
  onNotify,
}: {
  row: TxRow;
  onClose: () => void;
  onChanged: () => void;
  onNotify: (text: string, isError?: boolean) => void;
}) {
  const fb = useFeedback();
  const [detail, setDetail] = useState<TxDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await api.transaction(row.id, row.userId);
        if (alive) setDetail(r.data);
      } catch (e) {
        onNotify(e instanceof Error ? e.message : "加载失败", true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id, row.userId]);

  const doDelete = async () => {
    const r = await fb.confirm({
      title: "删除该流水",
      body: "将写入墓碑并分配新的同步序号，用户所有设备下次同步时会看到这条记录被删除。此操作可通过「恢复」撤销。",
      confirmText: "确认删除",
      danger: true,
    });
    if (!r.ok) return;
    setBusy(true);
    try {
      const res = await api.deleteTransaction(row.id, row.userId);
      onNotify(`已删除，新同步序号 ${res.data.seq}`);
      onChanged();
      onClose();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "删除失败", true);
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    const r = await fb.confirm({
      title: "恢复该流水",
      body: "将清除墓碑并分配新的同步序号，用户设备下次同步时记录会重新出现。",
      confirmText: "确认恢复",
    });
    if (!r.ok) return;
    setBusy(true);
    try {
      const res = await api.restoreTransaction(row.id, row.userId);
      onNotify(`已恢复，新同步序号 ${res.data.seq}`);
      onChanged();
      onClose();
    } catch (e) {
      onNotify(e instanceof Error ? e.message : "恢复失败", true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-mask" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div className="drawer-title">流水详情</div>
          <button className="btn sm" onClick={onClose}>
            关闭
          </button>
        </div>

        {loading && <div className="loading">加载中…</div>}

        {detail && (
          <>
            <div className="card">
              <dl className="kv">
                <dt>流水 ID</dt>
                <dd className="num" style={{ fontSize: 12 }}>{detail.id}</dd>
                <dt>所属用户</dt>
                <dd>{detail.username}</dd>
                <dt>用户 ID</dt>
                <dd className="num" style={{ fontSize: 12 }}>{detail.userId}</dd>
                <dt>金额</dt>
                <dd className="num" style={{ fontWeight: 700 }}>{yuan(detail.amount)}</dd>
                <dt>类型</dt>
                <dd>{TX_TYPE_LABEL[detail.type] ?? detail.type}</dd>
                <dt>分类 ID</dt>
                <dd className="num" style={{ fontSize: 12 }}>{detail.categoryId ?? "—"}</dd>
                <dt>发生时间</dt>
                <dd className="num">{dt(detail.occurredAt)}</dd>
                <dt>最后更新</dt>
                <dd className="num">{dt(detail.updatedAt)}</dd>
                <dt>同步序号</dt>
                <dd className="num">{detail.seq}</dd>
                <dt>状态</dt>
                <dd>
                  {detail.deleted ? <span className="chip over">已删除</span> : <span className="chip ok">有效</span>}
                </dd>
              </dl>

              <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
                {detail.deleted ? (
                  <button className="btn primary" disabled={busy} onClick={() => void doRestore()}>
                    恢复流水
                  </button>
                ) : (
                  <button className="btn danger" disabled={busy} onClick={() => void doDelete()}>
                    删除流水
                  </button>
                )}
              </div>
            </div>

            <div className="section-title">原始数据（payload）</div>
            <pre className="json">{JSON.stringify(detail.payload, null, 2)}</pre>
          </>
        )}
      </div>
    </div>
  );
}
